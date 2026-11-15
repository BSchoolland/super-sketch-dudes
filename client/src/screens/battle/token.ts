import { inkArc, PAPER } from "../../render/paper";
import { grow, label } from "../ui";

/** A token's radius in view pixels: the label inside it stays readable on a phone. */
export const tokenR = (): number => grow(24, 11) * 1.17;

/**
 * A slot's token: a hand-drawn circle in the slot's colour with its label ("P1", "CPU") inside. `lifted`: in someone's
 * hand, a little bigger with its shadow under it.
 */
export function drawToken(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, color: string, opts: { lifted?: boolean; seed?: number } = {}): void {
  const r = tokenR() * (opts.lifted ? 1.12 : 1), size = grow(24, 11) * (opts.lifted ? 1.12 : 1);
  ctx.save();
  if (opts.lifted) {
    ctx.fillStyle = "rgba(41,39,34,0.14)";
    ctx.beginPath(); ctx.arc(x + 5, y + 8, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = PAPER;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  inkArc(ctx, x, y, r, 0, Math.PI * 2, color, 2.8, opts.seed ?? 0);
  label(ctx, text, x, y + size * 0.34, size, color, "center", 400, r * 1.7);
  ctx.restore();
}

/** The pencil's dashed line from a token's card to the token in hand. */
export function drawTether(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string): void {
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.setLineDash([8, 8]); ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.quadraticCurveTo(x1 + 40, (y1 + y2) / 2, x2, y2);
  ctx.stroke();
  ctx.restore();
}
