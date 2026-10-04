import { inkPath } from "../render/paper";
import { title, INK } from "./ui";

const MINT = "#8fd19e";

/** A mint NEW! tag slapped on at an angle, centred on (x, y). */
export function drawNewSticker(ctx: CanvasRenderingContext2D, x: number, y: number, scale = 1): void {
  const w = 96 * scale, h = 46 * scale;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(0.18);
  inkPath(ctx, [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]], true, 21);
  ctx.fillStyle = MINT; ctx.fill();
  ctx.lineWidth = 2.4; ctx.strokeStyle = INK; ctx.stroke();
  title(ctx, "NEW!", 0, 11 * scale, 30 * scale, INK);
  ctx.restore();
}
