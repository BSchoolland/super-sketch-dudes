import { TEAMS, smallestTeam, type MatchConfig } from "../../../shared/sim";
import type { SessionHandoff } from "../net/rollback";
import { roster } from "../../../shared/fighters/index";
import { isBundlePath } from "../../../shared/account";
import { account } from "../account";
import { fighterLoad } from "../gen";
import type { FighterChoice } from "../fighters";
import { StagePicker, type MatchSetup, type PickerAction } from "./stage";
import { CharacterSelect, type Seat, type SelectRoom } from "./battle/charselect";
import type { SlotFighter } from "./battle/slots";
import { SLOT_COLORS, TEAM_COLORS } from "../render/hud";
import { FONT, PENCIL } from "../render/paper";
import { fightBlock } from "../../../shared/lobby";
import { VIEW_H, VIEW_W } from "../render/camera";
import { consumeTypedChars, type DeviceId, type MenuInput } from "../input/devices";
import { touchInUse } from "../input/touch";
import { sfx } from "../audio/audio";
import { WebSocketTransport, type PublicRoom, type RelayMessage, type RoomBot, type RoomMember, type Unsubscribe } from "../net/transport";
import { allChoices } from "../fighters";
import { CPU_TIERS, DEFAULT_TIER } from "../../../shared/cpu-skill";
import { localMatch } from "./localmatch";
import { bindingsOf, keyName, type Keyboard } from "../input/bindings";
import { NetVersusScreen, startConfig } from "./netversus";
import { MatchTelemetry } from "../telemetry/match";
import { swap, type Handoff } from "../handoff";
import { MESH_VERSION, roomMesh, type PeerMesh } from "../net/mesh";
import { activity } from "../activity";
import { bg, card, hint, keyHint, keysInHand, label, title, hover, clicked, button, backButton, goTo, grow, small, tapWord, settings, saveSettings, type Screen, INK } from "./ui";
import { TextField } from "./textfield";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/** JOIN ROOM's list of public lobbies and the code under it; a small screen has fewer, taller rows. */
const LIST_Y = 170;
const joinLayout = (): { rowH: number; rows: number; codeY: number } => {
  const rowH = small() ? 116 : 84, rows = small() ? 4 : 5;
  return { rowH, rows, codeY: LIST_Y + rows * rowH + 60 };
};

/**
 * How BATTLE sent you here. VS BOTS ("bots") and SAME KEYBOARD ("local") are private rooms that never show their code;
 * "call" is the Discord Activity's room.
 */
export type OnlineEntry = "call" | "quick" | "create" | "join" | "bots" | "local";

type RoomState = Extract<RelayMessage, { t: "room" }>;
interface OnlineContext {
  transport: WebSocketTransport;
  /** Peer-to-peer links to the room's members; null where the browser has no WebRTC (everything goes by the relay). */
  mesh: PeerMesh | null;
  id: number;
  room: RoomState | null;
  /** VS BOTS or SAME KEYBOARD: the room's code isn't shown, and it starts with a bot, or a friend on keyboard 2, in it. */
  hidden?: "bots" | "local";
}

/** The links a swap handed over, if this bundle speaks their version; else fresh ones (the old ones close). */
function adoptMesh(h: Handoff, context: OnlineContext): PeerMesh | null {
  const handed = h.mesh;
  if (handed && handed.version === MESH_VERSION) { handed.adopt(); return handed; }
  handed?.close();
  return roomMesh(context.transport, () => context.id);
}

const SLOTS = 6;
/** The lobby's title: its baseline, and how big. */
const TITLE_Y = 97, TITLE_SIZE = 64;

export class OnlineScreen implements Screen {
  t = 0;
  sel = 0;
  phase: "create" | "join" | "waiting" | "lobby" | "loading" | "error";
  /** JOIN ROOM: the public rooms, refreshed every couple of seconds; `sel` indexes them, `rooms.length` is the code. */
  rooms: PublicRoom[] = [];
  private polled = -Infinity;
  code = ["A", "A", "A", "A"];
  codePos = 0;
  /** The stage screen after FIGHT!: the host's to edit, everyone else's to watch. */
  private picker: StagePicker | null = null;
  error = "";
  /** What "waiting" is waiting on. */
  private waitingFor = "CONNECTING…";
  /** Why this VS BOTS room isn't the call's (it was full). */
  private notice = "";
  nextScreen: Screen | null = null;
  private context: OnlineContext;
  private device: DeviceId = "kb1";
  private unsubscribers: Unsubscribe[] = [];
  /** The roster, the slots' cards and their tokens. */
  readonly select: CharacterSelect;
  /** The fighter picked on the way in, put on for you once you're in the room. */
  private bring: FighterChoice | null;
  /** JOIN ROOM's code on a touchscreen: an <input> laid unseen over the code boxes, so a tap raises the phone's keyboard. */
  private codeField: TextField | null = null;

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
    this.bring = fighter;
    this.select = new CharacterSelect(() => this.selectRoom(), {
      pick: (seat, choice) => (seat.bot ? this.pickBot(seat.bot.index, choice) : this.pick(choice)),
      fight: () => this.fight(),
      addBot: () => this.addBot(),
      removeBot: (i) => this.removeBot(i),
      stepLevel: (i, d) => this.stepBotLevel(i, d),
      stepTeam: (seat, d) => (seat.bot ? this.stepBotTeam(seat.bot.index, d) : this.stepTeam(d)),
      toggleTeams: () => this.toggleTeams(),
      leave: () => this.leave(),
    });
    if (context) this.context = context;
    else {
      this.context = { transport: new WebSocketTransport(), mesh: null, id: 0, room: null };
      this.context.mesh = roomMesh(this.context.transport, () => this.context.id);
    }
    if (this.context.room) this.phase = "lobby";
    else if (entry === "call") {
      if (!activity) throw new Error("the call's room outside the Discord Activity");
      this.context.transport.sendLobby({ t: "call", key: activity.key });
      this.phase = "waiting";
    } else if (entry === "quick") { this.context.transport.sendLobby({ t: "quick" }); this.phase = "waiting"; }
    else if (entry === "create") this.phase = "create";
    else if (entry === "bots" || entry === "local") { this.context.hidden = entry; this.context.transport.sendLobby({ t: "create", public: false }); this.phase = "waiting"; }
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
    if (account.session) this.context.transport.sendLobby({ t: "name", session: account.session });
  }

  update(dt: number, m: MenuInput): Screen | null {
    this.t += dt;
    // the arrows (keyboard 2) are a friend's side of the keyboard: whoever uses them in the menus is still keyboard 1
    if (m.from && !this.friendDevice(m.from)) this.device = m.from === "kb2" ? "kb1" : m.from;
    // the touch controls play as keyboard 1
    if (touchInUse()) this.device = "kb1";
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

  lobbyDebug(): { code: string; members: { fighter: string }[]; bots: { fighter: string }[] } | null {
    const room = this.context.room;
    return room ? { code: room.code, members: room.members.map((member) => ({ fighter: member.fighter })), bots: (room.bots ?? []).map((b) => ({ fighter: b.fighter })) } : null;
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
    this.syncCodeField();
    if (this.t - this.polled > 2) { this.polled = this.t; this.context.transport.sendLobby({ t: "rooms" }); }
    const rows = Math.min(joinLayout().rows, this.rooms.length);
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

  /** The code's <input> while JOIN ROOM is up on a touchscreen; typing into it fills the boxes. */
  private syncCodeField(): void {
    if (this.phase !== "join" || keysInHand()) { this.dropCodeField(); return; }
    if (this.codeField) return;
    const field = new TextField({
      maxLength: 4, upper: true, quiet: true,
      onSubmit: () => { field.el.blur(); this.join(this.code.join("")); },
      onCancel: () => field.el.blur(),
    });
    this.codeField = field;
    field.el.style.opacity = "0";
    // the boxes start empty, to be typed into
    this.code = ["", "", "", ""];
    this.codePos = 0;
    field.el.addEventListener("input", () => {
      const chars = [...field.value.toUpperCase()].filter((c) => CODE_CHARS.includes(c)).slice(0, 4);
      field.value = chars.join("");
      this.code = [0, 1, 2, 3].map((i) => chars[i] ?? "");
      this.codePos = Math.min(chars.length, 3);
      this.sel = Math.min(joinLayout().rows, this.rooms.length);
    });
  }

  private dropCodeField(): void {
    this.codeField?.remove();
    this.codeField = null;
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
    if (!room.members.some((candidate) => candidate.id === this.context.id)) throw new Error("local member missing from room");
    if (this.picker) { this.onPicker(this.picker.update(m)); return null; }
    if (this.friendInput(m)) return null;
    this.bringFighter();
    this.select.update(m);
    return null;
  }

  /** The room as the character select draws it: its members in slot order, then its bots. */
  private selectRoom(): SelectRoom {
    const room = this.context.room;
    if (!room) throw new Error("character select without a room");
    const hosting = room.host === this.context.id && this.phase === "lobby";
    const bots = room.bots ?? [];
    const color = (slot: number, team: number) => (room.teams ? TEAM_COLORS[team] : SLOT_COLORS[slot]);
    const seats: Seat[] = [...room.members].sort((a, b) => a.slot - b.slot).map((member, slot) => ({
      key: `m${member.id}`,
      who: `${member.name}${member.id === room.host && room.members.length > 1 ? " · HOST" : ""}`,
      tag: `P${slot + 1}`,
      color: color(slot, member.team),
      team: member.team,
      fighter: member.fighter,
      card: cardFighter(member.fighter, member.bundleUrl),
      ours: member.id === this.context.id,
      mine: member.id === this.context.id,
    }));
    const cpus = bots.filter((b) => b.level > 0).length;
    let cpu = 0;
    bots.forEach((b, index) => {
      const slot = seats.length, friend = b.level === 0;
      if (!friend) cpu++;
      seats.push({
        key: `b${index}`,
        who: friend ? `PLAYER ${slot + 1}` : `CPU ${cpu}`,
        tag: friend ? `P${slot + 1}` : cpus > 1 ? `CPU${cpu}` : "CPU",
        color: color(slot, b.team),
        team: b.team,
        fighter: b.fighter,
        card: cardFighter(b.fighter, b.bundleUrl),
        ours: hosting,
        mine: false,
        bot: { index, level: b.level, ...(friend ? { device: (b.device ?? "kb2") as DeviceId } : {}) },
      });
    });
    return {
      seats,
      teams: room.teams,
      host: hosting,
      canAdd: hosting && seats.length < SLOTS,
      block: fightBlock({ members: room.members, bots, teams: room.teams }),
      loading: this.phase !== "lobby",
      back: this.context.hidden ? "BACK" : room.call ? "MENU" : "LEAVE",
    };
  }

  /** Every slot has a fighter, on two teams at least in a team battle; friends here can't go online yet. */
  canFight(): boolean {
    const room = this.context.room;
    return !!room && fightBlock({ members: room.members, bots: room.bots ?? [], teams: room.teams }) === null;
  }

  /** The friend on this computer playing with `device`, if any. */
  private friendDevice(device: DeviceId): RoomBot | undefined {
    return (this.context.room?.bots ?? []).find((b) => b.level === 0 && b.device === device);
  }

  /**
   * Keyboard 2 and the pads belong to friends on this computer: attack or jump on one nobody has drops a friend in;
   * a friend moves their own highlight over the roster. True when the input was a friend's.
   */
  private friendInput(m: MenuInput): boolean {
    const room = this.context.room;
    const from = m.from;
    if (!room || room.host !== this.context.id || !from || from === this.device) return false;
    if (from !== "kb2" && !from.startsWith("pad")) return false;
    const seat = this.selectRoom().seats.find((s) => s.bot?.device === from);
    if (!seat) {
      if (!m.confirm) return false;
      this.addFriend(from);
      return true;
    }
    this.select.updateFriend(seat, m);
    return m.left || m.right || m.back || m.up || m.down || m.confirm || m.start;
  }

  /** The side for a bot or friend arriving in a team battle (see smallestTeam); red outside one. */
  private arrivingTeam(): number {
    const room = this.context.room;
    if (!room?.teams) return 0;
    return smallestTeam([...room.members.map((m) => m.team), ...(room.bots ?? []).map((b) => b.team)]);
  }

  /** The host turns team battle on (everyone split red and blue) or off. */
  toggleTeams(): void {
    const room = this.context.room;
    if (!room || room.host !== this.context.id) return;
    this.context.transport.sendLobby({ t: "teams", on: !room.teams });
    sfx.menuConfirm();
  }

  /** Moves this player to the next (or previous) team. */
  private stepTeam(d: number): void {
    const me = this.context.room?.members.find((m) => m.id === this.context.id);
    if (!me) return;
    this.context.transport.sendLobby({ t: "team", team: (me.team + d + TEAMS) % TEAMS });
    sfx.menuMove();
  }

  private stepBotTeam(i: number, d: number): void {
    const bots = [...(this.context.room?.bots ?? [])];
    if (!bots[i]) return;
    bots[i] = { ...bots[i], team: (bots[i].team + d + TEAMS) % TEAMS };
    this.sendBots(bots);
    sfx.menuMove();
  }

  /** A friend on this computer playing with `device`, their token in hand. */
  private addFriend(device: DeviceId): void {
    const room = this.context.room;
    if (!room || room.host !== this.context.id) return;
    const bots = room.bots ?? [];
    if (room.members.length + bots.length >= SLOTS) return;
    this.sendBots([...bots, { fighter: "", bundleUrl: "", level: 0, team: this.arrivingTeam(), device }]);
    sfx.menuConfirm();
  }

  /** What a host can give a bot: the house fighters, then their own. */
  private botChoices(): FighterChoice[] {
    const { house, mine } = allChoices();
    return [...house, ...mine];
  }

  /** The room's new bot list, here at once (the relay's copy follows). */
  private sendBots(bots: RoomBot[]): void {
    if (this.context.room) this.context.room.bots = bots;
    this.context.transport.sendLobby({ t: "bots", bots });
  }

  /** A new bot, its token in hand, at the level last used. */
  addBot(): void {
    const room = this.context.room;
    if (!room || room.host !== this.context.id) return;
    const bots = room.bots ?? [];
    if (room.members.length + bots.length >= SLOTS) return;
    this.sendBots([...bots, { fighter: "", bundleUrl: "", level: settings.cpuTier || DEFAULT_TIER, team: this.arrivingTeam() }]);
    sfx.menuConfirm();
  }

  removeBot(i: number): void {
    const bots = [...(this.context.room?.bots ?? [])];
    bots.splice(i, 1);
    this.sendBots(bots);
    sfx.menuBack();
  }

  /** The host puts bot `i`'s token on `choice`, or (null) takes it back. */
  pickBot(i: number, choice: FighterChoice | null): void {
    const room = this.context.room;
    const bots = [...(room?.bots ?? [])];
    if (!room || room.host !== this.context.id || !bots[i]) return;
    bots[i] = { ...bots[i], fighter: choice?.id ?? "", bundleUrl: choice?.bundleUrl ?? "" };
    this.sendBots(bots);
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

  /** Arriving in a room: the fighter picked on the way in goes on for you, once. */
  private bringFighter(): void {
    const me = this.context.room?.members.find((member) => member.id === this.context.id);
    if (!me || !this.bring) return;
    if (!me.fighter) this.pick(this.bring);
    this.bring = null;
  }

  /** Your token on `choice`, or (null) back in your hand; the room shows it at once, the relay's copy follows. */
  pick(choice: FighterChoice | null): void {
    const me = this.context.room?.members.find((member) => member.id === this.context.id);
    if (me) { me.fighter = choice?.id ?? ""; me.bundleUrl = choice?.bundleUrl ?? ""; }
    this.context.transport.sendLobby({ t: "pick", fighter: choice?.id ?? "", bundleUrl: choice?.bundleUrl ?? "" });
  }

  /** FIGHT!, from anyone in the room: the host opens the stage screen, a guest asks the host's to. */
  fight(): void {
    const room = this.context.room;
    if (!room || this.phase !== "lobby" || this.picker || !this.canFight()) return;
    if (room.host === this.context.id) { this.openStagePick(); return; }
    this.context.transport.sendLobby({ t: "fight" });
    sfx.menuConfirm();
  }

  /** The host's FIGHT! (or a guest's, passed on by the relay): everyone moves to the stage screen, the host picking. */
  openStagePick(): void {
    const room = this.context.room;
    if (!room || room.host !== this.context.id || room.picking || this.picker || !this.canFight()) return;
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
    const choices = this.botChoices();
    const me = room.members.find((m) => m.id === this.context.id);
    if (!me) throw new Error("local start without the host in the room");
    // the room's pick, not this.mine: a lobby rebuilt after a match hasn't loaded its shelf yet
    if (!me.fighter || !me.bundleUrl) throw new Error("local start without a fighter");
    const mine = choices.find((c) => c.id === me.fighter) ?? { id: me.fighter, name: "", bundleUrl: me.bundleUrl, house: false, entry: null };
    const bots = (room.bots ?? []).map((b) => ({
      fighter: choices.find((c) => c.id === b.fighter) ?? { id: b.fighter, name: "", bundleUrl: b.bundleUrl, house: false, entry: null },
      source: b.level === 0 ? { device: (b.device ?? "kb2") as DeviceId, cpu: 0 } : { device: null, cpu: b.level },
      team: b.team,
    }));
    this.context.transport.sendLobby({ t: "local" });
    sfx.go();
    const context = this.context, onExit = this.onExit;
    this.nextScreen = localMatch([{ fighter: mine, source: { device: this.device, cpu: 0 }, team: me.team }, ...bots], setup, () => {
      context.transport.sendLobby({ t: "end" });
      return new OnlineScreen(onExit, null, null, context);
    }, room.teams);
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
      // VS BOTS opens with one bot waiting, SAME KEYBOARD with a friend on keyboard 2
      if (this.context.hidden && !this.context.room && message.host === this.context.id && !message.bots?.length) {
        const hidden = this.context.hidden;
        queueMicrotask(() => (hidden === "local" ? this.addFriend("kb2") : this.addBot()));
      }
      this.context.room = message;
      this.context.mesh?.members(message.members.map((m) => m.id));
      if (this.phase !== "loading") this.phase = "lobby";
      this.followPicking(message);
      this.bringFighter();
    }
    // someone else's FIGHT!, sent to the host
    if (message.t === "fight") this.openStagePick();
    if (message.t === "rooms") this.rooms = message.rooms;
    if (message.t === "waiting") this.waitingFor = "MATCH IN PROGRESS";
    // more people opened the game than a room holds: this one plays bots on their own
    if (message.t === "full") {
      this.context.hidden = "bots";
      this.notice = "the call's room is full";
      this.context.transport.sendLobby({ t: "create", public: false });
    }
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
      label(ctx, description, VIEW_W / 2, y + 110, grow(21, 11), selected ? INK : "rgba(41,39,34,0.8)", "center", 700, 680);
    });
    if (backButton(ctx)) goTo(this.exit());
    keyHint(ctx, "click, or up/down + Enter · Esc: back");
  }

  private drawJoin(ctx: CanvasRenderingContext2D): void {
    const { rowH, rows: most, codeY } = joinLayout();
    const x = VIEW_W / 2 - 480, w = 960, h = rowH - 14;
    const rows = this.rooms.slice(0, most);
    if (!rows.length) label(ctx, "no public lobbies right now", VIEW_W / 2, LIST_Y + 120, grow(30, 12), PENCIL);
    const name = grow(28, 13), who = grow(22, 11);
    rows.forEach((room, i) => {
      const y = LIST_Y + i * rowH;
      if (hover(x, y, w, h)) { this.sel = i; document.body.style.cursor = "pointer"; }
      if (clicked(x, y, w, h)) this.join(room.code);
      card(ctx, x, y, w, h, INK, i === this.sel);
      label(ctx, `${room.host}'s lobby`, x + 28, y + h / 2 + 10 + (name - 28) * 0.36, name, INK, "left", 900, w / 2 - 40);
      label(ctx, room.members.join(" · "), x + w - 28, y + h / 2 + 10 + (who - 22) * 0.36, who, PENCIL, "right", 700, w / 2);
    });
    const field = this.codeField, typing = !!field && document.activeElement === field.el;
    const onCode = this.sel >= rows.length || typing;
    label(ctx, field ? "OR TAP TO ENTER A ROOM CODE" : "OR ENTER A ROOM CODE", VIEW_W / 2, codeY - 20, grow(26, 12), onCode ? INK : PENCIL);
    this.code.forEach((char, index) => {
      const cx = VIEW_W / 2 - 330 + index * 130;
      if (clicked(cx, codeY, 100, 120)) { this.codePos = index; this.sel = rows.length; }
      card(ctx, cx, codeY, 100, 120, INK, onCode && index === this.codePos);
      title(ctx, char, cx + 50, codeY + 84, 64, INK);
    });
    field?.place(VIEW_W / 2 - 330, codeY, 3 * 130 + 100, 120, 64);
    const join = small() ? { x: VIEW_W / 2 + 200, y: codeY, w: 240, h: 120, size: 40 } : { x: VIEW_W / 2 + 200, y: codeY + 22, w: 180, h: 76, size: 30 };
    if (button(ctx, join.x, join.y, join.w, join.h, "JOIN", { key: "Enter", size: join.size, focused: onCode })) this.join(this.code.join(""));
    if (backButton(ctx)) goTo(this.exit());
    keyHint(ctx, "click a lobby, or type a code · Esc: back");
  }

  private drawWaiting(ctx: CanvasRenderingContext2D): void {
    title(ctx, this.waitingFor, VIEW_W / 2, VIEW_H / 2, 70, INK);
    if (this.waitingFor !== "CONNECTING…") label(ctx, "you're in when it ends", VIEW_W / 2, VIEW_H / 2 + 50, grow(28, 12), PENCIL);
    const b = small() ? { w: 320, h: 120, size: 40 } : { w: 240, h: 70, size: 26 };
    if (button(ctx, VIEW_W / 2 - b.w / 2, VIEW_H / 2 + 100, b.w, b.h, "CANCEL", { key: "Esc", size: b.size })) goTo(this.exit());
  }

  private drawLobby(ctx: CanvasRenderingContext2D): void {
    const room = this.context.room;
    if (!room) throw new Error("lobby phase without room state");
    if (this.picker && this.phase === "lobby") {
      const host = room.members.find((member) => member.id === room.host);
      this.onPicker(this.picker.draw(ctx, this.t, `${host?.name ?? "the host"} is picking the stage`));
      return;
    }
    const [head, aside] = this.context.hidden
      ? [this.context.hidden === "local" ? "SAME KEYBOARD" : "VS BOTS", this.notice]
      : room.call ? ["THIS CALL", `room ${room.code}`] : [`ROOM ${room.code}`, room.public ? "public" : "private"];
    title(ctx, head, VIEW_W / 2, TITLE_Y, TITLE_SIZE);
    if (aside) {
      ctx.font = `900 ${TITLE_SIZE}px ${FONT}`;
      label(ctx, aside, VIEW_W / 2 + ctx.measureText(head).width / 2 + 40, TITLE_Y - 6, grow(24, 11), PENCIL, "left");
    }
    this.select.draw(ctx, this.t);
    if (this.phase !== "lobby") return;
    const bots = room.bots ?? [];
    const block = fightBlock({ members: room.members, bots, teams: room.teams });
    if (block === "friends online") hint(ctx, "friends on this computer can only play local games for now: remove them to play online");
    else if (block === "one team") hint(ctx, `everyone's on one team: ${tapWord()} a team to switch sides`);
    // a friend on keyboard 2: both players' keys, between BACK and TEAMS
    else if (room.members.length === 1 && bots.some((b) => b.level === 0 && b.device === "kb2") && keysInHand()) {
      label(ctx, keysOf("kb1"), VIEW_W / 2, VIEW_H - 40, 20, "rgba(41,39,34,0.8)");
      label(ctx, keysOf("kb2"), VIEW_W / 2, VIEW_H - 14, 20, "rgba(41,39,34,0.8)");
    }
  }

  private drawError(ctx: CanvasRenderingContext2D): void {
    title(ctx, this.error, VIEW_W / 2, VIEW_H / 2, 62, "#ff4d2e", "center", small() ? VIEW_W - 120 : undefined);
    const b = small() ? { w: 320, h: 120, size: 40 } : { w: 240, h: 70, size: 26 };
    if (button(ctx, VIEW_W / 2 - b.w / 2, VIEW_H / 2 + 60, b.w, b.h, "BACK", { key: "Esc", size: b.size })) goTo(this.exit());
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
    this.dropCodeField();
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers.length = 0;
  }
}

/** A slot card's fighter: null while the token is in hand; `def` null while it loads. */
function cardFighter(fighter: string, bundleUrl: string): SlotFighter | null {
  if (!fighter) return null;
  const load = isBundlePath(bundleUrl, fighter) ? fighterLoad(bundleUrl) : null;
  const def = load?.state === "ready" ? roster[fighter] : null;
  return { def, name: (def?.name ?? "").toUpperCase(), pending: load?.state === "failed" ? "didn't load" : "loading …" };
}

/** A keyboard player's keys as bound now (they can change them in SETTINGS > CONTROLS). */
function keysOf(kb: Keyboard): string {
  const b = bindingsOf(kb);
  const k = (keys: string[]) => keys.map(keyName).join("/") || "—";
  const move = [b.up, b.left, b.down, b.right].map((keys) => keys.join()).join();
  const moveKeys = move === "ArrowUp,ArrowLeft,ArrowDown,ArrowRight" ? "arrows" : move === "KeyW,KeyA,KeyS,KeyD" ? "WASD" : `${k(b.up)} ${k(b.left)} ${k(b.down)} ${k(b.right)}`;
  return `keyboard ${kb === "kb1" ? 1 : 2}: ${moveKeys} move · ${k(b.jump)} jump · ${k(b.attack)} attack · ${k(b.special)} special · ${k(b.shield)} shield`;
}
