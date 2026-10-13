import type { MatchConfig } from "../../../shared/sim";
import type { SessionHandoff } from "../net/rollback";
import { roster } from "../../../shared/fighters/index";
import { isBundlePath } from "../../../shared/account";
import { account } from "../account";
import { fighterLoad } from "../gen";
import type { FighterChoice } from "../fighters";
import { CharacterShelf } from "./shelf";
import { StagePicker, type MatchSetup, type PickerAction } from "./stage";
import { ACTION_Y, SETUP, drawEmptySlot, drawSlotCard, slotWidth, slotX, type SlotFighter } from "./battle/slots";
import { PENCIL } from "../render/paper";
import { VIEW_H, VIEW_W } from "../render/camera";
import { consumeTypedChars, type DeviceId, type MenuInput } from "../input/devices";
import { sfx } from "../audio/audio";
import { WebSocketTransport, type PublicRoom, type RelayMessage, type RoomBot, type RoomMember, type Unsubscribe } from "../net/transport";
import { allChoices } from "../fighters";
import { CPU_TIERS, DEFAULT_TIER, tierName } from "../../../shared/cpu-skill";
import { localMatch } from "./localmatch";
import { bindingsOf, keyName } from "../input/bindings";
import { NetVersusScreen, startConfig } from "./netversus";
import { MatchTelemetry } from "../telemetry/match";
import { swap, type Handoff } from "../handoff";
import { MESH_VERSION, PeerMesh } from "../net/mesh";
import { bg, card, hint, label, title, hover, clicked, button, backButton, goTo, arrows, settings, saveSettings, type Screen, INK } from "./ui";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const LIST_Y = 170, ROW_H = 84, LIST_MAX = 5, CODE_Y = LIST_Y + LIST_MAX * ROW_H + 60;

/** How BATTLE sent you here. VS BOTS ("bots") is a private room that never shows its code. */
export type OnlineEntry = "quick" | "create" | "join" | "bots";

type RoomState = Extract<RelayMessage, { t: "room" }>;
interface OnlineContext {
  transport: WebSocketTransport;
  /** Peer-to-peer links to the room's members; null where the browser has no WebRTC (everything goes by the relay). */
  mesh: PeerMesh | null;
  id: number;
  room: RoomState | null;
  /** VS BOTS: the room's code isn't shown, and it starts with a bot in it. */
  hidden?: boolean;
}

function newMesh(context: OnlineContext): PeerMesh | null {
  if (typeof RTCPeerConnection === "undefined") return null;
  return new PeerMesh(context.transport, () => context.id);
}

/** The links a swap handed over, if this bundle speaks their version; else fresh ones (the old ones close). */
function adoptMesh(h: Handoff, context: OnlineContext): PeerMesh | null {
  const handed = h.mesh;
  if (handed && handed.version === MESH_VERSION) { handed.adopt(); return handed; }
  handed?.close();
  return newMesh(context);
}

type Focus = "fighter" | "ready" | `botFighter:${number}` | `botLevel:${number}` | "addBot" | "start" | "leave";
const SLOTS = 6;

export class OnlineScreen implements Screen {
  t = 0;
  sel = 0;
  phase: "create" | "join" | "waiting" | "lobby" | "loading" | "error";
  /** JOIN ROOM: the public rooms, refreshed every couple of seconds; `sel` indexes them, `rooms.length` is the code. */
  rooms: PublicRoom[] = [];
  private polled = -Infinity;
  code = ["A", "A", "A", "A"];
  codePos = 0;
  /** The stage screen after the host's START: theirs to edit, everyone else's to watch. */
  private picker: StagePicker | null = null;
  error = "";
  /** Keyboard focus in the lobby: your fighter, READY, a bot's fighter or level, + ADD BOT, START (host), LEAVE. */
  focus: Focus = "ready";
  nextScreen: Screen | null = null;
  private context: OnlineContext;
  private device: DeviceId = "kb1";
  private unsubscribers: Unsubscribe[] = [];
  /** What this player can pick in a room: their ready characters. */
  private shelf: CharacterShelf;
  private mine: FighterChoice | null;

  /** Pick up where another bundle left off: back in its room, and in its match if there was one. */
  static resume(onExit: () => Screen, h: Handoff): Screen {
    const context: OnlineContext = { transport: h.transport, mesh: null, id: h.id, room: h.room };
    context.mesh = adoptMesh(h, context);
    const screen = new OnlineScreen(onExit, null, null, context);
    if (!h.match) return screen;
    const m = h.match;
    screen.dispose();
    if (!h.room) throw new Error("handed a match without its room");
    const telemetry = new MatchTelemetry({ room: { code: h.room.code, trace: h.room.trace ?? null }, config: m.config, members: m.members, localSlot: m.localSlot, inputDelay: m.inputDelay, bundles: m.bundles, resumedAt: m.session.frame });
    return OnlineScreen.matchScreen(onExit, context, { config: m.config, bundles: m.bundles, members: m.members, localSlot: m.localSlot, device: m.device, inputDelay: m.inputDelay, resume: m.session, telemetry });
  }

  private static matchScreen(onExit: () => Screen, context: OnlineContext, m: { config: MatchConfig; bundles: string[]; members: Pick<RoomMember, "id" | "name" | "slot">[]; localSlot: number; device: DeviceId; inputDelay: number; resume?: SessionHandoff; telemetry: MatchTelemetry }): Screen {
    for (const p of m.config.players) if (!roster[p.fighter]) throw new Error(`online match fighter ${p.fighter} isn't loaded`);
    let over = false;
    return new NetVersusScreen({
      transport: context.transport,
      mesh: context.mesh,
      config: m.config,
      bundles: m.bundles,
      members: m.members,
      localSlot: m.localSlot,
      device: m.device,
      inputDelay: m.inputDelay,
      resume: m.resume,
      telemetry: m.telemetry,
      isHost: () => context.room?.host === context.id,
      roomState: () => context.room,
      localId: () => context.id,
      onLobby: (lobby) => { if (lobby.t === "room") { context.room = lobby; context.mesh?.members(lobby.members.map((m) => m.id)); if (!lobby.started) over = true; } },
      // the host ending the match (leaving the result screen or quitting) reopens the room, and that takes everyone back to it
      finished: () => over,
      exit: (reason) => {
        if (reason === "closed") { context.mesh?.close(); return onExit(); }
        const host = context.room?.host === context.id;
        // a guest quitting mid-match leaves the relay: the others see them drop instead of waiting on inputs that never come
        if (reason === "quit" && !host) { context.mesh?.close(); context.transport.close(); return onExit(); }
        if (host) context.transport.sendLobby({ t: "end" });
        return new OnlineScreen(onExit, null, null, context);
      },
    });
  }

  /** `fighter` is the one to bring into the room; a room that's resumed keeps whatever was picked there. */
  constructor(private onExit: () => Screen, entry: OnlineEntry | null, fighter: FighterChoice | null, context?: OnlineContext) {
    this.shelf = new CharacterShelf(SETUP.shelfY);
    this.mine = this.shelf.choices.find((c) => c.id === fighter?.id) ?? null;
    if (this.mine) this.shelf.show(this.mine.id);
    if (context) this.context = context;
    else {
      this.context = { transport: new WebSocketTransport(), mesh: null, id: 0, room: null };
      this.context.mesh = newMesh(this.context);
    }
    if (this.context.room) this.phase = "lobby";
    else if (entry === "quick") { this.context.transport.sendLobby({ t: "quick" }); this.phase = "waiting"; }
    else if (entry === "create") this.phase = "create";
    else if (entry === "bots") { this.context.hidden = true; this.context.transport.sendLobby({ t: "create", public: false }); this.phase = "waiting"; }
    else if (entry === "join") { consumeTypedChars(); this.phase = "join"; }
    else throw new Error("online screen with neither a room nor a way in");
    this.unsubscribers.push(
      this.context.transport.onLobby((message) => this.onMessage(message)),
      this.context.transport.onClose(() => { this.error = "CONNECTION LOST"; this.phase = "error"; }),
    );
    this.context.transport.ready.catch((error) => {
      console.error(error);
      this.error = "COULD NOT CONNECT";
      this.phase = "error";
    });
    if (account.player) this.context.transport.sendLobby({ t: "name", name: account.player.name });
  }

  update(dt: number, m: MenuInput): Screen | null {
    this.t += dt;
    // the arrows (keyboard 2) are a friend's side of the keyboard: whoever uses them in the menus is still keyboard 1
    if (m.from && !this.friendDevice(m.from)) this.device = m.from === "kb2" ? "kb1" : m.from;
    if (this.nextScreen) {
      const next = this.nextScreen;
      this.nextScreen = null;
      this.dispose();
      return next;
    }
    if (this.phase === "create") return this.updateCreate(m);
    if (this.phase === "join") return this.updateJoin(m);
    if (this.phase === "waiting") return m.back ? this.exit() : null;
    if (this.phase === "lobby") return this.updateLobby(m);
    if (this.phase === "loading") return null;
    if (m.back || m.confirm) return this.exit();
    return null;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    bg(ctx, this.t);
    if (this.phase !== "lobby" && this.phase !== "loading") title(ctx, this.phase === "join" ? "JOIN ROOM" : "ONLINE", VIEW_W / 2, 90, 64);
    if (this.phase === "create") this.drawCreate(ctx);
    else if (this.phase === "join") this.drawJoin(ctx);
    else if (this.phase === "waiting") this.drawWaiting(ctx);
    else if (this.phase === "lobby" || this.phase === "loading") this.drawLobby(ctx);
    else this.drawError(ctx);
  }

  get roomCode(): string | null {
    return this.context.room?.code ?? null;
  }

  lobbyDebug(): { code: string; members: { ready: boolean; fighter: string }[] } | null {
    const room = this.context.room;
    return room ? { code: room.code, members: room.members.map((member) => ({ ready: member.ready, fighter: member.fighter })) } : null;
  }

  private updateCreate(m: MenuInput): Screen | null {
    if (m.up || m.down) { this.sel = 1 - this.sel; sfx.menuMove(); }
    if (m.back) return this.exit();
    if (m.confirm || m.start) this.create(this.sel === 0);
    return null;
  }

  private create(isPublic: boolean): void {
    sfx.menuConfirm();
    this.context.transport.sendLobby({ t: "create", public: isPublic });
    this.phase = "waiting";
  }

  private updateJoin(m: MenuInput): Screen | null {
    if (this.t - this.polled > 2) { this.polled = this.t; this.context.transport.sendLobby({ t: "rooms" }); }
    const rows = Math.min(LIST_MAX, this.rooms.length);
    if (this.sel > rows) this.sel = rows;
    let submit = false;
    const typed = consumeTypedChars();
    for (const char of typed) {
      this.sel = rows;
      if (char === "\n") submit = true;
      else if (char === "\b") { this.code[this.codePos] = "A"; this.codePos = (this.codePos + 3) % 4; }
      else { this.code[this.codePos] = char; this.codePos = (this.codePos + 1) % 4; }
    }
    if (typed.length) return submit ? this.join(this.code.join("")) : null;
    if (m.up) { this.sel = (this.sel + rows) % (rows + 1); sfx.menuMove(); }
    if (m.down) { this.sel = (this.sel + 1) % (rows + 1); sfx.menuMove(); }
    if (this.sel === rows && (m.left || m.right)) {
      const current = Math.max(0, CODE_CHARS.indexOf(this.code[this.codePos]));
      this.code[this.codePos] = CODE_CHARS[(current + (m.right ? 1 : CODE_CHARS.length - 1)) % CODE_CHARS.length];
      sfx.menuMove();
    }
    if (m.confirm || m.start) return this.join(this.sel < rows ? this.rooms[this.sel].code : this.code.join(""));
    if (m.back) return this.exit();
    return null;
  }

  private join(code: string): null {
    sfx.menuConfirm();
    this.context.transport.sendLobby({ t: "join", code });
    this.phase = "waiting";
    return null;
  }

  private updateLobby(m: MenuInput): Screen | null {
    const room = this.context.room;
    if (!room) throw new Error("lobby phase without room state");
    const member = room.members.find((candidate) => candidate.id === this.context.id);
    if (!member) throw new Error("local member missing from room");
    if (this.picker) { this.onPicker(this.picker.update(m)); return null; }
    if (this.friendInput(m)) return null;
    this.bringFighter();
    const canStart = this.canStart();
    const isHost = room.host === this.context.id;
    const bots = room.bots ?? [];
    const items: Focus[] = this.alone() ? ["fighter"] : ["fighter", "ready"];
    if (isHost) {
      bots.forEach((b, i) => { items.push(`botFighter:${i}`); if (b.level > 0) items.push(`botLevel:${i}`); });
      if (room.members.length + bots.length < SLOTS) items.push("addBot");
      if (canStart) items.push("start");
    }
    items.push("leave");
    if (!items.includes(this.focus)) this.focus = items.includes("start") ? "start" : items[items.length > 1 ? 1 : 0];
    if (m.up || m.down) {
      const i = Math.max(0, items.indexOf(this.focus));
      this.focus = items[(i + (m.down ? 1 : items.length - 1)) % items.length];
      sfx.menuMove();
    }
    if (m.left || m.right) {
      const d = m.right ? 1 : -1;
      const [kind, n] = this.focus.split(":");
      if (kind === "botFighter") this.stepBotFighter(Number(n), d);
      else if (kind === "botLevel") this.stepBotLevel(Number(n), d);
      else if (!member.ready) this.pickFighter(d);
    }
    if (isHost && canStart && this.focus === "ready" && member.ready) this.focus = "start";
    if (m.confirm) {
      if (this.focus === "leave") this.leave();
      else if (this.focus === "start" && isHost && canStart) this.openStagePick();
      else if (this.focus === "addBot") this.addBot();
      else if (this.alone()) { if (canStart) this.openStagePick(); }
      else if (this.focus === "fighter" || this.focus === "ready") this.toggleReady();
    }
    if (m.back) this.leave();
    return null;
  }

  /** Two fighters at least, bots and friends counting, and every person ready; friends here can't go online yet. */
  canStart(): boolean {
    const room = this.context.room;
    if (!room) return false;
    if (!this.alone() && (room.bots ?? []).some((b) => b.level === 0)) return false;
    return room.members.length + (room.bots?.length ?? 0) >= 2 && (this.alone() || room.members.every((candidate) => candidate.ready));
  }

  /** The friend on this computer playing with `device`, if any. */
  private friendDevice(device: DeviceId): RoomBot | undefined {
    return (this.context.room?.bots ?? []).find((b) => b.level === 0 && b.device === device);
  }

  /**
   * Keyboard 2 and the pads belong to friends on this computer: attack or jump on one nobody has drops a friend in;
   * a friend's left/right picks their fighter, and a pad's B takes them out. True when the input was a friend's.
   */
  private friendInput(m: MenuInput): boolean {
    const room = this.context.room;
    const from = m.from;
    if (!room || room.host !== this.context.id || !from || from === this.device) return false;
    if (from !== "kb2" && !from.startsWith("pad")) return false;
    const bots = room.bots ?? [];
    const i = bots.findIndex((b) => b.level === 0 && b.device === from);
    if (i < 0) {
      if (!m.confirm) return false;
      if (room.members.length + bots.length >= SLOTS) return true;
      const used = [...room.members.map((x) => x.fighter), ...bots.map((b) => b.fighter)];
      const choices = this.botChoices();
      const pick = choices.find((c) => !used.includes(c.id)) ?? choices[0];
      if (pick) { this.sendBots([...bots, { fighter: pick.id, bundleUrl: pick.bundleUrl, level: 0, device: from }]); sfx.menuConfirm(); }
      return true;
    }
    if (m.left || m.right) this.stepBotFighter(i, m.right ? 1 : -1);
    if (m.back) this.removeBot(i);
    return m.left || m.right || m.back || m.up || m.down || m.confirm;
  }

  /** Nobody else in the room: READY means nothing, START is enough. */
  private alone(): boolean {
    return this.context.room?.members.length === 1;
  }

  /** What a host can give a bot: the house fighters, then their own. */
  private botChoices(): FighterChoice[] {
    const { house, mine } = allChoices();
    return [...house, ...mine];
  }

  private sendBots(bots: RoomBot[]): void {
    this.context.transport.sendLobby({ t: "bots", bots });
  }

  /** A new bot plays whoever's in the room least, at the level last used. */
  addBot(): void {
    const room = this.context.room;
    if (!room || room.host !== this.context.id) return;
    const bots = room.bots ?? [];
    if (room.members.length + bots.length >= SLOTS) return;
    const used = [...room.members.map((m) => m.fighter), ...bots.map((b) => b.fighter)];
    const choices = this.botChoices();
    const fresh = choices.find((c) => !used.includes(c.id)) ?? choices[0];
    if (!fresh) return;
    this.sendBots([...bots, { fighter: fresh.id, bundleUrl: fresh.bundleUrl, level: settings.cpuTier || DEFAULT_TIER }]);
    sfx.menuConfirm();
  }

  removeBot(i: number): void {
    const bots = [...(this.context.room?.bots ?? [])];
    bots.splice(i, 1);
    this.sendBots(bots);
    sfx.menuBack();
  }

  private stepBotFighter(i: number, d: number): void {
    const bots = [...(this.context.room?.bots ?? [])];
    const choices = this.botChoices();
    if (!bots[i] || !choices.length) return;
    const at = choices.findIndex((c) => c.id === bots[i].fighter);
    const next = choices[(at + d + choices.length) % choices.length];
    bots[i] = { ...bots[i], fighter: next.id, bundleUrl: next.bundleUrl };
    this.sendBots(bots);
    sfx.menuMove();
  }

  /** The level sticks as the default for the next bot. */
  private stepBotLevel(i: number, d: number): void {
    const bots = [...(this.context.room?.bots ?? [])];
    if (!bots[i]) return;
    const level = Math.max(1, Math.min(CPU_TIERS.length, bots[i].level + d));
    bots[i] = { ...bots[i], level };
    settings.cpuTier = level;
    saveSettings();
    this.sendBots(bots);
    sfx.menuMove();
  }

  toggleReady(): void {
    const room = this.context.room;
    const member = room?.members.find((candidate) => candidate.id === this.context.id);
    if (!room || !member) return;
    if (!member.fighter) return;
    this.context.transport.sendLobby({ t: "pick", fighter: member.fighter, bundleUrl: member.bundleUrl, ready: !member.ready });
    member.ready ? sfx.menuBack() : sfx.menuConfirm();
  }

  pickFighter(dir: number): void {
    const room = this.context.room;
    const member = room?.members.find((candidate) => candidate.id === this.context.id);
    if (!room || !member || member.ready) return;
    const choices = this.shelf.choices;
    if (!choices.length) return;
    const index = choices.findIndex((c) => c.id === member.fighter);
    this.pick(choices[(index + dir + choices.length) % choices.length]);
    this.shelf.show(this.mine!.id);
    sfx.menuMove();
  }

  /** Arriving in a room (or the library arriving after you): bring the fighter picked on the way in, or your first. */
  private bringFighter(): void {
    const me = this.context.room?.members.find((member) => member.id === this.context.id);
    const choice = this.mine ?? this.shelf.choices[0];
    if (me && !me.fighter && choice) this.pick(choice);
  }

  private pick(choice: FighterChoice): void {
    this.mine = choice;
    this.context.transport.sendLobby({ t: "pick", fighter: choice.id, bundleUrl: choice.bundleUrl, ready: false });
  }

  /** The host's START: everyone moves to the stage screen, the host picking. */
  openStagePick(): void {
    const room = this.context.room;
    if (!room || room.host !== this.context.id || !this.canStart()) return;
    const me = room.members.find((m) => m.id === this.context.id);
    if (me && !me.ready) this.context.transport.sendLobby({ t: "pick", fighter: me.fighter, bundleUrl: me.bundleUrl, ready: true });
    this.context.transport.sendLobby({ t: "picking", pick: new StagePicker(false).setup });
    sfx.menuConfirm();
  }

  private onPicker(action: PickerAction): void {
    const room = this.context.room;
    if (!room || !this.picker || !action) return;
    const isHost = room.host === this.context.id;
    if (action === "back") { if (isHost) this.context.transport.sendLobby({ t: "picking", pick: null }); else this.leave(); return; }
    if (isHost) this.startMatch(this.picker.rolled());
  }

  private startMatch(setup: MatchSetup): void {
    const room = this.context.room;
    // everyone in the room is on this computer: the match runs here, not through the relay
    if (room && room.members.length === 1 && room.bots?.length) { this.startLocal(room, setup); return; }
    this.context.transport.sendLobby({
      t: "start",
      config: { stage: setup.stage, rules: { stocks: setup.stocks, time: setup.time }, ...(setup.map ? { map: setup.map } : {}) },
    });
    sfx.go();
  }

  /** A local match against the room's bots; the room shows as busy until it ends, then it's back to the lobby. */
  private startLocal(room: RoomState, setup: MatchSetup): void {
    if (!this.mine) throw new Error("local start without a fighter");
    const choices = this.botChoices();
    const bots = (room.bots ?? []).map((b) => ({
      fighter: choices.find((c) => c.id === b.fighter) ?? { id: b.fighter, name: "", bundleUrl: b.bundleUrl, house: false, entry: null },
      source: b.level === 0 ? { device: (b.device ?? "kb2") as DeviceId, cpu: 0 } : { device: null, cpu: b.level },
    }));
    this.context.transport.sendLobby({ t: "local" });
    sfx.go();
    const context = this.context, onExit = this.onExit;
    this.nextScreen = localMatch([{ fighter: this.mine, source: { device: this.device, cpu: 0 } }, ...bots], setup, () => {
      context.transport.sendLobby({ t: "end" });
      return new OnlineScreen(onExit, null, null, context);
    });
  }

  /** Follows the room onto and off the stage screen; the host's own picker is the one being mirrored. */
  private followPicking(room: RoomState): void {
    if (!room.picking || room.started) { this.picker = null; return; }
    const isHost = room.host === this.context.id;
    if (!this.picker) {
      this.picker = new StagePicker(!isHost, (setup) => this.context.transport.sendLobby({ t: "picking", pick: setup }));
      this.picker.show({ ...room.picking, map: room.picking.map ?? null });
    } else if (!isHost) this.picker.show({ ...room.picking, map: room.picking.map ?? null });
  }

  leave(): void {
    sfx.menuBack();
    goTo(this.exit());
  }

  private onMessage(message: RelayMessage): void {
    if (message.t === "hello") this.context.id = message.id;
    if (message.t === "room") {
      // VS BOTS opens with one bot waiting
      if (this.context.hidden && !this.context.room && message.host === this.context.id && !message.bots?.length) queueMicrotask(() => this.addBot());
      this.context.room = message;
      this.context.mesh?.members(message.members.map((m) => m.id));
      if (this.phase !== "loading") this.phase = "lobby";
      this.followPicking(message);
      this.bringFighter();
    }
    if (message.t === "rooms") this.rooms = message.rooms;
    if (message.t === "error") {
      this.error = message.error.toUpperCase();
      this.phase = "error";
    }
    if (message.t === "start") {
      const local = message.members.find((member) => member.id === this.context.id);
      if (!local) throw new Error("start message omitted local member");
      const config = startConfig(message.config, message.seed);
      const room = this.context.room;
      if (!room) throw new Error("start message outside a room");
      const telemetry = new MatchTelemetry({ room: { code: room.code, trace: room.trace ?? null }, config: config.match, members: message.members, localSlot: local.slot, inputDelay: config.inputDelay, bundles: config.bundles });
      // every client loads every participant's fighter first; the netcode's input resend covers the skew
      this.phase = "loading";
      const urls = config.bundles.filter(Boolean);
      const loads = urls.map((url) => fighterLoad(url));
      telemetry.loading(urls);
      void Promise.all(loads.map((l) => l.promise)).then(() => {
        telemetry.loaded(loads.map((l, i) => ({ url: urls[i], state: l.state, error: l.error, ms: l.ms })));
        const failed = loads.find((l) => l.state === "failed");
        if (failed) {
          telemetry.finish("load failed");
          this.error = `A FIGHTER DIDN'T LOAD: ${failed.error}`;
          this.phase = "error";
          return;
        }
        this.nextScreen = OnlineScreen.matchScreen(this.onExit, this.context, { config: config.match, bundles: config.bundles, members: message.members, localSlot: local.slot, device: this.device, inputDelay: config.inputDelay, telemetry });
      });
    }
    // bundle switches outside a match: the host answers at once, everyone swaps carrying the room
    if (message.t === "game" && this.context.room?.host === this.context.id) this.context.transport.sendLobby({ t: "gameAt", hash: message.hash, frame: 0 });
    if (message.t === "gameAt" && message.hash !== swap.hash) {
      this.dispose();
      this.context.mesh?.release();
      swap.request(message.hash, { transport: this.context.transport, mesh: this.context.mesh, id: this.context.id, room: this.context.room });
    }
  }

  private drawCreate(ctx: CanvasRenderingContext2D): void {
    const items = [
      ["PUBLIC", "Anyone can find it in JOIN ROOM, or land in it from QUICK MATCH"],
      ["PRIVATE", "Only people with the four-letter code can get in"],
    ];
    items.forEach(([name, description], index) => {
      const y = 280 + index * 190;
      if (hover(VIEW_W / 2 - 360, y, 720, 140)) { this.sel = index; document.body.style.cursor = "pointer"; }
      if (clicked(VIEW_W / 2 - 360, y, 720, 140)) this.create(index === 0);
      const selected = index === this.sel;
      card(ctx, VIEW_W / 2 - 360, y, 720, 140, INK, selected);
      title(ctx, name, VIEW_W / 2, y + 66, 44, INK);
      label(ctx, description, VIEW_W / 2, y + 110, 21, selected ? INK : "rgba(41,39,34,0.8)");
    });
    if (backButton(ctx)) goTo(this.exit());
    hint(ctx, "click, or up/down + Enter · Esc: back");
  }

  private drawJoin(ctx: CanvasRenderingContext2D): void {
    const x = VIEW_W / 2 - 480, w = 960;
    const rows = this.rooms.slice(0, LIST_MAX);
    if (!rows.length) label(ctx, "no public lobbies right now", VIEW_W / 2, LIST_Y + 120, 30, PENCIL);
    rows.forEach((room, i) => {
      const y = LIST_Y + i * ROW_H;
      if (hover(x, y, w, ROW_H - 14)) { this.sel = i; document.body.style.cursor = "pointer"; }
      if (clicked(x, y, w, ROW_H - 14)) this.join(room.code);
      card(ctx, x, y, w, ROW_H - 14, INK, i === this.sel);
      label(ctx, `${room.host}'s lobby`, x + 28, y + 45, 28, INK, "left", 900);
      label(ctx, room.members.join(" · "), x + w - 28, y + 45, 22, PENCIL, "right", 700, w / 2);
    });
    const onCode = this.sel >= rows.length;
    label(ctx, "OR ENTER A ROOM CODE", VIEW_W / 2, CODE_Y - 20, 26, onCode ? INK : PENCIL);
    this.code.forEach((char, index) => {
      const cx = VIEW_W / 2 - 330 + index * 130;
      if (clicked(cx, CODE_Y, 100, 120)) { this.codePos = index; this.sel = rows.length; }
      card(ctx, cx, CODE_Y, 100, 120, INK, onCode && index === this.codePos);
      title(ctx, char, cx + 50, CODE_Y + 84, 64, INK);
    });
    if (button(ctx, VIEW_W / 2 + 200, CODE_Y + 22, 180, 76, "JOIN", { key: "Enter", size: 30, focused: onCode })) this.join(this.code.join(""));
    if (backButton(ctx)) goTo(this.exit());
    hint(ctx, "click a lobby, or type a code · Esc: back");
  }

  private drawWaiting(ctx: CanvasRenderingContext2D): void {
    title(ctx, "CONNECTING…", VIEW_W / 2, VIEW_H / 2, 70, INK);
    if (button(ctx, VIEW_W / 2 - 120, VIEW_H / 2 + 80, 240, 70, "CANCEL", { key: "Esc", size: 26 })) goTo(this.exit());
  }

  private drawLobby(ctx: CanvasRenderingContext2D): void {
    const room = this.context.room;
    if (!room) throw new Error("lobby phase without room state");
    if (this.picker && this.phase === "lobby") {
      const host = room.members.find((member) => member.id === room.host);
      this.onPicker(this.picker.draw(ctx, this.t, `${host?.name ?? "the host"} is picking the stage`));
      return;
    }
    if (this.context.hidden) title(ctx, "VS BOTS", VIEW_W / 2, SETUP.titleY, 52);
    else {
      title(ctx, `ROOM ${room.code}`, VIEW_W / 2, SETUP.titleY, 52);
      label(ctx, room.public ? "public" : "private", VIEW_W / 2 + 190, SETUP.titleY - 4, 24, PENCIL, "left");
    }
    const me = room.members.find((candidate) => candidate.id === this.context.id);
    const picked = this.shelf.draw(ctx, this.t, me?.fighter ?? null, !me || me.ready || this.phase !== "lobby");
    if (picked) { this.pick(picked); this.focus = "fighter"; sfx.menuMove(); }
    const { slotY, slotH } = SETUP, slotW = slotWidth(SLOTS);
    const bots = room.bots ?? [];
    const hosting = room.host === this.context.id && this.phase === "lobby";
    for (let slot = 0; slot < SLOTS; slot++) {
      const member = room.members.find((candidate) => candidate.slot === slot);
      const bot = slot >= room.members.length ? bots[slot - room.members.length] : undefined;
      if (bot) { this.drawBot(ctx, slot, slot - room.members.length, bot, hosting); continue; }
      if (!member) {
        // the first free slot is where the host adds a bot; people joining take bots' places
        if (hosting && slot === room.members.length + bots.length) {
          if (button(ctx, slotX(slot, SLOTS), slotY, slotW, slotH, "+ ADD BOT", { size: 30, focused: this.focus === "addBot" })) this.addBot();
        } else drawEmptySlot(ctx, slot, this.context.hidden ? "" : "WAITING", SLOTS);
        continue;
      }
      const x = drawSlotCard(ctx, slot, `${member.name}${member.id === room.host && room.members.length > 1 ? " · HOST" : ""}`, this.slotFighter(member), { ready: member.ready, focused: member.id === this.context.id && this.focus === "fighter", count: SLOTS });
      const mine = member.id === this.context.id && this.phase === "lobby";
      if (mine && !this.alone()) {
        if (button(ctx, x + 40, slotY + slotH - 84, slotW - 80, 64, member.ready ? "UNREADY" : "READY", { key: "Enter", size: 26, focused: this.focus === "ready" })) this.toggleReady();
      } else if (!mine) label(ctx, member.ready ? "READY" : "CHOOSING", x + slotW / 2, slotY + slotH - 42, 24);
    }
    if (this.phase === "loading") {
      label(ctx, `loading ${".".repeat(1 + (Math.floor(this.t * 3) % 3))}`, VIEW_W / 2, ACTION_Y + 46, 36, PENCIL);
      return;
    }
    const canStart = this.canStart();
    const isHost = room.host === this.context.id;
    const by = ACTION_Y;
    if (isHost) {
      if (button(ctx, VIEW_W / 2 - 170, by, 340, 84, "START", { key: "Enter", size: 36, focused: this.focus === "start", disabled: !canStart })) this.openStagePick();
    } else label(ctx, canStart ? "waiting for the host to press START" : "everyone readies up, then the host starts", VIEW_W / 2, by + 52, 24, INK);
    if (button(ctx, 40, VIEW_H - 100, 200, 64, this.context.hidden ? "BACK" : "LEAVE", { key: "Esc", size: 26, focused: this.focus === "leave" })) this.leave();
    const fighters = room.members.length + bots.length;
    const friends = bots.some((b) => b.level === 0);
    const kb2 = bots.some((b) => b.level === 0 && b.device === "kb2");
    hint(ctx, friends && !this.alone() ? "friends on this computer can only play local games for now: remove them to play online"
      : kb2 ? p2Keys()
      : isHost && !canStart ? (fighters < 2 ? "add a bot, or a friend: press . (keyboard 2) or A on another controller" : "START unlocks when everyone is ready")
      : isHost && room.members.length + bots.length < SLOTS ? "a friend here can join: press . (keyboard 2) or A on another controller" : "click a character, or left/right, to pick");
  }

  /** A bot's card: the host steps its fighter and level and can remove it; everyone else just sees it. */
  private drawBot(ctx: CanvasRenderingContext2D, slot: number, i: number, bot: RoomBot, isHost: boolean): void {
    const { slotY, slotH } = SETUP, slotW = slotWidth(SLOTS);
    const friend = bot.level === 0;
    const who = friend ? `PLAYER ${slot + 1}` : `CPU ${(this.context.room?.bots ?? []).slice(0, i + 1).filter((b) => b.level > 0).length}`;
    const x = drawSlotCard(ctx, slot, who, this.botFighter(bot), { focused: isHost && this.focus === `botFighter:${i}`, count: SLOTS });
    const ly = slotY + 392;
    if (friend) {
      label(ctx, bot.device === "kb2" ? "keyboard 2" : `pad ${Number(bot.device?.slice(3) ?? 0) + 1}`, x + slotW / 2, ly, 24, PENCIL, "center", 800);
      if (isHost) {
        const d = arrows(ctx, x + slotW / 2, slotY + 180, slotW / 2 - 34, 40);
        if (d) this.stepBotFighter(i, d);
        if (button(ctx, x + slotW / 2 - 80, slotY + slotH - 58, 160, 44, "REMOVE", { size: 20 })) this.removeBot(i);
      }
      return;
    }
    label(ctx, tierName(bot.level), x + slotW / 2, ly, 26, isHost && this.focus === `botLevel:${i}` ? INK : PENCIL, "center", 900);
    if (!isHost) return;
    const d = arrows(ctx, x + slotW / 2, slotY + 180, slotW / 2 - 34, 40);
    if (d) { this.focus = `botFighter:${i}`; this.stepBotFighter(i, d); }
    const l = arrows(ctx, x + slotW / 2, ly, slotW / 2 - 40, 30);
    if (l) { this.focus = `botLevel:${i}`; this.stepBotLevel(i, l); }
    if (button(ctx, x + slotW / 2 - 80, slotY + slotH - 58, 160, 44, "REMOVE", { size: 20 })) this.removeBot(i);
  }

  private botFighter(bot: RoomBot): SlotFighter {
    const load = isBundlePath(bot.bundleUrl, bot.fighter) ? fighterLoad(bot.bundleUrl) : null;
    const def = load?.state === "ready" ? roster[bot.fighter] : null;
    return { def, name: def?.name ?? "", pending: load?.state === "failed" ? "didn't load" : "loading …" };
  }

  private slotFighter(member: RoomMember): SlotFighter {
    const load = isBundlePath(member.bundleUrl, member.fighter) ? fighterLoad(member.bundleUrl) : null;
    const def = load?.state === "ready" ? roster[member.fighter] : null;
    return { def, name: def?.name ?? "", pending: load?.state === "failed" ? "didn't load" : member.fighter ? "loading …" : "choosing" };
  }

  private drawError(ctx: CanvasRenderingContext2D): void {
    title(ctx, this.error, VIEW_W / 2, VIEW_H / 2, 62, "#ff4d2e");
    if (button(ctx, VIEW_W / 2 - 120, VIEW_H / 2 + 60, 240, 70, "BACK", { key: "Esc", size: 26 })) goTo(this.exit());
  }

  abandon(): void {
    this.dispose();
    this.context.mesh?.close();
    this.context.transport.close();
  }

  private exit(): Screen {
    this.dispose();
    this.context.mesh?.close();
    this.context.transport.close();
    return this.onExit();
  }

  private dispose(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers.length = 0;
  }
}

/** Keyboard 2's keys as bound now (they can change them in SETTINGS > CONTROLS). */
function p2Keys(): string {
  const b = bindingsOf("kb2");
  const k = (keys: string[]) => keys.map(keyName).join("/") || "—";
  const arrowKeys = b.up.join() === "ArrowUp" && b.left.join() === "ArrowLeft" && b.down.join() === "ArrowDown" && b.right.join() === "ArrowRight";
  return `keyboard 2: ${arrowKeys ? "arrows" : `${k(b.up)} ${k(b.left)} ${k(b.down)} ${k(b.right)}`} move · ${k(b.jump)} jump · ${k(b.attack)} attack · ${k(b.special)} special · ${k(b.shield)} shield`;
}
