import { PENCIL } from "../../render/paper";
import { SLOT_COLORS } from "../../render/hud";
import type { MenuInput } from "../../input/devices";
import type { ViewPoint } from "../../input/pointer";
import { sfx } from "../../audio/audio";
import { card, label, title, INK } from "../ui";
import { ButtonMenu, type Button } from "./buttons";
import { DRAW_GRACE_MS, secondsLeft } from "./logic";
import { DrawPad } from "./pad";
import { clock } from "./text";
import { padPng, PadTools } from "./tools";
import type { DrawHost, DrawView } from "./view";

const PAD = { x: 510, y: 90, w: 900, h: 900 };
const COL_W = 340;

/** One draw round: the pad, the tools, the clock. Submits on DONE or when the clock runs out. */
export class DrawingView implements DrawView {
  private tools = new PadTools(new DrawPad(PAD));
  private menu = new ButtonMenu();
  private submitted = false;
  private problem = "";

  constructor(private host: DrawHost, private round: number) {
    this.tools.attach();
  }

  private buttons(): Button[] {
    if (this.submitted) return [];
    return [...this.tools.buttons(), { id: "done", x: 1490, y: 830, w: COL_W, h: 130, text: "DONE", size: 56 }];
  }

  update(m: MenuInput, taps: ViewPoint[]): void {
    const s = this.host.session;
    const mine = s.me?.characters[this.round - 1];
    if (mine && mine.status !== "waiting") this.lock();
    if (this.submitted) return;
    if (!this.problem && secondsLeft(s.deadline, Date.now(), DRAW_GRACE_MS) <= 0) { this.submit(); return; }
    const pressed = this.menu.update(this.buttons(), m, taps);
    if (pressed === "done") this.submit();
    else if (pressed) this.tools.press(pressed);
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const s = this.host.session;
    const room = s.room;
    if (!room) throw new Error("drawing view without a room");
    card(ctx, PAD.x - 6, PAD.y - 6, PAD.w + 12, PAD.h + 12, INK, false);
    this.tools.pad.draw(ctx);
    const left = secondsLeft(s.deadline, Date.now(), DRAW_GRACE_MS);
    const cx = 1490 + COL_W / 2;
    if (!this.submitted) title(ctx, clock(left), cx, 250, 150, left <= 10 ? "#e4483f" : INK);
    label(ctx, room.rounds > 1 ? `character ${this.round} of ${room.rounds}` : "your fighter", cx, this.submitted ? 150 : 320, 30, PENCIL);
    if (this.submitted) this.drawOthers(ctx);
    else {
      const buttons = this.buttons();
      this.tools.draw(ctx, buttons, this.menu.focused(buttons)?.id);
      this.menu.draw(ctx, buttons);
    }
    if (this.problem) label(ctx, this.problem, PAD.x + PAD.w / 2, PAD.y + PAD.h + 60, 28, "#c0392b");
  }

  dispose(): void {
    this.tools.detach();
  }

  private drawOthers(ctx: CanvasRenderingContext2D): void {
    const room = this.host.session.room!;
    const x = 1490;
    label(ctx, "waiting for the others", x + COL_W / 2, 230, 32, INK);
    room.players.forEach((p, i) => {
      const y = 320 + i * 110;
      const ch = p.characters[this.round - 1];
      const done = !!ch && ch.status !== "waiting";
      ctx.fillStyle = SLOT_COLORS[p.slot % SLOT_COLORS.length];
      ctx.fillRect(x, y - 30, 8, 44);
      title(ctx, p.name, x + 26, y, 44, p.connected ? INK : PENCIL, "left");
      label(ctx, !p.connected ? "left" : done ? "done" : "drawing…", x + 26, y + 40, 26, done ? INK : PENCIL, "left");
    });
    const left = secondsLeft(this.host.session.deadline, Date.now(), DRAW_GRACE_MS);
    label(ctx, clock(left), x + COL_W / 2, 900, 60, PENCIL);
  }

  private lock(): void {
    this.submitted = true;
    this.tools.pad.locked = true;
    this.tools.detach();
  }

  private submit(): void {
    if (this.submitted) return;
    const out = padPng(this.tools.pad);
    if ("problem" in out) {
      this.problem = out.problem;
      console.error(this.problem);
      return;
    }
    this.problem = "";
    this.host.session.send({ t: "drawSubmit", round: this.round, png: out.png });
    sfx.menuConfirm();
    this.lock();
  }
}
