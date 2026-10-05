/** One player's input for one sim frame. Sticks are integers in -100..100. */
export interface InputFrame {
  x: number;
  y: number; // up is negative (screen space)
  cx: number;
  cy: number;
  b: number; // button bitmask
}

export const B = {
  JUMP: 1,
  ATTACK: 2,
  SPECIAL: 4,
  SHIELD: 8,
  /** Keyboard: directions are on/off, so a key press is never a smash flick. */
  DIGITAL: 16,
  TAUNT: 32,
  PAUSE: 64,
  SMASH: 128, // keyboard smash key: an attack that is always a smash
  /** Online only: the relay decided this player away for the frame (their inputs stopped reaching it). Never a button. */
  AWAY: 256,
} as const;

export const EMPTY_INPUT: InputFrame = { x: 0, y: 0, cx: 0, cy: 0, b: 0 };

export function inputEquals(a: InputFrame, b: InputFrame): boolean {
  return a.x === b.x && a.y === b.y && a.cx === b.cx && a.cy === b.cy && a.b === b.b;
}
export function cloneInput(i: InputFrame): InputFrame {
  return { x: i.x, y: i.y, cx: i.cx, cy: i.cy, b: i.b };
}

/** Compact wire format: 5 small integers. */
export function packInput(i: InputFrame): number[] {
  return [i.x, i.y, i.cx, i.cy, i.b];
}
export function unpackInput(a: number[]): InputFrame {
  return { x: a[0] | 0, y: a[1] | 0, cx: a[2] | 0, cy: a[3] | 0, b: a[4] | 0 };
}

export const STICK_DEAD = 25;
export const STICK_WALK = 25; // above dead: walk
export const STICK_RUN = 70; // above: run / smash flick threshold
