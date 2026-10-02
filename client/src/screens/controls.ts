import { VIEW_W } from "../render/camera";
import { KB1_DEFAULT, kb1Bindings, keyName, takeKeyPress, type KeyAction, type MenuInput } from "../input/devices";
import { sfx } from "../audio/audio";
import { bg, button, card, clicked, hint, hover, label, title, backButton, goTo, type Screen, INK, settings, saveSettings } from "./ui";

const COLUMNS: [KeyAction, string][][] = [
  [["left", "MOVE LEFT"], ["right", "MOVE RIGHT"], ["up", "UP"], ["down", "DOWN"], ["jump", "JUMP"], ["shield", "SHIELD"], ["taunt", "TAUNT"]],
  [["attack", "ATTACK"], ["special", "SPECIAL"], ["smash", "SMASH (+ direction)"], ["cUp", "ATTACK UP"], ["cDown", "ATTACK DOWN"], ["cLeft", "ATTACK LEFT"], ["cRight", "ATTACK RIGHT"]],
];
const ROWS = COLUMNS[0].length;
const COL_X = [VIEW_W / 2 - 860, VIEW_W / 2 + 40];
const COL_W = 820, ROW_H = 72, ROW_GAP = 86, TOP = 170;
const rowY = (r: number): number => TOP + r * ROW_GAP;
const RESET_Y = rowY(ROWS) + 20;

/** Keyboard player 1's keys: pick an action, press the key (or mouse button) for it. */
export class ControlsScreen implements Screen {
  t = 0;
  col = 0;
  row = 0;
  /** The action waiting for a key, and whether this frame's presses are still the ones that opened it. */
  listening: { action: KeyAction; armed: boolean } | null = null;
  constructor(private onBack: () => Screen) {}

  update(dt: number, m: MenuInput): Screen | null {
    this.t += dt;
    if (this.listening) {
      if (!this.listening.armed) { this.listening.armed = true; return null; }
      const code = takeKeyPress();
      if (code === "Escape") { this.listening = null; sfx.menuBack(); }
      else if (code) { this.bind(this.listening.action, code); this.listening = null; sfx.menuMove(); }
      return null;
    }
    if (m.up) { this.row = (this.row + ROWS) % (ROWS + 1); sfx.menuMove(); }
    if (m.down) { this.row = (this.row + 1) % (ROWS + 1); sfx.menuMove(); }
    if ((m.left || m.right) && this.row < ROWS) { this.col = 1 - this.col; sfx.menuMove(); }
    if (m.confirm) {
      if (this.row === ROWS) this.reset();
      else this.listen(COLUMNS[this.col][this.row][0]);
      return null;
    }
    if (m.back || m.start) { sfx.menuBack(); return this.onBack(); }
    return null;
  }

  private listen(action: KeyAction): void {
    this.listening = { action, armed: false };
    sfx.menuMove();
  }

  /** The key now does only this action: it comes off any other action that had it. */
  private bind(action: KeyAction, code: string): void {
    const b = kb1Bindings();
    const next: Partial<Record<KeyAction, string[]>> = {};
    for (const a of Object.keys(b) as KeyAction[]) {
      const keys = a === action ? [code] : b[a].filter((k) => k !== code);
      if (keys.join() !== KB1_DEFAULT[a].join()) next[a] = keys;
    }
    settings.keys = next;
    saveSettings();
  }

  private reset(): void {
    settings.keys = {};
    saveSettings();
    sfx.menuBack();
  }

  draw(ctx: CanvasRenderingContext2D): void {
    bg(ctx, this.t);
    title(ctx, "CONTROLS", VIEW_W / 2, 90, 64);
    label(ctx, "KEYBOARD 1", VIEW_W / 2, 132, 22, INK, "center", 700);
    const b = kb1Bindings();
    COLUMNS.forEach((rows, c) => rows.forEach(([action, name], r) => {
      const x = COL_X[c], y = rowY(r);
      const sel = c === this.col && r === this.row;
      const waiting = this.listening?.action === action;
      if (!this.listening && hover(x, y, COL_W, ROW_H)) { this.col = c; this.row = r; }
      if (!this.listening && clicked(x, y, COL_W, ROW_H)) this.listen(action);
      card(ctx, x, y, COL_W, ROW_H, "", sel || waiting);
      label(ctx, name, x + 28, y + 47, 26, INK, "left", 900);
      const keys = waiting ? "PRESS A KEY…" : b[action].length ? b[action].map(keyName).join(" / ") : "—";
      label(ctx, keys, x + COL_W - 28, y + 47, 26, waiting ? "#c8402c" : INK, "right", 700, COL_W / 2);
    }));
    if (button(ctx, VIEW_W / 2 - 200, RESET_Y, 400, 64, "RESET TO DEFAULT", { focused: this.row === ROWS, size: 24 }) && !this.listening) this.reset();
    if (backButton(ctx) && !this.listening) { sfx.menuBack(); goTo(this.onBack()); }
    hint(ctx, this.listening ? "press the new key or mouse button · Esc: cancel" : "click an action, or arrows + Enter, then press its new key · Esc: back");
  }
}
