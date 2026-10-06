/** Keyboard layouts: which keys (KeyboardEvent.code, or Mouse<button>) do each action. */
export interface KeyBindings {
  left: string[]; right: string[]; up: string[]; down: string[];
  jump: string[]; attack: string[]; special: string[]; shield: string[]; taunt: string[]; pause: string[];
}
export type KeyAction = keyof KeyBindings;
export const KB1_DEFAULT: Readonly<KeyBindings> = {
  left: ["KeyA"], right: ["KeyD"], up: ["KeyW"], down: ["KeyS"],
  jump: ["Space"], attack: ["Mouse0"], special: ["KeyE", "Mouse2"], shield: ["ShiftLeft"], taunt: ["KeyT"], pause: ["Escape"],
};
const KEY_ACTIONS = Object.keys(KB1_DEFAULT) as KeyAction[];
export const KB2: Readonly<KeyBindings> = {
  left: ["ArrowLeft"], right: ["ArrowRight"], up: ["ArrowUp"], down: ["ArrowDown"],
  jump: ["Numpad0"], attack: ["Numpad1"], special: ["Numpad2"], shield: ["Numpad3", "ShiftRight"], taunt: ["Numpad5"], pause: ["Escape"],
};

/** Keyboard player 1's bindings: the defaults with the player's overrides from settings on top. */
let kb1: KeyBindings = withOverrides({});
function withOverrides(overrides: Partial<KeyBindings>): KeyBindings {
  const out = {} as KeyBindings;
  for (const a of KEY_ACTIONS) out[a] = [...(overrides[a] ?? KB1_DEFAULT[a])];
  return out;
}
export function kb1Bindings(): Readonly<KeyBindings> { return kb1; }
export function setKb1Overrides(overrides: Partial<KeyBindings>): void { kb1 = withOverrides(overrides); }

/** The actions whose keys differ from keyboard 1's defaults (what settings keep). */
export function kb1OverridesOf(b: Readonly<KeyBindings>): Partial<KeyBindings> {
  const out: Partial<KeyBindings> = {};
  for (const a of KEY_ACTIONS) if (b[a].join() !== KB1_DEFAULT[a].join()) out[a] = [...b[a]];
  return out;
}

/**
 * `b` with `code` doing `action` in place of its key `old` (null: an action with no key yet). The key
 * comes off whatever did it before; an action that leaves without a key gets `old` instead, a swap.
 */
export function rebind(b: Readonly<KeyBindings>, action: KeyAction, old: string | null, code: string): KeyBindings {
  const next = {} as KeyBindings;
  for (const a of KEY_ACTIONS) next[a] = b[a].filter((k) => k !== code);
  next[action] = [...new Set(old === null ? [...b[action], code] : b[action].map((k) => (k === old ? code : k)))];
  if (old !== null) for (const a of KEY_ACTIONS) if (!next[a].length && b[a].length) next[a] = [old];
  return next;
}

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
