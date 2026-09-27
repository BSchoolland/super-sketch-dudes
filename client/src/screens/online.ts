import type { MatchConfig } from "../../../shared/sim";
import type { SessionHandoff } from "../net/rollback";
import { roster } from "../../../shared/fighters/index";
import { isBundlePath } from "../../../shared/account";
import { account } from "../account";
import { fighterLoad } from "../gen";
import type { FighterChoice } from "../fighters";
import { CharacterShelf } from "./shelf";
import { StagePicker, type MatchSetup, type PickerAction } from "./stage";
import { ACTION_Y, SETUP, drawEmptySlot, drawSlotCard, type SlotFighter } from "./battle/slots";
import { PENCIL } from "../render/paper";
import { VIEW_H, VIEW_W } from "../render/camera";
import { consumeTypedChars, type DeviceId, type MenuInput } from "../input/devices";
import { sfx } from "../audio/audio";
import { WebSocketTransport, type PublicRoom, type RelayMessage, type RoomMember, type Unsubscribe } from "../net/transport";
import { NetVersusScreen, startConfig } from "./netversus";
import { MatchTelemetry } from "../telemetry/match";
import { swap, type Handoff } from "../handoff";
import { bg, card, hint, label, title, hover, clicked, arrows, button, backButton, goTo, type Screen, INK } from "./ui";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const LIST_Y = 170, ROW_H = 84, LIST_MAX = 5, CODE_Y = LIST_Y + LIST_MAX * ROW_H + 60;

/** How BATTLE sent you here. */
export type OnlineEntry = "quick" | "create" | "join";

type RoomState = Extract<RelayMessage, { t: "room" }>;
interface OnlineContext {
  transport: WebSocketTransport;
  id: number;
  room: RoomState | null;
}

export class OnlineScreen implements Screen {
  t = 0;
  sel = 0;
  phase: "create" | "join" | "waiting" | "lobby" | "loading" | "error";
  /** JOIN ROOM: the public rooms, refreshed every couple of seconds; `sel` indexes them, `rooms.length` is the code. */
  rooms: PublicRoom[] = [];
  private polled = -Infinity;
  code = ["A", "A", "A", "A"];
  codePos = 0;
  inputDelay = 2;
  /** The stage screen after the host's START: theirs to edit, everyone else's to watch. */
  private picker: StagePicker | null = null;
  error = "";
  /** keyboard focus in the lobby: 0 fighter, 1 ready, 2 start (host, when everyone is ready), 3 leave */
  focus = 1;
  nextScreen: Screen | null = null;
  private context: OnlineContext;
  private device: DeviceId = "kb1";
  private unsubscribers: Unsubscribe[] = [];
  /** What this player can pick in a room: their ready characters. */
  private shelf: CharacterShelf;
  private mine: FighterChoice | null;

  /** Pick up where another bundle left off: back in its room, and in its match if there was one. */
  static resume(onExit: () => Screen, h: Handoff): Screen {
    const context: OnlineContext = { transport: h.transport, id: h.id, room: h.room };
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
    return new NetVersusScreen({
      transport: context.transport,
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
      onLobby: (lobby) => { if (lobby.t === "room") context.room = lobby; },
      exit: (reason) => {
        if (reason === "closed") return onExit();
        if (context.room?.host === context.id) context.transport.sendLobby({ t: "end" });
        return new OnlineScreen(onExit, null, null, context);
      },
    });
  }

  /** `fighter` is the one to bring into the room; a room that's resumed keeps whatever was picked there. */
  constructor(private onExit: () => Screen, entry: OnlineEntry | null, fighter: FighterChoice | null, context?: OnlineContext) {
    this.shelf = new CharacterShelf(SETUP.shelfY);
    this.mine = this.shelf.choices.find((c) => c.id === fighter?.id) ?? null;
    if (this.mine) this.shelf.show(this.mine.id);
    this.context = context ?? { transport: new WebSocketTransport(), id: 0, room: null };
    if (this.context.room) this.phase = "lobby";
    else if (entry === "quick") { this.context.transport.sendLobby({ t: "quick" }); this.phase = "waiting"; }
    else if (entry === "create") this.phase = "create";
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
    if (m.from) this.device = m.from;
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
    this.bringFighter();
    if (!member.ready && (m.left || m.right)) this.pickFighter(m.right ? 1 : -1);
    const canStart = this.canStart();
    const isHost = room.host === this.context.id;
    const items = [0, 1, ...(isHost && canStart ? [2] : []), 3];
    if (m.up || m.down) {
      const i = Math.max(0, items.indexOf(this.focus));
      this.focus = items[(i + (m.down ? 1 : items.length - 1)) % items.length];
      sfx.menuMove();
    }
    if (isHost && canStart && this.focus === 1 && member.ready) this.focus = 2;
    if (m.confirm) {
      if (this.focus === 3) this.leave();
      else if (this.focus === 2 && isHost && canStart) this.openStagePick();
      else this.toggleReady();
    }
    if (m.back) this.leave();
    return null;
  }

  canStart(): boolean {
    const room = this.context.room;
    return !!room && room.members.length >= 2 && room.members.every((candidate) => candidate.ready);
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
    this.context.transport.sendLobby({ t: "picking", pick: new StagePicker(false).setup });
    sfx.menuConfirm();
  }

  private onPicker(action: PickerAction): void {
    const room = this.context.room;
    if (!room || !this.picker || !action) return;
    const isHost = room.host === this.context.id;
    if (action === "back") { if (isHost) this.context.transport.sendLobby({ t: "picking", pick: null }); else this.leave(); return; }
    if (isHost) this.startMatch(this.picker.setup);
  }

  private startMatch(setup: MatchSetup): void {
    this.context.transport.sendLobby({
      t: "start",
      config: { stage: setup.stage, rules: { stocks: setup.stocks, time: setup.time }, inputDelay: this.inputDelay },
    });
    sfx.go();
  }

  /** Follows the room onto and off the stage screen; the host's own picker is the one being mirrored. */
  private followPicking(room: RoomState): void {
    if (!room.picking || room.started) { this.picker = null; return; }
    const isHost = room.host === this.context.id;
    if (!this.picker) {
      this.picker = new StagePicker(!isHost, (setup) => this.context.transport.sendLobby({ t: "picking", pick: setup }));
      this.picker.show(room.picking);
    } else if (!isHost) this.picker.show(room.picking);
  }

  leave(): void {
    sfx.menuBack();
    goTo(this.exit());
  }

  private onMessage(message: RelayMessage): void {
    if (message.t === "hello") this.context.id = message.id;
    if (message.t === "room") {
      this.context.room = message;
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
      swap.request(message.hash, { transport: this.context.transport, id: this.context.id, room: this.context.room });
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
    title(ctx, `ROOM ${room.code}`, VIEW_W / 2, SETUP.titleY, 52);
    label(ctx, room.public ? "public" : "private", VIEW_W / 2 + 190, SETUP.titleY - 4, 24, PENCIL, "left");
    const me = room.members.find((candidate) => candidate.id === this.context.id);
    const picked = this.shelf.draw(ctx, this.t, me?.fighter ?? null, !me || me.ready || this.phase !== "lobby");
    if (picked) { this.pick(picked); this.focus = 0; sfx.menuMove(); }
    const { slotY, slotW, slotH } = SETUP;
    for (let slot = 0; slot < 4; slot++) {
      const member = room.members.find((candidate) => candidate.slot === slot);
      if (!member) { drawEmptySlot(ctx, slot, "WAITING"); continue; }
      const x = drawSlotCard(ctx, slot, `${member.name}${member.id === room.host ? " · HOST" : ""}`, this.slotFighter(member), this.t, { ready: member.ready });
      const mine = member.id === this.context.id && this.phase === "lobby";
      if (mine) {
        if (button(ctx, x + 40, slotY + slotH - 84, slotW - 80, 64, member.ready ? "UNREADY" : "READY", { key: "Enter", size: 26, focused: this.focus === 1 })) this.toggleReady();
      } else label(ctx, member.ready ? "READY" : "CHOOSING", x + slotW / 2, slotY + slotH - 42, 24);
    }
    if (this.phase === "loading") {
      label(ctx, `loading ${".".repeat(1 + (Math.floor(this.t * 3) % 3))}`, VIEW_W / 2, ACTION_Y + 46, 36, PENCIL);
      return;
    }
    const canStart = this.canStart();
    const isHost = room.host === this.context.id;
    const by = ACTION_Y;
    if (isHost) {
      if (button(ctx, VIEW_W / 2 - 170, by, 340, 84, "START", { key: "Enter", size: 36, focused: this.focus === 2, disabled: !canStart })) this.openStagePick();
      label(ctx, `input delay ${this.inputDelay}f`, VIEW_W / 2 + 330, by + 52, 20, "rgba(41,39,34,0.85)");
      const d = arrows(ctx, VIEW_W / 2 + 330, by + 52, 90, 22);
      if (d) { this.inputDelay = Math.max(1, Math.min(6, this.inputDelay + d)); sfx.menuMove(); }
    } else label(ctx, canStart ? "waiting for the host to press START" : "everyone readies up, then the host starts", VIEW_W / 2, by + 52, 24, INK);
    if (button(ctx, 40, VIEW_H - 100, 200, 64, "LEAVE", { key: "Esc", size: 26, focused: this.focus === 3 })) this.leave();
    hint(ctx, isHost && !canStart ? `START unlocks when everyone is ready (${room.members.length}/2+ players)` : "click a character, or left/right, to pick");
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
    this.context.transport.close();
  }

  private exit(): Screen {
    this.dispose();
    this.context.transport.close();
    return this.onExit();
  }

  private dispose(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers.length = 0;
  }
}

