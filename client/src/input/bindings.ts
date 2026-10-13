/** Keyboard layouts: which keys (KeyboardEvent.code, or Mouse<button>) do each action. */
export interface KeyBindings {
  left: string[]; right: string[]; up: string[]; down: string[];
  jump: string[]; attack: string[]; special: string[]; shield: string[]; taunt: string[]; pause: string[];
  /** Smash right away in the direction held (no direction: the way you last moved), as a right-stick flick. */
  smash: string[];
}
export type KeyAction = keyof KeyBindings;
export const KB1_DEFAULT: Readonly<KeyBindings> = {
  left: ["KeyA"], right: ["KeyD"], up: ["KeyW"], down: ["KeyS"],
  jump: ["Space"], attack: ["Mouse0", "KeyF"], special: ["KeyE", "Mouse2"], shield: ["ShiftLeft"], taunt: ["KeyT"], pause: ["Escape"], smash: ["KeyR"],
};
const KEY_ACTIONS = Object.keys(KB1_DEFAULT) as KeyAction[];
export const KB2_DEFAULT: Readonly<KeyBindings> = {
  left: ["ArrowLeft"], right: ["ArrowRight"], up: ["ArrowUp"], down: ["ArrowDown"],
  // the keys right of the letters, so two can share a laptop with keyboard 1 on the left
  jump: ["Slash"], attack: ["Period"], special: ["Comma"], shield: ["ShiftRight"], taunt: ["Quote"], pause: ["Escape"], smash: ["Semicolon"],
};

/** The two keyboard players: 1 on the left of the keyboard (and the mouse), 2 on the right. */
export type Keyboard = "kb1" | "kb2";
const DEFAULTS: Record<Keyboard, Readonly<KeyBindings>> = { kb1: KB1_DEFAULT, kb2: KB2_DEFAULT };

/** Each keyboard player's bindings: the defaults with the player's overrides from settings on top. */
const current: Record<Keyboard, KeyBindings> = { kb1: withOverrides("kb1", {}), kb2: withOverrides("kb2", {}) };
function withOverrides(kb: Keyboard, overrides: Partial<KeyBindings>): KeyBindings {
  const out = {} as KeyBindings;
  for (const a of KEY_ACTIONS) out[a] = [...(overrides[a] ?? DEFAULTS[kb][a])];
  return out;
}
export function bindingsOf(kb: Keyboard): Readonly<KeyBindings> { return current[kb]; }
export function setOverrides(kb: Keyboard, overrides: Partial<KeyBindings>): void { current[kb] = withOverrides(kb, overrides); }

/** The actions whose keys differ from that keyboard's defaults (what settings keep). */
export function overridesOf(kb: Keyboard, b: Readonly<KeyBindings>): Partial<KeyBindings> {
  const out: Partial<KeyBindings> = {};
  for (const a of KEY_ACTIONS) if (b[a].join() !== DEFAULTS[kb][a].join()) out[a] = [...b[a]];
  return out;
}

/** `b` without `code` anywhere: the other keyboard player taking a key. */
export function release(b: Readonly<KeyBindings>, code: string): KeyBindings {
  const next = {} as KeyBindings;
  for (const a of KEY_ACTIONS) next[a] = b[a].filter((k) => k !== code);
  return next;
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
