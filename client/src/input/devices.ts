import { B, EMPTY_INPUT, type InputFrame } from "../../../shared/input";

export type DeviceId = "kb1" | "kb2" | `pad${number}`;

export interface KeyBindings {
  left: string[]; right: string[]; up: string[]; down: string[];
  jump: string[]; attack: string[]; special: string[]; shield: string[]; grab: string[]; smash: string[]; taunt: string[]; pause: string[];
}
export const KB1: KeyBindings = {
  left: ["KeyA"], right: ["KeyD"], up: ["KeyW"], down: ["KeyS"],
  jump: ["KeyW", "Space"], attack: ["KeyJ"], special: ["KeyK"], shield: ["KeyL", "ShiftLeft"], grab: ["KeyI"], smash: ["KeyU"], taunt: ["KeyT"], pause: ["Escape"],
};
export const KB2: KeyBindings = {
  left: ["ArrowLeft"], right: ["ArrowRight"], up: ["ArrowUp"], down: ["ArrowDown"],
  jump: ["ArrowUp", "Numpad0"], attack: ["Numpad1"], special: ["Numpad2"], shield: ["Numpad3", "ShiftRight"], grab: ["Numpad4"], smash: ["Numpad6"], taunt: ["Numpad5"], pause: ["Escape"],
};

const keys = new Set<string>();
const pressedThisFrame = new Set<string>();
const typedThisFrame: string[] = [];
let anyPress = false;
window.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  keys.add(e.code);
  pressedThisFrame.add(e.code);
  if (/^[a-z0-9]$/i.test(e.key)) typedThisFrame.push(e.key.toUpperCase());
  if (e.key === "Backspace") typedThisFrame.push("\b");
  if (e.key === "Enter") typedThisFrame.push("\n");
  anyPress = true;
  if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab"].includes(e.code)) e.preventDefault();
});
window.addEventListener("keyup", (e) => keys.delete(e.code));
window.addEventListener("blur", () => keys.clear());

const padPrev = new Map<number, { buttons: boolean[]; ax: number; ay: number; cx: number; cy: number; jumpFlick: number; cFlick: number }>();

function padState(index: number) {
  const gp = navigator.getGamepads?.()[index];
  if (!gp) return null;
  let prev = padPrev.get(index);
  if (!prev) { prev = { buttons: [], ax: 0, ay: 0, cx: 0, cy: 0, jumpFlick: 0, cFlick: 0 }; padPrev.set(index, prev); }
  return { gp, prev };
}

function dz(v: number, dead = 0.18): number {
  const a = Math.abs(v);
  if (a < dead) return 0;
  const t = (a - dead) / (1 - dead);
  return Math.sign(v) * Math.min(1, t);
}
const q = (v: number): number => Math.round(v * 100);

/** Reads a device into a sim input frame. Call once per sim frame. */
export function readDevice(dev: DeviceId, opts: { tapJump: boolean } = { tapJump: true }): InputFrame {
  if (dev === "kb1" || dev === "kb2") {
    const b = dev === "kb1" ? KB1 : KB2;
    // a tap that started and ended between two frames still counts for one frame
    const down = (list: string[]) => list.some((k) => keys.has(k) || pressedThisFrame.has(k));
    const x = (down(b.right) ? 100 : 0) - (down(b.left) ? 100 : 0);
    const y = (down(b.down) ? 100 : 0) - (down(b.up) && !down(b.jump.filter((k) => !b.up.includes(k))) ? 0 : 0) - (down(b.up) ? 100 : 0);
    let bits = 0;
    if (down(b.jump)) bits |= B.JUMP;
    if (down(b.attack)) bits |= B.ATTACK;
    if (down(b.special)) bits |= B.SPECIAL;
    if (down(b.shield)) bits |= B.SHIELD;
    if (down(b.grab)) bits |= B.GRAB;
    if (down(b.smash)) bits |= B.SMASH;
    if (down(b.taunt)) bits |= B.TAUNT;
    if (down(b.pause)) bits |= B.PAUSE;
    // W is both up and jump on keyboard 1; up-as-jump means y should not read as "up" for tilts when jumping.
    return { x, y: y < -100 ? -100 : y, cx: 0, cy: 0, b: bits };
  }
  const idx = Number(dev.slice(3));
  const s = padState(idx);
  if (!s) return { ...EMPTY_INPUT };
  const { gp, prev } = s;
  const btn = (i: number) => !!gp.buttons[i]?.pressed || (gp.buttons[i]?.value ?? 0) > 0.5;
  let ax = dz(gp.axes[0] ?? 0), ay = dz(gp.axes[1] ?? 0);
  const cx = dz(gp.axes[2] ?? 0, 0.3), cy = dz(gp.axes[3] ?? 0, 0.3);
  if (btn(14)) ax = -1; if (btn(15)) ax = 1; if (btn(12)) ay = -1; if (btn(13)) ay = 1;
  let bits = 0;
  if (btn(0)) bits |= B.ATTACK;
  if (btn(1)) bits |= B.SPECIAL;
  if (btn(2) || btn(3)) bits |= B.JUMP;
  if (btn(4) || btn(5) || btn(6)) bits |= B.SHIELD;
  if (btn(7)) bits |= B.GRAB;
  if (btn(9)) bits |= B.PAUSE;
  if (btn(13) && !btn(12)) bits |= B.TAUNT;
  // tap jump: a stick flick up counts as a jump press for 2 frames and holds while the stick stays up
  if (opts.tapJump) {
    if (ay < -0.7 && prev.ay >= -0.4) prev.jumpFlick = 2;
    if (prev.jumpFlick > 0 || (ay < -0.7 && prev.jumpFlick === 0 && prev.ay < -0.7)) bits |= B.JUMP;
    if (prev.jumpFlick > 0) prev.jumpFlick--;
  }
  // c-stick is a pulse: only the first 2 frames of a flick reach the sim
  const cmag = Math.max(Math.abs(cx), Math.abs(cy));
  const pmag = Math.max(Math.abs(prev.cx), Math.abs(prev.cy));
  if (cmag >= 0.7 && pmag < 0.5) prev.cFlick = 2;
  const sendC = prev.cFlick > 0;
  if (prev.cFlick > 0) prev.cFlick--;
  prev.ax = ax; prev.ay = ay; prev.cx = cx; prev.cy = cy;
  return { x: q(ax), y: q(ay), cx: sendC ? q(cx) : 0, cy: sendC ? q(cy) : 0, b: bits };
}

/** Which devices pressed something this frame (for "press a button to join"). */
export function pollJoinPresses(): DeviceId[] {
  const out: DeviceId[] = [];
  if (pressedThisFrame.size) {
    const kb1 = [...KB1.jump, ...KB1.attack, ...KB1.special, ...KB1.shield, ...KB1.grab];
    const kb2 = [...KB2.jump, ...KB2.attack, ...KB2.special, ...KB2.shield, ...KB2.grab];
    if ([...pressedThisFrame].some((k) => kb1.includes(k))) out.push("kb1");
    if ([...pressedThisFrame].some((k) => kb2.includes(k))) out.push("kb2");
  }
  const pads = navigator.getGamepads?.() ?? [];
  for (let i = 0; i < pads.length; i++) {
    const gp = pads[i];
    if (!gp) continue;
    const s = padState(i)!;
    const now = gp.buttons.map((b) => b.pressed);
    const was = s.prev.buttons;
    if (now.some((p, j) => p && !was[j] && j < 8)) out.push(`pad${i}`);
    s.prev.buttons = now;
  }
  return out;
}

/** Menu navigation: edge-triggered directions and confirm/back from every device at once. */
export interface MenuInput { up: boolean; down: boolean; left: boolean; right: boolean; confirm: boolean; back: boolean; start: boolean; any: boolean; from: DeviceId | null }
const menuPrev = new Map<string, InputFrame>();
export function readMenu(devices: DeviceId[]): MenuInput {
  const m: MenuInput = { up: false, down: false, left: false, right: false, confirm: false, back: false, start: false, any: false, from: null };
  for (const d of devices) {
    const now = readDevice(d, { tapJump: false });
    const prev = menuPrev.get(d) ?? EMPTY_INPUT;
    const edge = (bit: number) => (now.b & bit) && !(prev.b & bit);
    const dir = (v: number, pv: number, sgn: number) => sgn * v >= 60 && sgn * pv < 60;
    let hit = false;
    if (dir(now.y, prev.y, -1)) { m.up = true; hit = true; }
    if (dir(now.y, prev.y, 1)) { m.down = true; hit = true; }
    if (dir(now.x, prev.x, -1)) { m.left = true; hit = true; }
    if (dir(now.x, prev.x, 1)) { m.right = true; hit = true; }
    if (edge(B.ATTACK) || edge(B.JUMP)) { m.confirm = true; hit = true; }
    if (edge(B.SPECIAL) || edge(B.SHIELD)) { m.back = true; hit = true; }
    if (edge(B.PAUSE)) { m.start = true; hit = true; }
    if (hit) { m.any = true; m.from = d; }
    menuPrev.set(d, now);
  }
  if (anyPress) m.any = true;
  return m;
}

export function consumeTypedChars(): string[] {
  return typedThisFrame.splice(0);
}

export function endInputFrame(): void {
  pressedThisFrame.clear();
  typedThisFrame.length = 0;
  anyPress = false;
}

export function connectedPads(): number[] {
  const pads = navigator.getGamepads?.() ?? [];
  const out: number[] = [];
  for (let i = 0; i < pads.length; i++) if (pads[i]) out.push(i);
  return out;
}

export function rumble(dev: DeviceId, strong: number, weak: number, ms: number): void {
  if (!dev.startsWith("pad")) return;
  const gp = navigator.getGamepads?.()[Number(dev.slice(3))];
  const act = (gp as any)?.vibrationActuator;
  if (act?.playEffect) act.playEffect("dual-rumble", { duration: ms, strongMagnitude: strong, weakMagnitude: weak }).catch(() => {});
}
