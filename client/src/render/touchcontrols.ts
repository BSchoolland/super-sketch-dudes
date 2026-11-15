import { FONT, INK, PAPER, PENCIL, hatch, inkArc, inkLine } from "./paper";
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
  // thin enough paper that a fighter behind a button still shows
  ctx.globalAlpha = 0.5;
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
