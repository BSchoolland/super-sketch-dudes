import type { Fighter, FighterDef, Hitbox, Move } from "../../../shared/types";
import { hitboxWorld } from "../../../shared/hits";
import { defOf, currentMove } from "../../../shared/fighter";
import { hatch, inkArc, inkLine, inkPath, inkRect, INK, PAPER } from "./paper";
import { drawLook, lookOf } from "./looks";

/** Strikes are drawn in the character's own marker colour, outlined in its ink. */
export function markerOf(def: FighterDef): string {
  const p = def.palette as { colors: Record<string, string>; accent?: string; outline: string };
  return (p.accent && p.colors[p.accent]) || Object.values(p.colors)[0] || p.outline || INK;
}

export function drawStrikes(ctx: CanvasRenderingContext2D, f: Fighter, pos: { x: number; y: number }, slotColor: string, time: number): void {
  if (f.action !== "attack") return;
  const mv = currentMove(f);
  if (!mv || mv.throwFrame) return;
  const def = defOf(f);
  const marker = markerOf(def), ink = def.palette.outline || INK;
  for (const hb of mv.hitboxes) {
    if (f.frame < hb.frames[0] || f.frame > hb.frames[1] + 6) continue;
    const c = hitboxWorld({ ...f, x: pos.x, y: pos.y }, hb);
    const t = (f.frame - hb.frames[0] + 1) / (hb.frames[1] - hb.frames[0] + 7);
    ctx.save(); ctx.globalAlpha = 0.95 - t * 0.5;
    const look = lookOf(def, hb.fx);
    if (hb.grab) {
      ctx.setLineDash([5, 5]); inkArc(ctx, c.x1, c.y1, c.r, 0, Math.PI * 2, slotColor, 2.5);
    } else if (look) {
      const len = Math.hypot(c.x2 - c.x1, c.y2 - c.y1);
      const angle = len > 0 ? Math.atan2(c.y2 - c.y1, c.x2 - c.x1) : f.moveFacing === 1 ? 0 : Math.PI;
      // shapes go a little translucent so an area attack doesn't hide the fighter inside it
      drawLook(ctx, def, look, { x: len > 0 && !look.cell ? c.x1 : (c.x1 + c.x2) / 2, y: len > 0 && !look.cell ? c.y1 : (c.y1 + c.y2) / 2, angle, r: c.r, len: look.cell ? 0 : len, facing: f.moveFacing, frame: f.frame - hb.frames[0], alpha: look.cell ? 1 : 0.75 });
    } else {
      const family = hb.fx ?? mv.hitboxes[0]?.fx ?? "hit";
      if (family === "slash" || family === "tip") {
        const cx = pos.x, cy = pos.y - def.stats.height * 0.55;
        const mx = (c.x1 + c.x2) / 2, my = (c.y1 + c.y2) / 2;
        const far = Math.max(Math.hypot(c.x1 - cx, c.y1 - cy), Math.hypot(c.x2 - cx, c.y2 - cy)) + c.r;
        const dir = Math.atan2(my - cy, mx - cx);
        const spread = Math.min(1.3, 0.28 + c.r * 2.4 / Math.max(40, far - c.r));
        inkArc(ctx, cx, cy, far - c.r, dir - spread / 2, dir + spread / 2, ink, c.r * 1.6 + 4, 9);
        inkArc(ctx, cx, cy, far - c.r, dir - spread / 2, dir + spread / 2, marker, c.r * 1.6, 9);
        inkArc(ctx, cx, cy, far - c.r, dir - spread / 2, dir + spread / 2, PAPER, Math.max(2, c.r * 0.22), 9);
        inkLine(ctx, c.x1, c.y1, c.x2, c.y2, ink, c.r * 1.7 + 4, 10, true);
        inkLine(ctx, c.x1, c.y1, c.x2, c.y2, marker, c.r * 1.7, 10, true);
        inkLine(ctx, c.x1, c.y1, c.x2, c.y2, PAPER, Math.max(1.5, c.r * 0.2), 10, true);
        if (family === "tip") {
          inkLine(ctx, c.x2 - 9, c.y2 - 9, c.x2 + 9, c.y2 + 9, ink, 3);
          inkLine(ctx, c.x2 + 9, c.y2 - 9, c.x2 - 9, c.y2 + 9, ink, 3);
        }
      } else if (family === "fire") {
        const n = Math.max(1, Math.ceil(Math.hypot(c.x2 - c.x1, c.y2 - c.y1) / Math.max(10, c.r)));
        for (let i = 0; i <= n; i++) {
          const x = c.x1 + (c.x2 - c.x1) * i / n, y = c.y1 + (c.y2 - c.y1) * i / n;
          const points: [number, number][] = [];
          for (let j = 0; j <= 26; j++) {
            const a = j / 26 * Math.PI * 2;
            const r = c.r * (j % 2 ? 0.72 : 1) + Math.sin(j * 7 + Math.floor(time * 6)) * 2;
            points.push([x + Math.cos(a) * r, y + Math.sin(a) * r]);
          }
          inkPath(ctx, points, true); ctx.fillStyle = "#ffd22b"; ctx.fill();
          ctx.strokeStyle = "#ef4823"; ctx.lineWidth = 3.5; ctx.stroke();
          for (let j = -2; j <= 2; j++) inkLine(ctx, x - c.r * 0.5, y + j * c.r * 0.22, x + c.r * 0.5, y + (j - 1) * c.r * 0.22, "#f16a22", 2, j, true);
        }
      } else {
        ctx.translate(c.x1, c.y1); ctx.rotate(Math.atan2(c.y2 - c.y1, c.x2 - c.x1));
        const len = Math.hypot(c.x2 - c.x1, c.y2 - c.y1);
        const color = marker;
        inkPath(ctx, [[-c.r, -c.r * 0.75], [len + c.r, -c.r], [len + c.r, c.r * 0.8], [-c.r, c.r]], true, 5, true);
        ctx.fillStyle = color; ctx.fill();
        ctx.strokeStyle = ink; ctx.lineWidth = family === "heavy" ? 3.5 : 2.5; ctx.lineJoin = "round"; ctx.stroke();
        ctx.save(); ctx.clip(); ctx.globalAlpha *= family === "heavy" ? 0.7 : 0.45; hatch(ctx, -c.r, -c.r, len + c.r * 2, c.r * 2, ink); ctx.restore();
        if (family === "energy") inkLine(ctx, -c.r * 0.6, 0, len + c.r * 0.6, -1, PAPER, Math.max(2, c.r * 0.28));
        for (let j = -1; j <= 1; j++) inkLine(ctx, -c.r - 7, j * c.r * 0.7, -c.r - 24 - Math.abs(j) * 7, j * c.r, ink, 2.5);
        if (family === "heavy") inkRect(ctx, -c.r + 3, -c.r * 0.75 + 3, len + c.r * 2 - 6, c.r * 1.5 - 6, PAPER, 2);
      }
    }
    ctx.restore();
  }
}

/** True while the move has not yet reached its first active frame (windup). */
export function inWindup(f: Fighter, mv: Move): boolean {
  const first = Math.min(...mv.hitboxes.filter((h: Hitbox) => !h.grab).map((h) => h.frames[0]));
  return isFinite(first) && f.frame < first;
}
