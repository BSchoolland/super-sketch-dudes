import type { FighterDef, Look } from "../../../shared/types";
import { roster } from "../../../shared/fighters/index";
import { cellImages } from "./sprite";
import { INK, PENCIL, hatch, inkArc, inkLine, inkPath, noise } from "./paper";

/** Where and how big a look is drawn, in world units. */
export interface LookAt {
  x: number;
  y: number;
  /** Direction of travel (projectile) or along the capsule (strike), radians. */
  angle: number;
  /** Half-thickness, and the capsule length along `angle` (0 for a point). */
  r: number;
  len: number;
  facing: 1 | -1;
  /** Sim frames since the projectile spawned / the hitbox came out: drives spin and flicker. */
  frame: number;
  alpha?: number;
  /** Trail afterimage: pencil-grey, no texture. */
  ghost?: boolean;
}

export function lookOf(def: FighterDef, name: string | undefined): Look | null {
  return name !== undefined && def.looks ? def.looks[name] ?? null : null;
}

/** A look's dominant colour, for the hit sparks and trails. */
export function lookColor(look: Look, fallback: string): string {
  return look.color ?? (look.cell ? INK : fallback);
}

export function drawLook(ctx: CanvasRenderingContext2D, def: FighterDef, look: Look, at: LookAt): void {
  ctx.save();
  if (at.alpha !== undefined) ctx.globalAlpha *= at.alpha;
  ctx.translate(at.x, at.y);
  if (look.cell) drawCellLook(ctx, def, look, at);
  else drawShapeLook(ctx, look, at);
  ctx.restore();
}

function drawCellLook(ctx: CanvasRenderingContext2D, def: FighterDef, look: Look, at: LookAt): void {
  const sp = def.sprite;
  const url = sp.cells[look.cell!];
  const e = cellImages(url);
  const img = at.ghost ? e.ghost : e.base;
  if (!img) return;
  const [cx, cy, cw, ch] = look.crop ?? [0, 0, sp.px, sp.px];
  const u = (roster[def.id] ?? def).stats.height / sp.heightPx;
  const scale = look.size !== undefined ? look.size / Math.max(cw, ch) : u;
  const w = cw * scale, h = ch * scale;
  const aim = look.aim ?? false;
  // the crop is drawn "pointing" the way it was drawn (+x = the fighter's facing); aiming rotates that
  // toward the travel direction and mirrors across it when the fighter faces left, so a left-thrown
  // sword is the drawn sword mirrored, not flipped upside down
  if (aim) { ctx.rotate(at.angle); ctx.scale(1, at.facing); } else ctx.scale(at.facing, 1);
  if (look.spin) ctx.rotate(look.spin * at.frame * Math.PI / 180);
  if (look.flip) ctx.scale(-1, 1);
  ctx.drawImage(img, cx, cy, cw, ch, -w / 2, -h / 2, w, h);
}

function drawShapeLook(ctx: CanvasRenderingContext2D, look: Look, at: LookAt): void {
  const shape = look.shape ?? "ball";
  const color = at.ghost ? PENCIL : look.color ?? "#ffffff";
  const ink = at.ghost ? PENCIL : look.ink ?? INK;
  const texture = at.ghost ? "solid" : look.texture ?? "solid";
  const r = look.size !== undefined ? look.size / 2 : at.r;
  const aim = look.aim ?? true;
  if (aim) { ctx.rotate(at.angle); ctx.scale(1, at.facing); } else ctx.scale(at.facing, 1);
  if (look.spin) ctx.rotate(look.spin * at.frame * Math.PI / 180);
  const seed = at.frame * 7;
  if (texture === "glow") {
    ctx.save(); ctx.globalAlpha *= 0.28; ctx.fillStyle = color;
    ctx.beginPath(); ctx.ellipse(at.len / 2, 0, at.len / 2 + r * 1.9, r * 1.9, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  if (shape === "bar" || shape === "bolt" || shape === "slash") {
    const len = shape === "slash" ? Math.max(at.len + r * 2, r * 3) : Math.max(at.len + r * 2, r * 2.5);
    ctx.translate(-r, 0);
    paint(ctx, shape, len, r, color, ink, texture, -r, -r * 1.2, len + r * 2, r * 2.4, seed);
    if (shape === "bolt") for (let j = -1; j <= 1; j++) inkLine(ctx, -6, j * r * 0.6, -22 - Math.abs(j) * 6, j * r * 0.9, ink, 2, j);
    return;
  }
  // point shapes stamp along the capsule
  const n = at.len > 0 ? Math.max(1, Math.ceil(at.len / (r * 1.2))) : 0;
  for (let i = 0; i <= n; i++) {
    ctx.save();
    ctx.translate(n ? at.len * i / n : 0, 0);
    paint(ctx, shape, 0, r, color, ink, texture, -r * 1.3, -r * 1.3, r * 2.6, r * 2.6, seed + i * 31, shape === "ring");
    ctx.restore();
  }
}

function tracePath(ctx: CanvasRenderingContext2D, shape: Look["shape"], len: number, r: number, seed: number): void {
  const pts: [number, number][] = [];
  switch (shape) {
    case "bar":
      pts.push([0, -r * 0.8], [len, -r], [len, r * 0.8], [0, r]);
      break;
    case "bolt":
      pts.push([0, -r * 0.5], [len * 0.35, -r * 0.9], [len * 0.7, -r * 0.5], [len, 0], [len * 0.7, r * 0.5], [len * 0.35, r * 0.9], [0, r * 0.5], [len * 0.15, 0]);
      break;
    case "slash": {
      for (let j = 0; j <= 12; j++) { const t = j / 12; pts.push([len * t, -Math.sin(t * Math.PI) * r * 1.4 - r * 0.2]); }
      for (let j = 12; j >= 0; j--) { const t = j / 12; pts.push([len * t, -Math.sin(t * Math.PI) * r * 0.5 + r * 0.2]); }
      break;
    }
    case "star":
      for (let j = 0; j < 10; j++) { const a = j * Math.PI / 5 - Math.PI / 2, rr = j % 2 ? r * 0.45 : r; pts.push([Math.cos(a) * rr, Math.sin(a) * rr]); }
      break;
    case "shard":
      pts.push([r * 1.3, 0], [-r * 0.2, -r * 0.7], [-r * 0.9, 0], [-r * 0.2, r * 0.7]);
      break;
    case "blob":
      for (let j = 0; j < 14; j++) { const a = j * Math.PI * 2 / 14, rr = r * (0.8 + noise(seed + j * 13) * 0.4); pts.push([Math.cos(a) * rr, Math.sin(a) * rr]); }
      break;
    case "cloud":
      for (let j = 0; j < 20; j++) { const a = j * Math.PI * 2 / 20, rr = r * (j % 4 < 2 ? 1 : 0.72); pts.push([Math.cos(a) * rr, Math.sin(a) * rr]); }
      break;
    case "puddle":
      for (let j = 0; j < 16; j++) { const a = j * Math.PI * 2 / 16, rr = 1 + (noise(seed + j * 13) - 0.5) * 0.3; pts.push([Math.cos(a) * r * 1.7 * rr, Math.sin(a) * r * 0.32 * rr]); }
      break;
    case "ring":
    default:
      for (let j = 0; j < 18; j++) { const a = j * Math.PI * 2 / 18; pts.push([Math.cos(a) * r, Math.sin(a) * r]); }
      break;
  }
  inkPath(ctx, pts, true, seed, shape === "blob" || shape === "cloud");
}

/** Traces the shape, fills it with colour + texture, then traces it again for the outline. `hollow` (rings) skips the fill. */
function paint(ctx: CanvasRenderingContext2D, shape: Look["shape"], len: number, r: number, color: string, ink: string, texture: Look["texture"], bx: number, by: number, bw: number, bh: number, seed: number, hollow = false): void {
  tracePath(ctx, shape, len, r, seed);
  if (!hollow) {
    ctx.fillStyle = color; ctx.fill();
    if (texture !== "solid" && texture !== "glow") {
      // the texture strokes start their own paths, so the outline below re-traces the shape
      ctx.save(); ctx.clip();
      if (texture === "hatch") { ctx.globalAlpha *= 0.55; hatch(ctx, bx, by, bw, bh, ink); }
      else if (texture === "dots") {
        ctx.fillStyle = ink; ctx.globalAlpha *= 0.6;
        for (let y = by; y < by + bh; y += 9) for (let x = bx + (Math.round(y / 9) % 2) * 4; x < bx + bw; x += 9) { ctx.beginPath(); ctx.arc(x, y, 1.6, 0, Math.PI * 2); ctx.fill(); }
      } else if (texture === "scribble") {
        ctx.globalAlpha *= 0.5;
        for (let i = 0; i < 6; i++) inkLine(ctx, bx + noise(seed + i * 3) * bw, by + noise(seed + i * 5) * bh, bx + noise(seed + i * 7) * bw, by + noise(seed + i * 11) * bh, ink, 1.3, seed + i);
      } else if (texture === "flame") {
        ctx.globalAlpha *= 0.85;
        const tick = Math.floor(performance.now() * 0.012);
        for (let i = 0; i < 5; i++) {
          const x = bx + bw * (0.15 + i * 0.17), yTop = by + bh * (0.15 + noise(seed + tick * 17 + i) * 0.3);
          inkLine(ctx, x, by + bh * 0.85, x + bw * 0.05, yTop, "#fff2a8", 2.6, i);
          inkLine(ctx, x, by + bh * 0.85, x - bw * 0.05, yTop + bh * 0.2, "#ff5a2e", 1.6, i + 9);
        }
      }
      ctx.restore();
      tracePath(ctx, shape, len, r, seed);
    }
  }
  ctx.strokeStyle = ink; ctx.lineWidth = hollow ? 3.5 : 2.4; ctx.lineJoin = "round"; ctx.stroke();
  if (hollow) inkArc(ctx, 2, -1, bw / 2.6 - 4, 0.4, 2.6, ink, 1.2, seed);
}
