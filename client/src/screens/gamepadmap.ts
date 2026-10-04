import { FONT, INK, PAPER, PENCIL, inkArc, inkLine, inkPath } from "../render/paper";

/** A standard gamepad drawn on the paper, centred at C; its parts' positions are what labels point at. */
const C = { x: 960, y: 520 };
type Pt = { x: number; y: number };
const at = (x: number, y: number): Pt => ({ x: C.x + x, y: C.y + y });

export const PAD_PARTS = {
  lt: at(-245, -222), rt: at(245, -222), lb: at(-245, -182), rb: at(245, -182),
  lstick: at(-215, -55), dpad: at(-110, 75), rstick: at(110, 75),
  y: at(215, -113), x: at(157, -55), b: at(273, -55), a: at(215, 3),
  back: at(-62, -100), start: at(62, -100),
} satisfies Record<string, Pt>;
const STICK_R = 48, FACE_R = 25;

/** Rounds a closed polygon into a curve (Catmull-Rom through its points). */
function smooth(points: [number, number][], steps = 6): [number, number][] {
  const out: [number, number][] = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const [p0, p1, p2, p3] = [points[(i - 1 + n) % n], points[i], points[(i + 1) % n], points[(i + 2) % n]];
    for (let s = 0; s < steps; s++) {
      const t = s / steps, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  return out;
}

const BODY: [number, number][] = smooth(([
  [-250, -172], [-120, -168], [0, -165], [120, -168], [250, -172], [320, -155], [370, -110], [395, -30], [405, 60], [395, 150],
  [365, 215], [320, 240], [275, 230], [235, 185], [190, 130], [120, 112], [0, 110], [-120, 112], [-190, 130], [-235, 185],
  [-275, 230], [-320, 240], [-365, 215], [-395, 150], [-405, 60], [-395, -30], [-370, -110], [-320, -155],
] as [number, number][]).map(([x, y]) => [C.x + x, C.y + y]));

function shoulder(ctx: CanvasRenderingContext2D, p: Pt, w: number, h: number, text: string, seed: number): void {
  const x = p.x - w / 2, y = p.y - h / 2, r = h / 2;
  inkPath(ctx, smooth([[x + r, y], [x + w - r, y], [x + w, y + r], [x + w - r, y + h], [x + r, y + h], [x, y + r]], 4), true, seed);
  ctx.fillStyle = PAPER; ctx.fill();
  ctx.lineWidth = 2.2; ctx.strokeStyle = INK; ctx.stroke();
  ctx.fillStyle = INK; ctx.font = `800 ${Math.round(h * 0.62)}px ${FONT}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(text, p.x, p.y + 1);
}

function disc(ctx: CanvasRenderingContext2D, p: Pt, r: number, seed: number, fill = PAPER): void {
  ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill();
  inkArc(ctx, p.x, p.y, r, 0, Math.PI * 2, INK, 2.3, seed);
}

/** PlayStation pads print shapes on the face buttons, the rest letters. */
export type PadStyle = "xbox" | "playstation";
export function padStyleOf(id: string): PadStyle {
  return /054c|playstation|dualshock|dualsense|sony/i.test(id) ? "playstation" : "xbox";
}

function faceGlyph(ctx: CanvasRenderingContext2D, p: Pt, which: "a" | "b" | "x" | "y", style: PadStyle): void {
  ctx.save();
  if (style === "xbox") {
    ctx.fillStyle = INK; ctx.font = `900 30px ${FONT}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(which.toUpperCase(), p.x, p.y + 2);
  } else {
    const s = 10;
    if (which === "a") { inkLine(ctx, p.x - s, p.y - s, p.x + s, p.y + s, INK, 3); inkLine(ctx, p.x + s, p.y - s, p.x - s, p.y + s, INK, 3); }
    else if (which === "b") inkArc(ctx, p.x, p.y, s + 1, 0, Math.PI * 2, INK, 3);
    else if (which === "x") { ctx.strokeStyle = INK; ctx.lineWidth = 3; inkPath(ctx, [[p.x - s, p.y - s], [p.x + s, p.y - s], [p.x + s, p.y + s], [p.x - s, p.y + s]], true, 3); ctx.stroke(); }
    else { ctx.strokeStyle = INK; ctx.lineWidth = 3; inkPath(ctx, [[p.x, p.y - s - 2], [p.x + s + 1, p.y + s - 2], [p.x - s - 1, p.y + s - 2]], true, 4); ctx.stroke(); }
  }
  ctx.restore();
}

export function drawGamepad(ctx: CanvasRenderingContext2D, style: PadStyle): void {
  const P = PAD_PARTS, ps = style === "playstation";
  ctx.save();
  ctx.lineJoin = "round"; ctx.lineCap = "round";
  shoulder(ctx, P.lt, 120, 40, ps ? "L2" : "LT", 11);
  shoulder(ctx, P.rt, 120, 40, ps ? "R2" : "RT", 12);
  shoulder(ctx, P.lb, 160, 30, ps ? "L1" : "LB", 13);
  shoulder(ctx, P.rb, 160, 30, ps ? "R1" : "RB", 14);
  ctx.fillStyle = "rgba(41,39,34,0.1)";
  ctx.translate(6, 7); inkPath(ctx, BODY, true, 9); ctx.fill(); ctx.translate(-6, -7);
  inkPath(ctx, BODY, true, 9);
  ctx.fillStyle = PAPER; ctx.fill();
  ctx.lineWidth = 2.8; ctx.strokeStyle = INK; ctx.stroke();
  for (const [p, seed] of [[P.lstick, 21], [P.rstick, 22]] as const) {
    disc(ctx, p, STICK_R + 10, seed, "rgba(41,39,34,0.06)");
    disc(ctx, p, STICK_R - 12, seed + 1);
  }
  const d = P.dpad, a = 15, l = 44;
  inkPath(ctx, [[d.x - a, d.y - l], [d.x + a, d.y - l], [d.x + a, d.y - a], [d.x + l, d.y - a], [d.x + l, d.y + a], [d.x + a, d.y + a], [d.x + a, d.y + l], [d.x - a, d.y + l], [d.x - a, d.y + a], [d.x - l, d.y + a], [d.x - l, d.y - a], [d.x - a, d.y - a]], true, 31);
  ctx.fillStyle = PAPER; ctx.fill(); ctx.lineWidth = 2.3; ctx.strokeStyle = INK; ctx.stroke();
  for (const which of ["a", "b", "x", "y"] as const) { disc(ctx, P[which], FACE_R, 40 + which.charCodeAt(0)); faceGlyph(ctx, P[which], which, style); }
  for (const [p, seed] of [[P.back, 51], [P.start, 52]] as const) {
    inkPath(ctx, smooth([[p.x - 20, p.y - 10], [p.x + 20, p.y - 10], [p.x + 20, p.y + 10], [p.x - 20, p.y + 10]], 3), true, seed);
    ctx.fillStyle = PAPER; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = INK; ctx.stroke();
  }
  inkArc(ctx, C.x, C.y - 40, 20, 0, Math.PI * 2, PENCIL, 1.6, 61);
  ctx.restore();
}

const SHOULDER_HALF: Partial<Record<keyof typeof PAD_PARTS, number>> = { lt: 60, rt: 60, lb: 80, rb: 80 };

/** Where a label's line to `part` ends, coming from `from`: the edge of a stick or button, a shoulder's outer end. */
export function partPoint(part: keyof typeof PAD_PARTS, from: Pt): Pt {
  const p = PAD_PARTS[part];
  const half = SHOULDER_HALF[part];
  if (half) return { x: p.x + Math.sign(from.x - p.x) * (half - 12), y: p.y };
  const r = part === "lstick" || part === "rstick" ? STICK_R + 10 : part === "dpad" ? 30 : part === "back" || part === "start" ? 12 : FACE_R + 2;
  const dx = from.x - p.x, dy = from.y - p.y, d = Math.hypot(dx, dy) || 1;
  return { x: p.x + (dx / d) * r, y: p.y + (dy / d) * r };
}
