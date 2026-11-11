import { B, STICK_RUN, STICK_WALK, type InputFrame } from "../../../shared/input";

/**
 * The on-screen controls as a device: fingers in view coordinates in, one InputFrame per sim tick out. No DOM here
 * (input/touch.ts feeds it), so the mapping is testable against the sim.
 *
 * It plays like keyboard 1 (B.DIGITAL): a tap of ATTACK with a direction is the tilt and holding it is the smash. The
 * stick is analog, and a flick of it is made visible to the sim the way a real stick's is; a flick with ATTACK
 * smashes at once, sent as a right-stick pulse the way the keyboard's SMASH key is.
 */
export type TouchButton = "jump" | "attack" | "special" | "shield";
export const TOUCH_BUTTONS: readonly TouchButton[] = ["attack", "special", "jump", "shield"];
const BIT: Record<TouchButton, number> = { jump: B.JUMP, attack: B.ATTACK, special: B.SPECIAL, shield: B.SHIELD };

export interface Circle { x: number; y: number; r: number }
export interface TouchLayout {
  /** Where the stick rests when no thumb is on it; `r` is how far the thumb travels for a full push. */
  stick: Circle;
  buttons: Record<TouchButton, Circle>;
  pause: Circle;
  /** Touches landing left of this are the stick's. */
  split: number;
  /** The span of the bottom edge the controls leave free, for the HUD. */
  free: { left: number; right: number };
}

/** A button's radius on a phone held sideways at SIZE 100%, in CSS pixels. */
const BUTTON_CSS = 38;
/** Ticks a stick move may take from rest to a full push and still be a flick (a real stick's is about one). */
const FLICK_TICKS = 5;
/** Ticks after a flick that ATTACK still smashes. */
const SMASH_TICKS = 8;
/** Ticks the right-stick pulse lasts, as the keyboard's SMASH key sends it. */
const PULSE_TICKS = 2;
/** JUMP held through the sim's jump squat is a full hop; ATTACK within this many ticks of JUMP makes it a short hop. */
const SHORT_HOP_TICKS = 3;
/** A finger counts as on a button this far past its edge. */
const SLOP = 1.3;

/**
 * The controls for a view `viewW` x `viewH` shown at `cssScale` CSS pixels per view pixel, `size` the player's
 * setting (1 = 100%). Sized in CSS pixels so a thumb finds them on any screen, capped so a small screen keeps the fight.
 */
export function touchLayout(viewW: number, viewH: number, cssScale: number, size: number): TouchLayout {
  const u = Math.min(130, BUTTON_CSS / cssScale) * size;
  const ax = viewW - 1.75 * u, ay = viewH - 1.75 * u;
  const buttons: Record<TouchButton, Circle> = {
    attack: { x: ax, y: ay, r: 1.2 * u },
    special: { x: ax - 2.45 * u, y: ay + 0.25 * u, r: u },
    jump: { x: ax + 0.2 * u, y: ay - 2.45 * u, r: u },
    shield: { x: ax - 2.2 * u, y: ay - 2.2 * u, r: 0.85 * u },
  };
  const stick = { x: 2.2 * u, y: viewH - 2.2 * u, r: 1.25 * u };
  return {
    stick,
    buttons,
    pause: { x: 0.95 * u, y: 0.95 * u, r: 0.55 * u },
    split: viewW * 0.45,
    free: { left: stick.x + stick.r + 0.9 * u, right: buttons.special.x - buttons.special.r - 0.3 * u },
  };
}

interface Finger { button: TouchButton | null; since: number; short: boolean }
interface Thumb { id: number; ox: number; oy: number; x: number; y: number }

export class TouchPad {
  /** Whether the pause button is there (local matches; online can't pause). */
  pauseable = false;
  private thumb: Thumb | null = null;
  private fingers = new Map<number, Finger>();
  /** A finger on the pause button. */
  private pausing = new Set<number>();
  /** Buttons pressed since the last frame, so a tap shorter than a tick still counts once. */
  private tapped = new Set<TouchButton>();
  private pauseTapped = false;
  private tick = 0;
  /** The stick's raw values over the last ticks, newest last. */
  private history: { x: number; y: number }[] = [];
  private sent = { x: 0, y: 0 };
  private flick: { x: number; y: number; at: number } | null = null;
  private pulse = { x: 0, y: 0, left: 0 };
  private prevButtons = 0;

  constructor(public layout: TouchLayout) {}

  /** A finger landed at view (x, y). False: it's not on the controls. */
  down(id: number, x: number, y: number): boolean {
    if (this.pauseable && Math.hypot(x - this.layout.pause.x, y - this.layout.pause.y) <= this.layout.pause.r * SLOP) {
      this.pausing.add(id);
      this.pauseTapped = true;
      return true;
    }
    if (x < this.layout.split) {
      if (this.thumb) return false;
      this.thumb = { id, ox: x, oy: y, x, y };
      return true;
    }
    const button = this.buttonAt(x, y);
    this.fingers.set(id, { button, since: this.tick, short: false });
    if (button) this.tapped.add(button);
    return true;
  }

  move(id: number, x: number, y: number): void {
    const t = this.thumb;
    if (t?.id === id) {
      t.x = x; t.y = y;
      // past the rim the stick comes along: turning around is never more than a full push away
      const dx = x - t.ox, dy = y - t.oy, d = Math.hypot(dx, dy), r = this.layout.stick.r;
      if (d > r) { t.ox += (dx / d) * (d - r); t.oy += (dy / d) * (d - r); }
      return;
    }
    const f = this.fingers.get(id);
    if (!f) return;
    // a thumb rolls from button to button
    const button = this.buttonAt(x, y);
    if (button === f.button) return;
    f.button = button;
    f.since = this.tick;
    f.short = false;
    if (button) this.tapped.add(button);
  }

  up(id: number): void {
    if (this.thumb?.id === id) this.thumb = null;
    this.fingers.delete(id);
    this.pausing.delete(id);
  }

  /** Every finger off and every gesture forgotten: the controls went away (a pause, the end of the match). */
  clear(): void {
    this.thumb = null;
    this.fingers.clear();
    this.pausing.clear();
    this.tapped.clear();
    this.pauseTapped = false;
    this.history = [];
    this.sent = { x: 0, y: 0 };
    this.flick = null;
    this.pulse = { x: 0, y: 0, left: 0 };
    this.prevButtons = 0;
  }

  /** Whether any finger is on the controls. */
  get touched(): boolean {
    return !!this.thumb || this.fingers.size > 0 || this.pausing.size > 0;
  }

  /** Where the stick is drawn: its origin and the thumb, or its resting place. */
  stickView(): { ox: number; oy: number; x: number; y: number; active: boolean } {
    const t = this.thumb, s = this.layout.stick;
    if (!t) return { ox: s.x, oy: s.y, x: s.x, y: s.y, active: false };
    return { ox: t.ox, oy: t.oy, x: t.x, y: t.y, active: true };
  }

  /** Whether `button` is held right now (for drawing). */
  held(button: TouchButton): boolean {
    for (const f of this.fingers.values()) if (f.button === button) return true;
    return false;
  }

  get pauseHeld(): boolean {
    return this.pausing.size > 0;
  }

  /** The next sim tick's input. Call exactly once per tick. */
  frame(): InputFrame {
    const raw = this.rawStick();
    const out = { x: raw.x, y: raw.y };
    for (const axis of ["x", "y"] as const) {
      const v = raw[axis], s = Math.sign(v);
      if (!s || s * v < STICK_RUN) continue;
      const before = this.history[this.history.length - 1]?.[axis] ?? 0;
      if (s * before >= STICK_RUN) continue;
      // no history yet is rest
      const recent = this.history.slice(-FLICK_TICKS);
      if (recent.length && !recent.some((h) => s * h[axis] < STICK_WALK + 15)) continue;
      // the sim reads a flick as rest-then-full on consecutive frames; a thumb crosses the middle over a few,
      // so the frame that crosses reads as rest and the next as the push
      if (Math.abs(this.sent[axis]) >= STICK_WALK + 15) out[axis] = 0;
      const big = Math.abs(raw.x) >= Math.abs(raw.y) ? "x" : "y";
      this.flick = { x: big === "x" ? Math.sign(raw.x) * 100 : 0, y: big === "y" ? Math.sign(raw.y) * 100 : 0, at: this.tick };
    }
    this.history.push(raw);
    if (this.history.length > FLICK_TICKS) this.history.shift();
    this.sent = out;

    let b = B.DIGITAL;
    for (const f of this.fingers.values()) if (f.button && !f.short) b |= BIT[f.button];
    for (const button of this.tapped) b |= BIT[button];
    if (this.pausing.size || this.pauseTapped) b |= B.PAUSE;
    const pressed = b & ~this.prevButtons;

    if (pressed & B.ATTACK) {
      // JUMP and ATTACK together: the jump squat ends without JUMP held, a short hop, and the attack comes out in the air
      for (const f of this.fingers.values()) if (f.button === "jump" && this.tick - f.since < SHORT_HOP_TICKS) f.short = true;
      if (this.flick && this.tick - this.flick.at <= SMASH_TICKS) {
        this.pulse = { x: this.flick.x, y: this.flick.y, left: PULSE_TICKS };
        this.flick = null;
      }
    }
    // a short hop drops JUMP after the press frame went out
    if (!(pressed & B.JUMP) && ![...this.fingers.values()].some((f) => f.button === "jump" && !f.short) && !this.tapped.has("jump")) b &= ~B.JUMP;

    const cx = this.pulse.left > 0 ? this.pulse.x : 0, cy = this.pulse.left > 0 ? this.pulse.y : 0;
    if (this.pulse.left > 0) this.pulse.left--;
    this.prevButtons = b;
    this.tapped.clear();
    this.pauseTapped = false;
    this.tick++;
    return { x: out.x, y: out.y, cx, cy, b };
  }

  private rawStick(): { x: number; y: number } {
    const t = this.thumb;
    if (!t) return { x: 0, y: 0 };
    const r = this.layout.stick.r;
    const clamp = (v: number) => Math.max(-100, Math.min(100, Math.round((v / r) * 100)));
    return { x: clamp(t.x - t.ox), y: clamp(t.y - t.oy) };
  }

  private buttonAt(x: number, y: number): TouchButton | null {
    let best: TouchButton | null = null, bestD = Infinity;
    for (const name of TOUCH_BUTTONS) {
      const c = this.layout.buttons[name];
      const d = Math.hypot(x - c.x, y - c.y) / c.r;
      if (d <= SLOP && d < bestD) { best = name; bestD = d; }
    }
    return best;
  }
}
