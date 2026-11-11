import { FONT, INK, PAPER, PENCIL, hatch, inkArc, inkLine, inkPath } from "./paper";
import { TOUCH_BUTTONS, type Circle, type TouchButton, type TouchLayout } from "../input/touchpad";

const WORD: Record<TouchButton, string> = { attack: "ATTACK", special: "SPECIAL", jump: "JUMP", shield: "SHIELD" };

/** What the drawing needs from the controls: where the stick is and what's held. */
export interface TouchLook {
  layout: TouchLayout;
  stick: { ox: number; oy: number; x: number; y: number; active: boolean };
  held: (button: TouchButton) => boolean;
  pause: boolean | null;
}

function disc(ctx: CanvasRenderingContext2D, c: Circle, down: boolean, seed: number): void {
  ctx.fillStyle = "rgba(41,39,34,0.1)";
  ctx.beginPath(); ctx.arc(c.x + 4, c.y + 5, c.r, 0, Math.PI * 2); ctx.fill();
  ctx.save();
  ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
  ctx.globalAlpha = 0.8;
  ctx.fillStyle = PAPER; ctx.fill();
  if (down) { ctx.clip(); ctx.globalAlpha = 1; hatch(ctx, c.x - c.r, c.y - c.r, c.r * 2, c.r * 2, PENCIL); }
  ctx.restore();
  inkArc(ctx, c.x, c.y, c.r, 0, Math.PI * 2, INK, down ? 5 : 2.6, seed);
}

/** The controls over the fight: paper buttons inked round, the stick a pencil ring with a paper knob. */
export function drawTouchControls(ctx: CanvasRenderingContext2D, look: TouchLook): void {
  const { layout, stick } = look;
  ctx.save();
  ctx.lineCap = "round";
  const travel = layout.stick.r;
  ctx.globalAlpha = stick.active ? 1 : 0.6;
  inkArc(ctx, stick.ox, stick.oy, travel, 0, Math.PI * 2, PENCIL, 2, 7);
  if (stick.active) inkLine(ctx, stick.ox, stick.oy, stick.x, stick.y, PENCIL, 3, 11);
  disc(ctx, { x: stick.x, y: stick.y, r: travel * 0.5 }, false, 13);
  ctx.globalAlpha = 1;
  for (const [i, name] of TOUCH_BUTTONS.entries()) {
    const c = layout.buttons[name], down = look.held(name);
    disc(ctx, c, down, 31 * (i + 1));
    ctx.font = `900 ${Math.round(c.r * 0.4)}px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = INK;
    ctx.fillText(WORD[name], c.x, c.y + c.r * 0.04, c.r * 1.7);
  }
  if (look.pause !== null) {
    const p = layout.pause;
    disc(ctx, p, look.pause, 97);
    inkLine(ctx, p.x - p.r * 0.22, p.y - p.r * 0.36, p.x - p.r * 0.22, p.y + p.r * 0.36, INK, Math.max(3, p.r * 0.14), 5);
    inkLine(ctx, p.x + p.r * 0.22, p.y - p.r * 0.36, p.x + p.r * 0.22, p.y + p.r * 0.36, INK, Math.max(3, p.r * 0.14), 6);
  }
  ctx.restore();
}

/** A phone held upright, over everything, asking to be turned: drawn in canvas pixels, `w` x `h`. */
export function drawSideways(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, w, h);
  const s = Math.min(w, h) / 100;
  const cx = w / 2, cy = h * 0.42;
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  // the phone, tipping over onto its side
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-0.35);
  const pw = 26 * s, ph = 46 * s;
  ctx.fillStyle = PAPER;
  ctx.fillRect(-pw / 2, -ph / 2, pw, ph);
  ctx.strokeStyle = INK; ctx.lineWidth = 1.2 * s;
  inkPath(ctx, [[-pw / 2, -ph / 2], [pw / 2, -ph / 2], [pw / 2, ph / 2], [-pw / 2, ph / 2]], true, 3);
  ctx.stroke();
  ctx.lineWidth = 0.6 * s;
  inkPath(ctx, [[-pw / 2 + 3 * s, -ph / 2 + 5 * s], [pw / 2 - 3 * s, -ph / 2 + 5 * s], [pw / 2 - 3 * s, ph / 2 - 5 * s], [-pw / 2 + 3 * s, ph / 2 - 5 * s]], true, 4);
  ctx.stroke();
  ctx.restore();
  // the turn
  inkArc(ctx, cx, cy, 34 * s, -Math.PI * 0.95, -Math.PI * 0.35, INK, 1.2 * s, 9);
  const ex = cx + Math.cos(-Math.PI * 0.35) * 34 * s, ey = cy + Math.sin(-Math.PI * 0.35) * 34 * s;
  inkLine(ctx, ex, ey, ex - 7 * s, ey - 1 * s, INK, 1.2 * s, 2);
  inkLine(ctx, ex, ey, ex + 1 * s, ey - 7 * s, INK, 1.2 * s, 3);
  ctx.fillStyle = INK;
  ctx.textAlign = "center";
  ctx.font = `900 ${Math.round(9 * s)}px ${FONT}`;
  ctx.fillText("TURN YOUR PHONE", cx, h * 0.42 + 46 * s, w * 0.9);
  ctx.fillText("SIDEWAYS", cx, h * 0.42 + 57 * s, w * 0.9);
  ctx.restore();
}
