import { B, EMPTY_INPUT, type InputFrame } from "../../../shared/input";

export type DeviceId = "kb1" | "kb2" | `pad${number}`;

export interface KeyBindings {
  left: string[]; right: string[]; up: string[]; down: string[];
  jump: string[]; attack: string[]; special: string[]; shield: string[]; smash: string[]; taunt: string[]; pause: string[];
  /** Directional attacks: the keyboard's right stick (smashes on the ground, aerials in the air). */
  cUp: string[]; cDown: string[]; cLeft: string[]; cRight: string[];
}
export type KeyAction = keyof KeyBindings;
export const KB1_DEFAULT: Readonly<KeyBindings> = {
  left: ["KeyA"], right: ["KeyD"], up: ["KeyW"], down: ["KeyS"],
  jump: ["Space"], attack: ["Mouse0"], special: ["KeyE", "Mouse2"], shield: ["ShiftLeft"], smash: ["KeyR"], taunt: ["KeyT"], pause: ["Escape"],
  cUp: [], cDown: [], cLeft: [], cRight: [],
};
const KB2: KeyBindings = {
  left: ["ArrowLeft"], right: ["ArrowRight"], up: ["ArrowUp"], down: ["ArrowDown"],
  jump: ["Numpad0"], attack: ["Numpad1"], special: ["Numpad2"], shield: ["Numpad3", "ShiftRight"], smash: ["Numpad6"], taunt: ["Numpad5"], pause: ["Escape"],
  cUp: [], cDown: [], cLeft: [], cRight: [],
};

/** Keyboard player 1's bindings: the defaults with the player's overrides from settings on top. */
let kb1: KeyBindings = withOverrides({});
function withOverrides(overrides: Partial<KeyBindings>): KeyBindings {
  const out = {} as KeyBindings;
  for (const a of Object.keys(KB1_DEFAULT) as KeyAction[]) out[a] = [...(overrides[a] ?? KB1_DEFAULT[a])];
  return out;
}
export function kb1Bindings(): Readonly<KeyBindings> { return kb1; }
export function setKb1Overrides(overrides: Partial<KeyBindings>): void { kb1 = withOverrides(overrides); }

/** A readable name for a KeyboardEvent.code or Mouse<button>. */
export function keyName(code: string): string {
  const named: Record<string, string> = {
    Mouse0: "LEFT CLICK", Mouse1: "MIDDLE CLICK", Mouse2: "RIGHT CLICK", Space: "SPACE", Escape: "ESC", Enter: "ENTER", Tab: "TAB",
    ArrowUp: "UP ARROW", ArrowDown: "DOWN ARROW", ArrowLeft: "LEFT ARROW", ArrowRight: "RIGHT ARROW", Backspace: "BACKSPACE", CapsLock: "CAPS",
    ShiftLeft: "L SHIFT", ShiftRight: "R SHIFT", ControlLeft: "L CTRL", ControlRight: "R CTRL", AltLeft: "L ALT", AltRight: "R ALT",
    MetaLeft: "L CMD", MetaRight: "R CMD", Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/", Backslash: "\\",
    BracketLeft: "[", BracketRight: "]", Minus: "-", Equal: "=", Backquote: "`",
  };
  if (named[code]) return named[code];
  const m = /^(?:Key|Digit)(.)$/.exec(code);
  if (m) return m[1];
  if (code.startsWith("Numpad")) return `NUM ${code.slice(6).toUpperCase()}`;
  if (code.startsWith("Mouse")) return `MOUSE ${code.slice(5)}`;
  return code.toUpperCase();
}

const keys = new Set<string>();
const pressedThisFrame = new Set<string>();
// input frame each key went down on: directional attack keys reach the sim as a short pulse, like a flicked right stick
let inputFrame = 0;
const pressedAt = new Map<string, number>();
const typedThisFrame: string[] = [];
let anyPress = false;
window.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  // text fields own their keystrokes
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  keys.add(e.code);
  pressedThisFrame.add(e.code);
  pressedAt.set(e.code, inputFrame);
  if (/^[a-z0-9]$/i.test(e.key)) typedThisFrame.push(e.key.toUpperCase());
  if (e.key === "Backspace") typedThisFrame.push("\b");
  if (e.key === "Enter") typedThisFrame.push("\n");
  anyPress = true;
  if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab"].includes(e.code)) e.preventDefault();
});
window.addEventListener("keyup", (e) => keys.delete(e.code));
// mouse buttons are keys named Mouse<button>; menus and join prompts leave them alone (`mouse: false`)
const isMouse = (code: string) => code.startsWith("Mouse");
window.addEventListener("pointerdown", (e) => { if (e.pointerType !== "mouse") return; keys.add(`Mouse${e.button}`); pressedThisFrame.add(`Mouse${e.button}`); pressedAt.set(`Mouse${e.button}`, inputFrame); });
window.addEventListener("pointerup", (e) => { if (e.pointerType === "mouse") keys.delete(`Mouse${e.button}`); });
window.addEventListener("pointercancel", (e) => { if (e.pointerType === "mouse") keys.delete(`Mouse${e.button}`); });
window.addEventListener("contextmenu", (e) => { if (!(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) e.preventDefault(); });
window.addEventListener("blur", () => keys.clear());

const padPrev = new Map<number, { ax: number; ay: number; cx: number; cy: number; jumpFlick: number; cFlick: number }>();

function padState(index: number) {
  const gp = navigator.getGamepads?.()[index];
  if (!gp) return null;
  let prev = padPrev.get(index);
  if (!prev) { prev = { ax: 0, ay: 0, cx: 0, cy: 0, jumpFlick: 0, cFlick: 0 }; padPrev.set(index, prev); }
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
export function readDevice(dev: DeviceId, opts: { tapJump: boolean; mouse?: boolean } = { tapJump: true }): InputFrame {
  if (dev === "kb1" || dev === "kb2") {
    const b = dev === "kb1" ? kb1 : KB2;
    // a tap that started and ended between two frames still counts for one frame
    const down = (list: string[]) => list.some((k) => (opts.mouse !== false || !isMouse(k)) && (keys.has(k) || pressedThisFrame.has(k)));
    const pulse = (list: string[]) => list.some((k) => (opts.mouse !== false || !isMouse(k)) && inputFrame - (pressedAt.get(k) ?? -10) <= 1 && (keys.has(k) || pressedThisFrame.has(k)));
    const x = (down(b.right) ? 100 : 0) - (down(b.left) ? 100 : 0);
    const y = (down(b.down) ? 100 : 0) - (down(b.up) ? 100 : 0);
    const cx = (pulse(b.cRight) ? 100 : 0) - (pulse(b.cLeft) ? 100 : 0);
    const cy = (pulse(b.cDown) ? 100 : 0) - (pulse(b.cUp) ? 100 : 0);
    let bits = B.DIGITAL;
    if (down(b.jump)) bits |= B.JUMP;
    if (down(b.attack)) bits |= B.ATTACK;
    if (down(b.special)) bits |= B.SPECIAL;
    if (down(b.shield)) bits |= B.SHIELD;
    if (down(b.smash)) bits |= B.SMASH | B.ATTACK;
    if (down(b.taunt)) bits |= B.TAUNT;
    if (down(b.pause)) bits |= B.PAUSE;
    return { x, y, cx, cy, b: bits };
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

/** Menu navigation: edge-triggered directions and confirm/back from every device at once. */
export interface MenuInput { up: boolean; down: boolean; left: boolean; right: boolean; confirm: boolean; back: boolean; start: boolean; any: boolean; from: DeviceId | null }
const menuPrev = new Map<string, InputFrame>();
export function readMenu(devices: DeviceId[]): MenuInput {
  const m: MenuInput = { up: false, down: false, left: false, right: false, confirm: false, back: false, start: false, any: false, from: null };
  for (const d of devices) {
    const now = readDevice(d, { tapJump: false, mouse: false });
    const prev = menuPrev.get(d) ?? EMPTY_INPUT;
    const edge = (bit: number) => (now.b & bit) && !(prev.b & bit);
    const dir = (v: number, pv: number, sgn: number) => sgn * v >= 60 && sgn * pv < 60;
    let hit = false;
    if (dir(now.y, prev.y, -1)) { m.up = true; hit = true; }
    if (dir(now.y, prev.y, 1)) { m.down = true; hit = true; }
    if (dir(now.x, prev.x, -1)) { m.left = true; hit = true; }
    if (dir(now.x, prev.x, 1)) { m.right = true; hit = true; }
    if (edge(B.ATTACK) || edge(B.JUMP)) { m.confirm = true; hit = true; }
    if (d.startsWith("pad")) {
      if (edge(B.SPECIAL)) { m.back = true; hit = true; }
      if (edge(B.PAUSE)) { m.start = true; hit = true; }
    }
    if (hit) { m.any = true; m.from = d; }
    menuPrev.set(d, now);
  }
  // universal keyboard menu keys, whatever the fighter bindings say
  if (pressedThisFrame.has("Enter") || pressedThisFrame.has("NumpadEnter")) { m.confirm = true; m.start = true; m.any = true; m.from ??= "kb1"; }
  if (pressedThisFrame.has("Escape") || pressedThisFrame.has("Backspace")) { m.back = true; m.any = true; m.from ??= "kb1"; }
  if (anyPress) m.any = true;
  return m;
}

export function consumeTypedChars(): string[] {
  return typedThisFrame.splice(0);
}

/** The first key or mouse button pressed this frame, for binding screens. */
export function takeKeyPress(): string | null {
  const [first] = pressedThisFrame;
  return first ?? null;
}

export function endInputFrame(): void {
  inputFrame++;
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
