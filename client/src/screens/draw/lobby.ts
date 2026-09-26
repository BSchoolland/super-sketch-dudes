import { account } from "../../account";
import { VIEW_H, VIEW_W } from "../../render/camera";
import { SLOT_COLORS } from "../../render/hud";
import { PENCIL } from "../../render/paper";
import type { MenuInput } from "../../input/devices";
import type { ViewPoint } from "../../input/pointer";
import { sfx } from "../../audio/audio";
import { DRAW_DEFAULTS } from "../../../../shared/draw";
import { card, label, title, INK } from "../ui";
import { ButtonMenu, type Button } from "./buttons";
import { TextField } from "./textfield";
import type { DrawHost, DrawView } from "./view";

const RED = "#c0392b";
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function heading(ctx: CanvasRenderingContext2D): void {
  title(ctx, "DRAW BATTLE", VIEW_W / 2, 190, 96);
}

/** The password, once per device: it's remembered after the first success. */
export class AuthView implements DrawView {
  private field: TextField | null = null;
  private menu = new ButtonMenu();
  private readonly enter: Button = { id: "enter", x: VIEW_W / 2 - 170, y: 600, w: 340, h: 96, text: "ENTER" };

  constructor(private host: DrawHost) {}

  update(m: MenuInput, taps: ViewPoint[]): void {
    const s = this.host.session;
    if (s.auth === "pending") { this.dispose(); return; }
    if (!this.field) this.field = new TextField({ type: "password", maxLength: 64, onSubmit: () => this.submit(), onCancel: () => this.host.exit() });
    if (this.menu.update([this.enter], m, taps) === "enter") this.submit();
    if (m.back) this.host.exit();
  }

  draw(ctx: CanvasRenderingContext2D): void {
    heading(ctx);
    const s = this.host.session;
    if (s.auth === "pending") { label(ctx, "checking…", VIEW_W / 2, 480, 34, PENCIL); return; }
    card(ctx, VIEW_W / 2 - 330, 400, 660, 120, INK, true);
    if (!this.field?.value) label(ctx, "password", VIEW_W / 2, 474, 40, "rgba(41,39,34,0.3)");
    this.field?.place(VIEW_W / 2 - 310, 410, 620, 100, 52);
    if (s.auth === "bad") label(ctx, s.authError || "wrong password", VIEW_W / 2, 568, 30, RED);
    this.menu.draw(ctx, [this.enter]);
  }

  dispose(): void {
    this.field?.remove();
    this.field = null;
  }

  private submit(): void {
    const password = this.field?.value ?? "";
    if (password) this.host.session.authenticate(password);
  }
}

/** Create or join, as the signed-in player. */
export class EntryView implements DrawView {
  private mode: "menu" | "code" | "waiting" = "menu";
  private field: TextField | null = null;
  private waitingSince = 0;
  private menu = new ButtonMenu();

  constructor(private host: DrawHost) {}

  private buttons(): Button[] {
    if (this.mode === "menu") return [
      { id: "create", x: VIEW_W / 2 - 360, y: 330, w: 720, h: 130, text: "CREATE ROOM" },
      { id: "join", x: VIEW_W / 2 - 360, y: 500, w: 720, h: 130, text: "JOIN ROOM" },
    ];
    if (this.mode === "code") return [{ id: "ok", x: VIEW_W / 2 - 170, y: 620, w: 340, h: 96, text: "JOIN" }];
    return [];
  }

  update(m: MenuInput, taps: ViewPoint[]): void {
    const s = this.host.session;
    if (this.mode === "waiting") {
      if (s.error && s.error.at > this.waitingSince) this.mode = "menu";
      if (m.back) this.mode = "menu";
      return;
    }
    const pressed = this.menu.update(this.buttons(), m, taps);
    if (this.mode === "menu") {
      if (pressed === "create") {
        this.host.session.send({ t: "drawCreate", session: account.session ?? "" });
        this.wait();
      }
      if (pressed === "join") {
        this.mode = "code";
        this.field = new TextField({ maxLength: 4, upper: true, onSubmit: () => this.submitCode(), onCancel: () => this.cancelCode() });
      }
      if (m.back) this.host.exit();
      return;
    }
    if (this.field) this.padCode(m);
    if (pressed === "ok") this.submitCode();
    if (m.back) this.cancelCode();
  }

  draw(ctx: CanvasRenderingContext2D): void {
    heading(ctx);
    const buttons = this.buttons();
    if (this.mode === "menu") {
      this.menu.draw(ctx, buttons);
      label(ctx, `drawing as ${account.player?.name ?? "?"}`, VIEW_W / 2, 730, 32, PENCIL);
    } else if (this.mode === "waiting") {
      label(ctx, "…", VIEW_W / 2, 480, 60, PENCIL);
    } else {
      card(ctx, VIEW_W / 2 - 330, 400, 660, 150, INK, true);
      if (!this.field?.value) label(ctx, "room code", VIEW_W / 2, 494, 44, "rgba(41,39,34,0.3)");
      this.field?.place(VIEW_W / 2 - 310, 410, 620, 130, 96);
      this.menu.draw(ctx, buttons);
    }
  }

  dispose(): void {
    this.field?.remove();
    this.field = null;
  }

  private submitCode(): void {
    const value = this.field?.value.trim() ?? "";
    if (value.length !== 4) return;
    this.host.session.send({ t: "drawJoin", code: value.toUpperCase(), session: account.session ?? "" });
    this.dispose();
    this.wait();
  }

  private cancelCode(): void {
    this.dispose();
    this.mode = "menu";
    sfx.menuBack();
  }

  private wait(): void {
    this.mode = "waiting";
    this.waitingSince = performance.now();
  }

  /** Gamepads can't type: up/down turn the last letter, right adds one, left removes one. */
  private padCode(m: MenuInput): void {
    const field = this.field;
    if (!field || !m.from?.startsWith("pad")) return;
    let v = field.value.toUpperCase();
    if (m.right && v.length < 4) v += "A";
    if (m.left) v = v.slice(0, -1);
    if ((m.up || m.down) && v.length) {
      const i = Math.max(0, CODE_CHARS.indexOf(v[v.length - 1]));
      v = v.slice(0, -1) + CODE_CHARS[(i + (m.up ? 1 : CODE_CHARS.length - 1)) % CODE_CHARS.length];
    }
    if (v !== field.value) { field.value = v; sfx.menuMove(); }
  }
}

const SECONDS = [45, 60, 90, 120, 180];

export class LobbyView implements DrawView {
  private rounds = DRAW_DEFAULTS.rounds;
  private seconds = DRAW_DEFAULTS.drawSeconds;
  private menu = new ButtonMenu();

  constructor(private host: DrawHost) {}

  private buttons(): Button[] {
    const room = this.host.session.room;
    if (!room || room.host !== this.host.session.id) return [];
    return [
      { id: "rounds", x: VIEW_W / 2 - 520, y: 720, w: 480, h: 96, text: `${this.rounds} drawing${this.rounds > 1 ? "s" : ""} each`, size: 34, step: (d) => { this.rounds = Math.max(1, Math.min(5, this.rounds + d)); } },
      { id: "seconds", x: VIEW_W / 2 + 40, y: 720, w: 480, h: 96, text: `${this.seconds} seconds to draw`, size: 34, step: (d) => { this.seconds = SECONDS[(SECONDS.indexOf(this.seconds) + d + SECONDS.length) % SECONDS.length]; } },
      { id: "start", x: VIEW_W / 2 - 220, y: 860, w: 440, h: 110, text: "START", disabled: room.players.length < DRAW_DEFAULTS.minPlayers },
    ];
  }

  update(m: MenuInput, taps: ViewPoint[]): void {
    if (this.menu.update(this.buttons(), m, taps) === "start" || (m.start && this.isHost())) this.start();
    if (m.back) { sfx.menuBack(); this.host.session.leave(); }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const room = this.host.session.room;
    if (!room) throw new Error("lobby view without a room");
    title(ctx, room.code, VIEW_W / 2, 210, 150);
    const w = 400, h = 300, gap = 36, x0 = (VIEW_W - (w * 4 + gap * 3)) / 2, y = 290;
    for (let slot = 0; slot < DRAW_DEFAULTS.maxPlayers; slot++) {
      const p = room.players.find((candidate) => candidate.slot === slot);
      const x = x0 + slot * (w + gap);
      card(ctx, x, y, w, h, INK, p?.id === this.host.session.id, p ? 1 : 0.4);
      if (!p) continue;
      ctx.fillStyle = SLOT_COLORS[slot];
      ctx.fillRect(x + 40, y + 190, w - 80, 6);
      title(ctx, p.name, x + w / 2, y + 170, p.name.length > 9 ? 52 : 68, p.connected ? INK : PENCIL);
      if (p.id === room.host) label(ctx, "host", x + w / 2, y + 250, 28, PENCIL);
    }
    const buttons = this.buttons();
    if (buttons.length) this.menu.draw(ctx, buttons);
    else {
      const host = room.players.find((p) => p.id === room.host);
      label(ctx, `waiting for ${host?.name ?? "the host"} to start`, VIEW_W / 2, 800, 36, PENCIL);
    }
    if (room.players.length < DRAW_DEFAULTS.minPlayers) label(ctx, "send a friend the code", VIEW_W / 2, VIEW_H - 50, 28, PENCIL);
  }

  private isHost(): boolean {
    return this.host.session.room?.host === this.host.session.id;
  }

  private start(): void {
    const room = this.host.session.room;
    if (!room || !this.isHost() || room.players.length < DRAW_DEFAULTS.minPlayers) return;
    this.host.session.send({ t: "drawStart", rounds: this.rounds, drawSeconds: this.seconds });
    sfx.go();
  }
}
