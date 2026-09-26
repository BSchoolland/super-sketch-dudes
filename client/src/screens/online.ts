import type { FighterId } from "../../../shared/types";
import { roster, rosterList } from "../../../shared/fighters/index";
import { VIEW_H, VIEW_W } from "../render/camera";
import { SLOT_COLORS } from "../render/hud";
import { consumeTypedChars, type DeviceId, type MenuInput } from "../input/devices";
import { sfx } from "../audio/audio";
import { WebSocketTransport, type RelayMessage, type Unsubscribe } from "../net/transport";
import { drawFighterPortrait } from "./portrait";
import { NetVersusScreen, startConfig } from "./netversus";
import { bg, card, hint, label, settings, title, type Screen, INK } from "./ui";

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
  phase: "menu" | "code" | "waiting" | "lobby" | "error";
  code = ["A", "A", "A", "A"];
  codePos = 0;
  inputDelay = 2;
  error = "";
  nextScreen: Screen | null = null;
  private context: OnlineContext;
  private device: DeviceId = "kb1";
  private unsubscribers: Unsubscribe[] = [];

  constructor(private onExit: () => Screen, context?: OnlineContext) {
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
    if (settings.name) this.context.transport.sendLobby({ t: "name", name: settings.name });
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
    if (m.back || m.confirm) return this.exit();
    return null;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    bg(ctx, this.t);
    title(ctx, "ONLINE", VIEW_W / 2, 90, 64);
    if (this.phase === "menu") this.drawMenu(ctx);
    else if (this.phase === "code") this.drawCode(ctx);
    else if (this.phase === "waiting") this.drawWaiting(ctx);
    else if (this.phase === "lobby") this.drawLobby(ctx);
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
    if (!member.ready && (m.left || m.right)) {
      const index = rosterList.findIndex((fighter) => fighter.id === member.fighter);
      const fighter = rosterList[(index + (m.right ? 1 : rosterList.length - 1) + rosterList.length) % rosterList.length].id;
      this.context.transport.sendLobby({ t: "pick", fighter, ready: false });
      sfx.menuMove();
    }
    if (room.host === this.context.id && (m.up || m.down)) {
      this.inputDelay = Math.max(1, Math.min(6, this.inputDelay + (m.up ? 1 : -1)));
      sfx.menuMove();
    }
    if (m.confirm) {
      this.context.transport.sendLobby({ t: "pick", fighter: member.fighter, ready: !member.ready });
      member.ready ? sfx.menuBack() : sfx.menuConfirm();
    }
    const canStart = room.members.length >= 2 && room.members.every((candidate) => candidate.ready);
    if (m.start && room.host === this.context.id && canStart) {
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
    if (m.back) {
      this.context.transport.sendLobby({ t: "leave" });
      this.context.room = null;
      this.phase = "menu";
    }
    return null;
  }

  private onMessage(message: RelayMessage): void {
    if (message.t === "hello") this.context.id = message.id;
    if (message.t === "room") {
      this.context.room = message;
      this.phase = "lobby";
    }
    if (message.t === "error") {
      this.error = message.error.toUpperCase();
      this.phase = "error";
    }
    if (message.t === "start") {
      const local = message.members.find((member) => member.id === this.context.id);
      if (!local) throw new Error("start message omitted local member");
      const config = startConfig(message.config, message.seed);
      const context = this.context, onExit = this.onExit;
      this.nextScreen = new NetVersusScreen({
        transport: context.transport,
        config: config.match,
        members: message.members,
        localSlot: local.slot,
        device: this.device,
        inputDelay: config.inputDelay,
        onLobby: (lobby) => { if (lobby.t === "room") context.room = lobby; },
        exit: (reason) => {
          if (reason === "closed") return onExit();
          if (context.room?.host === context.id) context.transport.sendLobby({ t: "end" });
          return new OnlineScreen(onExit, context);
        },
      });
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
      const selected = index === this.sel;
      card(ctx, VIEW_W / 2 - 360, y, 720, 130, selected ? INK : "rgba(18,16,26,0.7)", selected);
      title(ctx, name, VIEW_W / 2, y + 60, 38, INK);
      label(ctx, description, VIEW_W / 2, y + 101, 19, selected ? INK : "rgba(41,39,34,0.8)");
    });
    hint(ctx, "attack: choose · shield: back");
  }

  private drawCode(ctx: CanvasRenderingContext2D): void {
    label(ctx, "ENTER ROOM CODE", VIEW_W / 2, 260, 30);
    this.code.forEach((char, index) => {
      const x = VIEW_W / 2 - 250 + index * 140;
      card(ctx, x, 330, 110, 140, index === this.codePos ? INK : "rgba(18,16,26,0.75)", index === this.codePos);
      title(ctx, char, x + 55, 425, 70, INK);
    });
    hint(ctx, "type the code · left/right change · up/down move · Enter: join");
  }

  private drawWaiting(ctx: CanvasRenderingContext2D): void {
    title(ctx, "SEARCHING…", VIEW_W / 2, VIEW_H / 2, 70, INK);
    label(ctx, "Waiting for the relay", VIEW_W / 2, VIEW_H / 2 + 60, 24);
    hint(ctx, "shield: cancel");
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
      const fighter = roster[member.fighter as FighterId];
      if (!fighter) throw new Error(`room has unknown fighter ${member.fighter}`);
      label(ctx, `${member.name}${member.id === room.host ? " · HOST" : ""}`, x + w / 2, y + 42, 23, INK, "center", 900);
      drawFighterPortrait(ctx, fighter, slot, this.t, member.ready, { x: x + 16, y: y + 68, w: w - 32, h: 390 }, 2.2);
      title(ctx, fighter.name, x + w / 2, y + 525, 40);
      label(ctx, member.ready ? "READY" : member.id === this.context.id ? "◀  PICK  ▶" : "CHOOSING", x + w / 2, y + 585, 22);
      if (member.id === this.context.id) label(ctx, "attack: ready", x + w / 2, y + 622, 18, "rgba(41,39,34,0.85)");
    }
    const canStart = room.members.length >= 2 && room.members.every((member) => member.ready);
    if (room.host === this.context.id) {
      label(ctx, `input delay ${this.inputDelay}f · up/down adjust`, VIEW_W / 2, 870, 21, "rgba(41,39,34,0.8)");
      hint(ctx, canStart ? "everyone's ready · press START" : "pick a fighter and ready up · shield: leave");
    } else {
      hint(ctx, canStart ? "waiting for the host to start" : "pick a fighter and ready up · shield: leave");
    }
  }

  private drawError(ctx: CanvasRenderingContext2D): void {
    title(ctx, this.error, VIEW_W / 2, VIEW_H / 2, 62, "#ff4d2e");
    hint(ctx, "attack / shield: back");
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
