import type { MatchConfig } from "../../../shared/sim";
import type { SessionHandoff } from "../net/rollback";
import { roster } from "../../../shared/fighters/index";
import { isBundlePath } from "../../../shared/account";
import { account } from "../account";
import { fighterLoad } from "../gen";
import { allChoices, type FighterChoice } from "../fighters";
import { PENCIL } from "../render/paper";
import { VIEW_H, VIEW_W } from "../render/camera";
import { SLOT_COLORS } from "../render/hud";
import { consumeTypedChars, type DeviceId, type MenuInput } from "../input/devices";
import { sfx } from "../audio/audio";
import { WebSocketTransport, type RelayMessage, type RoomMember, type Unsubscribe } from "../net/transport";
import { drawFighterPortrait } from "./portrait";
import { NetVersusScreen, startConfig } from "./netversus";
import { swap, type Handoff } from "../handoff";
import { bg, card, hint, label, settings, title, hover, clicked, arrows, button, backButton, goTo, type Screen, INK } from "./ui";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

type RoomState = Extract<RelayMessage, { t: "room" }>;
interface OnlineContext {
  transport: WebSocketTransport;
  id: number;
  room: RoomState | null;
}

export class OnlineScreen implements Screen {
  t = 0;
  sel = 0;
  phase: "menu" | "code" | "waiting" | "lobby" | "loading" | "error";
  code = ["A", "A", "A", "A"];
  codePos = 0;
  inputDelay = 2;
  error = "";
  /** keyboard focus in the lobby: 0 fighter, 1 ready, 2 start (host, when everyone is ready), 3 leave */
  focus = 1;
  nextScreen: Screen | null = null;
  private context: OnlineContext;
  private device: DeviceId = "kb1";
  private unsubscribers: Unsubscribe[] = [];
  /** What this player can pick in a room: their library, then the house. */
  private choices: FighterChoice[];
  private mine: FighterChoice | null;

  /** Pick up where another bundle left off: back in its room, and in its match if there was one. */
  static resume(onExit: () => Screen, h: Handoff): Screen {
    const context: OnlineContext = { transport: h.transport, id: h.id, room: h.room };
    const screen = new OnlineScreen(onExit, null, context);
    if (!h.match) return screen;
    const m = h.match;
    screen.dispose();
    return OnlineScreen.matchScreen(onExit, context, { config: m.config, bundles: m.bundles, members: m.members, localSlot: m.localSlot, device: m.device, inputDelay: m.inputDelay, resume: m.session });
  }

  private static matchScreen(onExit: () => Screen, context: OnlineContext, m: { config: MatchConfig; bundles: string[]; members: Pick<RoomMember, "id" | "name" | "slot">[]; localSlot: number; device: DeviceId; inputDelay: number; resume?: SessionHandoff }): Screen {
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
      isHost: () => context.room?.host === context.id,
      roomState: () => context.room,
      localId: () => context.id,
      onLobby: (lobby) => { if (lobby.t === "room") context.room = lobby; },
      exit: (reason) => {
        if (reason === "closed") return onExit();
        if (context.room?.host === context.id) context.transport.sendLobby({ t: "end" });
        return new OnlineScreen(onExit, null, context);
      },
    });
  }

  /** `fighter` is the one picked on the way in; a room that's resumed keeps whatever was picked there. */
  constructor(private onExit: () => Screen, fighter: FighterChoice | null, context?: OnlineContext) {
    const { mine, house } = allChoices();
    this.choices = [...mine, ...house];
    if (fighter && !this.choices.some((c) => c.id === fighter.id)) this.choices.unshift(fighter);
    this.mine = fighter;
    this.context = context ?? { transport: new WebSocketTransport(), id: 0, room: null };
    this.phase = this.context.room ? "lobby" : "menu";
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
    if (this.phase === "menu") return this.updateMenu(m);
    if (this.phase === "code") return this.updateCode(m);
    if (this.phase === "waiting") {
      if (m.back) { this.context.transport.sendLobby({ t: "unqueue" }); this.phase = "menu"; }
      return null;
    }
    if (this.phase === "lobby") return this.updateLobby(m);
    if (this.phase === "loading") return null;
    if (m.back || m.confirm) return this.exit();
    return null;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    bg(ctx, this.t);
    title(ctx, "ONLINE", VIEW_W / 2, 90, 64);
    if (this.phase === "menu") this.drawMenu(ctx);
    else if (this.phase === "code") this.drawCode(ctx);
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

  private updateMenu(m: MenuInput): Screen | null {
    if (m.up) { this.sel = (this.sel + 2) % 3; sfx.menuMove(); }
    if (m.down) { this.sel = (this.sel + 1) % 3; sfx.menuMove(); }
    if (m.back) return this.exit();
    if (!m.confirm && !m.start) return null;
    sfx.menuConfirm();
    if (this.sel === 0) {
      this.context.transport.sendLobby({ t: "queue" });
      this.phase = "waiting";
    } else if (this.sel === 1) {
      this.context.transport.sendLobby({ t: "create" });
      this.phase = "waiting";
    } else {
      consumeTypedChars();
      this.code = ["A", "A", "A", "A"];
      this.codePos = 0;
      this.phase = "code";
    }
    return null;
  }

  private updateCode(m: MenuInput): Screen | null {
    let submit = false;
    const typed = consumeTypedChars();
    for (const char of typed) {
      if (char === "\n") {
        submit = true;
      } else if (char === "\b") {
        this.code[this.codePos] = "A";
        this.codePos = (this.codePos + 3) % 4;
      } else {
        this.code[this.codePos] = char;
        this.codePos = (this.codePos + 1) % 4;
      }
    }
    if (!typed.length && m.up) { this.codePos = (this.codePos + 3) % 4; sfx.menuMove(); }
    if (!typed.length && m.down) { this.codePos = (this.codePos + 1) % 4; sfx.menuMove(); }
    if (!typed.length && (m.left || m.right)) {
      const current = Math.max(0, CODE_CHARS.indexOf(this.code[this.codePos]));
      this.code[this.codePos] = CODE_CHARS[(current + (m.right ? 1 : CODE_CHARS.length - 1)) % CODE_CHARS.length];
      sfx.menuMove();
    }
    if (submit || (!typed.length && (m.confirm || m.start))) {
      this.context.transport.sendLobby({ t: "join", code: this.code.join("") });
      this.phase = "waiting";
    }
    if (!typed.length && m.back) this.phase = "menu";
    return null;
  }

  private updateLobby(m: MenuInput): Screen | null {
    const room = this.context.room;
    if (!room) throw new Error("lobby phase without room state");
    const member = room.members.find((candidate) => candidate.id === this.context.id);
    if (!member) throw new Error("local member missing from room");
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
      else if (this.focus === 2 && isHost && canStart) this.startMatch();
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
    const index = this.choices.findIndex((c) => c.id === member.fighter);
    this.pick(this.choices[(index + dir + this.choices.length) % this.choices.length]);
    sfx.menuMove();
  }

  private pick(choice: FighterChoice): void {
    this.mine = choice;
    this.context.transport.sendLobby({ t: "pick", fighter: choice.id, bundleUrl: choice.bundleUrl, ready: false });
  }

  startMatch(): void {
    const room = this.context.room;
    if (!room || room.host !== this.context.id || !this.canStart()) return;
    this.context.transport.sendLobby({
      t: "start",
      config: {
        stage: "proving",
        rules: { stocks: settings.stocks, time: settings.time * 60 * 60 },
        inputDelay: this.inputDelay,
      },
    });
    sfx.go();
  }

  leave(): void {
    this.context.transport.sendLobby({ t: "leave" });
    this.context.room = null;
    this.phase = "menu";
    sfx.menuBack();
  }

  private onMessage(message: RelayMessage): void {
    if (message.t === "hello") this.context.id = message.id;
    if (message.t === "room") {
      this.context.room = message;
      if (this.phase !== "loading") this.phase = "lobby";
      // arriving in a room: bring the fighter picked on the way in
      const me = message.members.find((member) => member.id === this.context.id);
      if (me && !me.fighter) this.pick(this.mine ?? this.choices[0]);
    }
    if (message.t === "error") {
      this.error = message.error.toUpperCase();
      this.phase = "error";
    }
    if (message.t === "start") {
      const local = message.members.find((member) => member.id === this.context.id);
      if (!local) throw new Error("start message omitted local member");
      const config = startConfig(message.config, message.seed);
      // every client loads every participant's fighter first; the netcode's input resend covers the skew
      this.phase = "loading";
      const loads = config.bundles.filter(Boolean).map((url) => fighterLoad(url));
      void Promise.all(loads.map((l) => l.promise)).then(() => {
        const failed = loads.find((l) => l.state === "failed");
        if (failed) {
          this.error = `A FIGHTER DIDN'T LOAD: ${failed.error}`;
          this.phase = "error";
          return;
        }
        this.nextScreen = OnlineScreen.matchScreen(this.onExit, this.context, { config: config.match, bundles: config.bundles, members: message.members, localSlot: local.slot, device: this.device, inputDelay: config.inputDelay });
      });
    }
    // bundle switches outside a match: the host answers at once, everyone swaps carrying the room
    if (message.t === "game" && this.context.room?.host === this.context.id) this.context.transport.sendLobby({ t: "gameAt", hash: message.hash, frame: 0 });
    if (message.t === "gameAt" && message.hash !== swap.hash) {
      this.dispose();
      swap.request(message.hash, { transport: this.context.transport, id: this.context.id, room: this.context.room });
    }
  }

  private drawMenu(ctx: CanvasRenderingContext2D): void {
    const items = [
      ["QUICK MATCH", "Find one opponent."],
      ["CREATE ROOM", "Make a private four-letter code."],
      ["JOIN ROOM", "Enter a friend's room code."],
    ];
    items.forEach(([name, description], index) => {
      const y = 230 + index * 180;
      if (hover(VIEW_W / 2 - 360, y, 720, 130)) { this.sel = index; document.body.style.cursor = "pointer"; }
      if (clicked(VIEW_W / 2 - 360, y, 720, 130)) this.updateMenu({ up: false, down: false, left: false, right: false, confirm: true, back: false, start: false, any: true, from: null });
      const selected = index === this.sel;
      card(ctx, VIEW_W / 2 - 360, y, 720, 130, selected ? INK : "rgba(18,16,26,0.7)", selected);
      title(ctx, name, VIEW_W / 2, y + 60, 38, INK);
      label(ctx, description, VIEW_W / 2, y + 101, 19, selected ? INK : "rgba(41,39,34,0.8)");
    });
    if (backButton(ctx)) goTo(this.exit());
    hint(ctx, "click, or up/down + Enter · Esc: back");
  }

  private drawCode(ctx: CanvasRenderingContext2D): void {
    label(ctx, "ENTER ROOM CODE", VIEW_W / 2, 260, 30);
    this.code.forEach((char, index) => {
      const x = VIEW_W / 2 - 250 + index * 140;
      if (clicked(x, 330, 110, 140)) this.codePos = index;
      card(ctx, x, 330, 110, 140, index === this.codePos ? INK : "rgba(18,16,26,0.75)", index === this.codePos);
      title(ctx, char, x + 55, 425, 70, INK);
      const d = arrows(ctx, x + 55, 510, 30, 22);
      if (d) { const cur = Math.max(0, CODE_CHARS.indexOf(this.code[index])); this.code[index] = CODE_CHARS[(cur + d + CODE_CHARS.length) % CODE_CHARS.length]; this.codePos = index; sfx.menuMove(); }
    });
    if (button(ctx, VIEW_W / 2 - 140, 580, 280, 76, "JOIN", { key: "Enter", size: 30 })) { this.context.transport.sendLobby({ t: "join", code: this.code.join("") }); this.phase = "waiting"; }
    if (backButton(ctx)) this.phase = "menu";
    hint(ctx, "type the four letters, then JOIN · Esc: back");
  }

  private drawWaiting(ctx: CanvasRenderingContext2D): void {
    title(ctx, "SEARCHING…", VIEW_W / 2, VIEW_H / 2, 70, INK);
    label(ctx, "Waiting for the relay", VIEW_W / 2, VIEW_H / 2 + 60, 24);
    if (button(ctx, VIEW_W / 2 - 120, VIEW_H / 2 + 110, 240, 70, "CANCEL", { key: "Esc", size: 26 })) { this.context.transport.sendLobby({ t: "unqueue" }); this.phase = "menu"; }
  }

  private drawLobby(ctx: CanvasRenderingContext2D): void {
    const room = this.context.room;
    if (!room) throw new Error("lobby phase without room state");
    label(ctx, `ROOM ${room.code}`, VIEW_W / 2, 135, 26, INK);
    const w = 380, h = 650, gap = 36;
    const x0 = (VIEW_W - (w * 4 + gap * 3)) / 2;
    for (let slot = 0; slot < 4; slot++) {
      const member = room.members.find((candidate) => candidate.slot === slot);
      const x = x0 + slot * (w + gap), y = 175;
      card(ctx, x, y, w, h, member ? SLOT_COLORS[slot] : "rgba(18,16,26,0.5)", !!member?.ready, member ? 1 : 0.65);
      if (!member) {
        label(ctx, "WAITING", x + w / 2, y + h / 2, 28, "rgba(41,39,34,0.65)");
        continue;
      }
      label(ctx, `${member.name}${member.id === room.host ? " · HOST" : ""}`, x + w / 2, y + 42, 23, INK, "center", 900);
      const load = isBundlePath(member.bundleUrl, member.fighter) ? fighterLoad(member.bundleUrl) : null;
      const fighter = load?.state === "ready" ? roster[member.fighter] : null;
      if (fighter) {
        drawFighterPortrait(ctx, fighter, this.t, member.ready, { x: x + 16, y: y + 68, w: w - 32, h: 390 });
        title(ctx, fighter.name, x + w / 2, y + 525, 40, INK, "center", w - 32);
      } else label(ctx, load?.state === "failed" ? "didn't load" : member.fighter ? "loading …" : "choosing", x + w / 2, y + 280, 28, load?.state === "failed" ? "#c0392b" : PENCIL);
      const mine = member.id === this.context.id && this.phase === "lobby";
      if (mine && !member.ready) { const d = arrows(ctx, x + w / 2, y + 300, w / 2 - 34, 40); if (d) this.pickFighter(d); }
      if (mine) {
        if (button(ctx, x + 40, y + 560, w - 80, 64, member.ready ? "UNREADY" : "READY", { key: "Enter", size: 26, focused: this.focus === 1 })) this.toggleReady();
      } else label(ctx, member.ready ? "READY" : "CHOOSING", x + w / 2, y + 600, 24);
    }
    if (this.phase === "loading") {
      label(ctx, `loading ${".".repeat(1 + (Math.floor(this.t * 3) % 3))}`, VIEW_W / 2, 897, 36, PENCIL);
      return;
    }
    const canStart = this.canStart();
    const isHost = room.host === this.context.id;
    const by = 845;
    if (isHost) {
      if (button(ctx, VIEW_W / 2 - 170, by, 340, 84, "START", { key: "Enter", size: 36, focused: this.focus === 2, disabled: !canStart })) this.startMatch();
      label(ctx, `input delay ${this.inputDelay}f`, VIEW_W / 2 + 330, by + 52, 20, "rgba(41,39,34,0.85)");
      const d = arrows(ctx, VIEW_W / 2 + 330, by + 52, 90, 22);
      if (d) { this.inputDelay = Math.max(1, Math.min(6, this.inputDelay + d)); sfx.menuMove(); }
    } else label(ctx, canStart ? "waiting for the host to press START" : "everyone readies up, then the host starts", VIEW_W / 2, by + 52, 24, INK);
    if (button(ctx, 40, VIEW_H - 100, 200, 64, "LEAVE", { key: "Esc", size: 26, focused: this.focus === 3 })) this.leave();
    hint(ctx, isHost && !canStart ? `START unlocks when everyone is ready (${room.members.length}/2+ players)` : "left/right or the arrows pick a fighter");
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

