import { VIEW_W } from "../../render/camera";
import { PENCIL } from "../../render/paper";
import { SLOT_COLORS } from "../../render/hud";
import type { MenuInput } from "../../input/devices";
import type { ViewPoint } from "../../input/pointer";
import { sfx } from "../../audio/audio";
import { DRAW_PNG_MAX_BYTES } from "../../../../shared/draw";
import { card, label, title, INK } from "../ui";
import { ButtonMenu, type Button } from "./buttons";
import { DRAW_GRACE_MS, secondsLeft } from "./logic";
import { DrawPad, MARKERS, SIZES, type ToolKind } from "./pad";
import { clock } from "./text";
import type { DrawHost, DrawView } from "./view";

const PAD = { x: 510, y: 90, w: 900, h: 900 };
const LEFT = 90, COL_W = 340;

/** One draw round: the pad, the tools, the clock. Submits on DONE or when the clock runs out. */
export class DrawingView implements DrawView {
  private pad = new DrawPad(PAD);
  private menu = new ButtonMenu();
  private submitted = false;
  private problem = "";
  private readonly onKey = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.code === "KeyZ") { e.preventDefault(); this.pad.undo(); }
  };

  constructor(private host: DrawHost, private round: number) {
    this.pad.attach();
    window.addEventListener("keydown", this.onKey);
  }

  private buttons(): Button[] {
    if (this.submitted) return [];
    const b: Button[] = [{ id: "pencil", x: LEFT, y: 100, w: COL_W, h: 84, text: "", custom: true }];
    MARKERS.forEach((_, i) => b.push({ id: `marker${i}`, x: LEFT + i * 69, y: 214, w: 64, h: 64, text: "", custom: true }));
    b.push({ id: "eraser", x: LEFT, y: 308, w: COL_W, h: 84, text: "", custom: true });
    SIZES.forEach((_, i) => b.push({ id: `size${i}`, x: LEFT + i * 116, y: 422, w: 104, h: 90, text: "", custom: true }));
    b.push({ id: "undo", x: LEFT, y: 590, w: COL_W, h: 84, text: "UNDO", size: 36, disabled: !this.pad.canUndo });
    b.push({ id: "clear", x: LEFT, y: 700, w: COL_W, h: 84, text: "CLEAR", size: 36, disabled: this.pad.blank });
    b.push({ id: "done", x: 1490, y: 830, w: COL_W, h: 130, text: "DONE", size: 56 });
    return b;
  }

  update(m: MenuInput, taps: ViewPoint[]): void {
    const s = this.host.session;
    const mine = s.me?.characters[this.round - 1];
    if (mine && mine.status !== "waiting") this.lock();
    if (this.submitted) return;
    if (!this.problem && secondsLeft(s.deadline, Date.now(), DRAW_GRACE_MS) <= 0) { this.submit(); return; }
    const pressed = this.menu.update(this.buttons(), m, taps);
    if (!pressed) return;
    if (pressed === "pencil") this.setTool("pencil", INK);
    else if (pressed === "eraser") this.setTool("eraser", INK);
    else if (pressed.startsWith("marker")) this.setTool("marker", MARKERS[Number(pressed.slice(6))]);
    else if (pressed.startsWith("size")) this.pad.size = Number(pressed.slice(4));
    else if (pressed === "undo") this.pad.undo();
    else if (pressed === "clear") this.pad.clear();
    else if (pressed === "done") this.submit();
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const s = this.host.session;
    const room = s.room;
    if (!room) throw new Error("drawing view without a room");
    card(ctx, PAD.x - 6, PAD.y - 6, PAD.w + 12, PAD.h + 12, INK, false);
    this.pad.draw(ctx);
    const left = secondsLeft(s.deadline, Date.now(), DRAW_GRACE_MS);
    const cx = 1490 + COL_W / 2;
    if (!this.submitted) title(ctx, clock(left), cx, 250, 150, left <= 10 ? "#e4483f" : INK);
    label(ctx, room.rounds > 1 ? `character ${this.round} of ${room.rounds}` : "your fighter", cx, this.submitted ? 150 : 320, 30, PENCIL);
    if (this.submitted) this.drawOthers(ctx);
    else this.drawTools(ctx);
    if (this.problem) label(ctx, this.problem, PAD.x + PAD.w / 2, PAD.y + PAD.h + 60, 28, "#c0392b");
  }

  dispose(): void {
    this.pad.detach();
    window.removeEventListener("keydown", this.onKey);
  }

  private drawTools(ctx: CanvasRenderingContext2D): void {
    const buttons = this.buttons();
    const focus = this.menu.focused(buttons)?.id;
    const tool = this.pad.tool;
    const toolCard = (id: string, text: string, active: boolean) => {
      const b = buttons.find((candidate) => candidate.id === id)!;
      card(ctx, b.x, b.y, b.w, b.h, INK, active || focus === id);
      title(ctx, text, b.x + b.w / 2, b.y + 56, 40, active ? INK : PENCIL);
    };
    toolCard("pencil", "pencil", tool.kind === "pencil");
    toolCard("eraser", "eraser", tool.kind === "eraser");
    MARKERS.forEach((color, i) => {
      const b = buttons.find((candidate) => candidate.id === `marker${i}`)!;
      const active = tool.kind === "marker" && tool.color === color;
      ctx.save();
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(b.x + 32, b.y + 32, active ? 30 : 24, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = active || focus === b.id ? 4 : 1.5; ctx.strokeStyle = INK; ctx.stroke();
      ctx.restore();
    });
    SIZES.forEach((size, i) => {
      const b = buttons.find((candidate) => candidate.id === `size${i}`)!;
      card(ctx, b.x, b.y, b.w, b.h, INK, this.pad.size === i || focus === b.id);
      ctx.save();
      ctx.fillStyle = tool.kind === "marker" ? tool.color : INK;
      ctx.beginPath(); ctx.arc(b.x + b.w / 2, b.y + b.h / 2, 5 + size * 11, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    });
    this.menu.draw(ctx, buttons);
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

  private setTool(kind: ToolKind, color: string): void {
    this.pad.tool = { kind, color };
  }

  private lock(): void {
    this.submitted = true;
    this.pad.locked = true;
    this.pad.detach();
  }

  private submit(): void {
    if (this.submitted) return;
    const png = this.pad.toPng();
    const bytes = Math.floor(((png.length - png.indexOf(",") - 1) * 3) / 4);
    if (bytes > DRAW_PNG_MAX_BYTES) {
      this.problem = `this drawing is ${Math.round(bytes / 1000)} KB; the limit is ${DRAW_PNG_MAX_BYTES / 1000} KB`;
      console.error(this.problem);
      return;
    }
    this.problem = "";
    this.host.session.send({ t: "drawSubmit", round: this.round, png });
    sfx.menuConfirm();
    this.lock();
  }
}
