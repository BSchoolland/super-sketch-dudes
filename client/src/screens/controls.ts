import { VIEW_H, VIEW_W } from "../render/camera";
import { FONT, INK, PENCIL, inkLine } from "../render/paper";
import { keyHeld, rumble, takeKeyPress, type DeviceId, type MenuInput } from "../input/devices";
import { bindingsOf, keyName, overridesOf, rebind, release, type KeyAction, type Keyboard } from "../input/bindings";
import { pointer, type ViewPoint } from "../input/pointer";
import { sfx } from "../audio/audio";
import { ButtonMenu, inside, type Button } from "./buttons";
import { label, title, settings, saveSettings } from "./ui";
import { MOUSE_BUTTONS, RED, drawKey, legendOf, type KeyLook, type Rect } from "./keyboardmap";
import { PAD_PARTS, drawGamepad, padStyleOf, partPoint } from "./gamepadmap";

type Pt = { x: number; y: number };

/** A keyboard player's actions as the drawing names them; MOVE's four keys share a label. Pause stays on Esc. */
const GROUPS: { name: string; note?: string; actions: KeyAction[] }[] = [
  { name: "MOVE", note: "also aims attacks and specials", actions: ["up", "left", "down", "right"] },
  { name: "JUMP", note: "press again in the air to double jump", actions: ["jump"] },
  { name: "ATTACK", note: "hold it to SMASH", actions: ["attack"] },
  { name: "SPECIAL", note: "up + special flies you back", actions: ["special"] },
  { name: "SHIELD", note: "+ a direction: dodge", actions: ["shield"] },
  { name: "SMASH", note: "+ a direction: smash right away", actions: ["smash"] },
  { name: "TAUNT", actions: ["taunt"] },
];
const MARK: Partial<Record<KeyAction, string>> = { up: "▲", left: "◀", down: "▼", right: "▶" };

/** One key doing one action, where the drawing has it (code null: an action left with no key). */
interface Slot { action: KeyAction; code: string | null; group: number; rect: Rect; row: number; mouse: boolean }

/** A label written beside the drawing with lines to what it names. */
interface Callout { name: string; note?: string; x: number; y: number; w: number; above: boolean; slots: Slot[]; to: Pt[]; box: Rect }

const NAME = 40, NOTE = 25;
/** The list: one row per action, its keys as caps after the name, the note after the caps. */
const LIST = { top: 250, rowH: 82, nameX: 620, capsX: 660, capH: 66, gap: 14, noteGap: 36 };
/** What a cap says: punctuation by name (a lone "." is hard to see), the spacebar as SPACE. */
const WORDS: Record<string, string> = { Space: "SPACE", Period: ". PERIOD", Comma: ", COMMA", Slash: "/ SLASH", Semicolon: "; SEMICOLON", Quote: "' QUOTE", ShiftLeft: "SHIFT", ShiftRight: "RIGHT SHIFT" };
const capText = (code: string): string => WORDS[code] ?? (legendOf(code, keyName(code)) || keyName(code));
const capWidth = (code: string | null): number => (code === null ? 90 : Math.max(70, 34 + capText(code).length * 19));
const ARROW_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

const PAD_CALLOUTS: { name: string; note?: string; x: number; y: number; parts: (keyof typeof PAD_PARTS)[] }[] = [
  { name: "SHIELD", x: 560, y: 250, parts: ["lt", "lb"] },
  { name: "TAUNT", x: 850, y: 250, parts: ["back"] },
  { name: "PAUSE", x: 1070, y: 250, parts: ["start"] },
  { name: "SHIELD", x: 1360, y: 250, parts: ["rt", "rb"] },
  { name: "MOVE", note: "flick it with ATTACK: SMASH", x: 330, y: 500, parts: ["lstick", "dpad"] },
  { name: "JUMP", note: "again in the air", x: 1600, y: 370, parts: ["y", "x"] },
  { name: "SPECIAL", note: "up + special flies you back", x: 1600, y: 485, parts: ["b"] },
  { name: "ATTACK", x: 1600, y: 600, parts: ["a"] },
  { name: "SMASH", note: "in the air: air attacks", x: 1600, y: 715, parts: ["rstick"] },
];
const CHECKS = { y: 860, h: 80 };
/** PLAYER 1 / PLAYER 2: whose keys the drawing shows and changes. */
const PLAYER_TABS = { y: 150, w: 260, h: 70, gap: 30 };
const SETTINGS_KEY: Record<Keyboard, "keys" | "keys2"> = { kb1: "keys", kb2: "keys2" };
const OTHER: Record<Keyboard, Keyboard> = { kb1: "kb2", kb2: "kb1" };

function textWidth(ctx: CanvasRenderingContext2D, text: string, size: number, weight: number): number {
  ctx.save();
  ctx.font = `${weight} ${size}px ${FONT}`;
  const w = ctx.measureText(text).width;
  ctx.restore();
  return w;
}

/** A label: the name in ink, a note under it in pencil, and a line from `from` to each point in `to`, dotted at the end. */
function drawCallout(ctx: CanvasRenderingContext2D, c: { name: string; note?: string; x: number; y: number; w: number }, from: Pt, to: Pt[], color: string, underline: boolean): void {
  for (const p of to) {
    inkLine(ctx, from.x, from.y, p.x, p.y, color, 2, Math.round(p.x + p.y));
    ctx.beginPath(); ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
  }
  title(ctx, c.name, c.x, c.y, NAME, color);
  if (underline) inkLine(ctx, c.x - c.w / 2, c.y + 8, c.x + c.w / 2, c.y + 5, color, 3);
  if (c.note) label(ctx, c.note, c.x, c.y + 32, NOTE, color === INK ? PENCIL : color, "center", 600);
}

/**
 * The CONTROLS tab: whichever device is in hand, drawn, with what each part does written beside it.
 * Keyboard 1's keys change by picking one on the drawing and pressing the new key; the gamepad's
 * two settings sit under its drawing.
 */
export class ControlsPage {
  private menu = new ButtonMenu();
  private view: "keys" | "pad" = "keys";
  private pad: DeviceId = "pad0";
  /** Whose keys the keyboard drawing is. */
  private player: Keyboard = "kb1";
  /** Keys still to press, in order (MOVE's label asks for all four); `old` is the key being replaced. */
  private waiting: { queue: { action: KeyAction; old: string | null }[]; armed: boolean } | null = null;
  /** A mouse button just bound: the click it makes is ignored until it lets go. */
  private eating: string | null = null;
  /** The labels as last drawn: clicking one rebinds what it points at. */
  private callouts: Callout[] = [];
  private seen = { x: pointer.x, y: pointer.y };

  /** The tab was opened from `from` (null: a click), which picks the drawing. */
  show(from: DeviceId | null): void {
    this.view = from?.startsWith("pad") ? "pad" : "keys";
    if (from?.startsWith("pad")) this.pad = from;
    this.menu.focus = 0;
  }

  /** Waiting for a key, or for the mouse button just bound to come up: Esc and clicks belong to the page. */
  get busy(): boolean {
    return !!this.waiting || !!this.eating;
  }

  get hint(): string {
    if (this.waiting) return "press the new key or mouse button · Esc: cancel";
    if (this.view === "keys") return "click a key, or arrows + Enter, to change it · Esc: back";
    return padStyleOf(this.padId()) === "playstation" ? "stick: pick · ✕: change · ○: back" : "stick: pick · A: change · B: back";
  }

  tabFocused(tab: Button): boolean {
    return this.menu.focused(this.buttons(tab))?.id === "tab";
  }

  private slots(): Slot[] {
    const b = bindingsOf(this.player);
    const out: Slot[] = [];
    GROUPS.forEach((g, group) => {
      let x = LIST.capsX;
      const y = LIST.top + group * LIST.rowH;
      for (const action of g.actions) {
        for (const code of b[action].length ? b[action] : [null]) {
          const w = capWidth(code);
          out.push({ action, code, group, rect: { x, y, w, h: LIST.capH }, row: group, mouse: code !== null && code in MOUSE_BUTTONS });
          x += w + LIST.gap;
        }
      }
    });
    return out;
  }

  private buttons(tab: Button): Button[] {
    if (this.view === "pad") {
      return [
        { id: "tapJump", text: "STICK UP JUMPS", checked: settings.tapJump, x: VIEW_W / 2 - 440, y: CHECKS.y, w: 420, h: CHECKS.h, size: 32 },
        { id: "rumble", text: "RUMBLE", checked: settings.rumble, x: VIEW_W / 2 + 20, y: CHECKS.y, w: 300, h: CHECKS.h, size: 32 },
        tab,
      ];
    }
    const out: Button[] = this.slots().map((s, i) => ({ id: `slot:${i}`, ...s.rect, text: "", custom: true }));
    const { y, w, h, gap } = PLAYER_TABS;
    out.push({ id: "p:kb1", x: VIEW_W / 2 - w - gap / 2, y, w, h, text: "PLAYER 1", custom: true });
    out.push({ id: "p:kb2", x: VIEW_W / 2 + gap / 2, y, w, h, text: "PLAYER 2", custom: true });
    if (Object.keys(settings[SETTINGS_KEY[this.player]]).length) out.push({ id: "reset", x: VIEW_W - 340, y: VIEW_H - 100, w: 300, h: 64, text: "RESET KEYS", size: 26 });
    out.push(tab);
    return out;
  }

  /** "tab" to switch tabs, "back" to leave settings. */
  update(m: MenuInput, taps: ViewPoint[], tab: Button): "tab" | "back" | null {
    if (this.waiting) { this.listen(m); return null; }
    if (this.eating) {
      if (!keyHeld(this.eating)) this.eating = null;
      return null;
    }
    // the drawing follows the device in hand
    if (m.from?.startsWith("pad") && this.view !== "pad") { this.view = "pad"; this.menu.focus = 0; }
    else if ((m.from === "kb1" || m.from === "kb2" || (m.any && !m.from)) && this.view !== "keys") { this.view = "keys"; this.menu.focus = 0; }
    if (m.from?.startsWith("pad")) this.pad = m.from;
    const buttons = this.buttons(tab);
    if (this.view === "keys") {
      for (const t of taps) {
        const c = this.callouts.find((o) => inside(t, o.box));
        if (c) { sfx.menuConfirm(); this.wait(c.slots.map((s) => ({ action: s.action, old: s.code }))); return null; }
      }
    }
    this.hover(buttons);
    const pressed = this.menu.update(buttons, this.menu.nearest(buttons, m), taps);
    if (pressed === "tab") return "tab";
    if (pressed?.startsWith("slot:")) {
      const s = this.slots()[Number(pressed.slice(5))];
      this.wait([{ action: s.action, old: s.code }]);
    }
    if (pressed === "p:kb1" || pressed === "p:kb2") { this.player = pressed.slice(2) as Keyboard; sfx.menuMove(); }
    if (pressed === "reset") { settings[SETTINGS_KEY[this.player]] = {}; saveSettings(); this.menu.focus = 0; }
    if (pressed === "tapJump") { settings.tapJump = !settings.tapJump; saveSettings(); }
    if (pressed === "rumble") {
      settings.rumble = !settings.rumble;
      saveSettings();
      if (settings.rumble) rumble(this.pad, 0.6, 0.6, 220);
    }
    if (m.back) return "back";
    return null;
  }

  /** The pointer moving over a key (or its label) focuses it. */
  private hover(buttons: Button[]): void {
    if (!pointer.present || (pointer.x === this.seen.x && pointer.y === this.seen.y)) return;
    this.seen = { x: pointer.x, y: pointer.y };
    let i = buttons.findIndex((b) => inside(pointer, b));
    if (i < 0 && this.view === "keys") {
      const c = this.callouts.find((o) => inside(pointer, o.box));
      if (c) i = this.slots().findIndex((s) => s.action === c.slots[0].action && s.code === c.slots[0].code);
    }
    if (i >= 0) this.menu.focus = i;
  }

  private wait(queue: { action: KeyAction; old: string | null }[]): void {
    this.waiting = { queue, armed: false };
  }

  /** The key the next press replaces: the one asked for, or the action's first if an earlier press in the queue took it. */
  private replacing(): { action: KeyAction; old: string | null } {
    const { action, old } = this.waiting!.queue[0];
    const keys = bindingsOf(this.player)[action];
    return { action, old: old !== null && keys.includes(old) ? old : keys[0] ?? null };
  }

  /** Waiting for a key: the next key or mouse button pressed goes where the queue says. */
  private listen(m: MenuInput): void {
    const w = this.waiting!;
    // the press that asked for a key is still this frame's
    if (!w.armed) { w.armed = true; return; }
    const code = takeKeyPress();
    if (code === "Escape" || (!code && m.back)) { this.waiting = null; sfx.menuBack(); return; }
    if (!code) return;
    const next = this.replacing();
    // a key does one thing for one player: the other player loses it if they had it
    settings[SETTINGS_KEY[this.player]] = overridesOf(this.player, rebind(bindingsOf(this.player), next.action, next.old, code));
    const other = OTHER[this.player];
    settings[SETTINGS_KEY[other]] = overridesOf(other, release(bindingsOf(other), code));
    saveSettings();
    sfx.menuMove();
    if (code.startsWith("Mouse")) this.eating = code;
    w.queue.shift();
    if (w.queue.length) return;
    this.waiting = null;
    const i = this.slots().findIndex((s) => s.action === next.action && s.code === code);
    if (i >= 0) this.menu.focus = i;
  }

  draw(ctx: CanvasRenderingContext2D, tab: Button): void {
    const buttons = this.buttons(tab);
    if (this.view === "keys") {
      this.drawKeys(ctx, this.menu.focused(buttons));
      for (const b of buttons) if (b.id.startsWith("p:")) {
        const on = b.id === `p:${this.player}`, focused = this.menu.focused(buttons) === b;
        title(ctx, b.text, b.x + b.w / 2, b.y + b.h / 2 + 12, on ? 36 : 30, on || focused ? INK : PENCIL);
        if (on || focused) inkLine(ctx, b.x + 30, b.y + b.h - 6, b.x + b.w - 30, b.y + b.h - 9, INK, on ? 4 : 2.4);
      }
    }
    else this.drawPad(ctx);
    this.menu.draw(ctx, buttons);
    const over = buttons.some((b) => inside(pointer, b)) || (this.view === "keys" && this.callouts.some((c) => inside(pointer, c.box)));
    if (pointer.present && over && !this.waiting) document.body.style.cursor = "pointer";
  }

  private drawKeys(ctx: CanvasRenderingContext2D, focused: Button | null): void {
    const slots = this.slots();
    let waiting: Slot | null = null;
    if (this.waiting) {
      const next = this.replacing();
      waiting = slots.find((s) => s.action === next.action && s.code === next.old) ?? null;
    }
    const focus = !this.waiting && focused?.id.startsWith("slot:") ? slots[Number(focused.id.slice(5))] : null;
    const lookOf = (s: Slot): KeyLook => (s === waiting ? "waiting" : s === focus ? "focused" : "bound");
    this.callouts = [];
    GROUPS.forEach((g, group) => {
      const mine = slots.filter((s) => s.group === group);
      const y = LIST.top + group * LIST.rowH, mid = y + LIST.capH / 2;
      const asking = !!waiting && mine.includes(waiting);
      title(ctx, g.name, LIST.nameX, mid + 14, NAME, asking ? RED : INK, "right");
      for (const s of mine) drawKey(ctx, s.rect, s.code ? capText(s.code) : "—", lookOf(s), s.code && ARROW_KEYS.has(s.code) ? "" : MARK[s.action]);
      const end = Math.max(...mine.map((s) => s.rect.x + s.rect.w));
      const note = asking ? (MARK[waiting!.action] ? `press the key for ${MARK[waiting!.action]}` : "press the new key") : g.note;
      if (note) label(ctx, note, end + LIST.noteGap, mid + 9, NOTE, asking ? RED : PENCIL, "left", 600);
      // the name is clickable too: MOVE asks for all four keys in turn
      const w = textWidth(ctx, g.name, NAME, 900);
      this.callouts.push({ name: g.name, x: LIST.nameX - w / 2, y: mid, w, above: false, slots: mine, to: [], box: { x: LIST.nameX - w - 12, y, w: w + 24, h: LIST.capH } });
    });
  }

  private padId(): string {
    return navigator.getGamepads?.()[Number(this.pad.slice(3))]?.id ?? "";
  }

  private drawPad(ctx: CanvasRenderingContext2D): void {
    drawGamepad(ctx, padStyleOf(this.padId()));
    for (const c of PAD_CALLOUTS) {
      const w = Math.max(textWidth(ctx, c.name, NAME, 900), c.note ? textWidth(ctx, c.note, NOTE, 600) : 0);
      const to = c.parts.map((part) => partPoint(part, c));
      const mid = to.reduce((n, p) => ({ x: n.x + p.x / to.length, y: n.y + p.y / to.length }), { x: 0, y: 0 });
      // the line leaves the label from the side facing what it names
      const side = Math.abs(mid.x - c.x) > w / 2 + 20;
      const from = side ? { x: c.x + Math.sign(mid.x - c.x) * (w / 2 + 14), y: c.y - 12 } : { x: c.x, y: mid.y > c.y ? c.y + (c.note ? 46 : 14) : c.y - NAME };
      drawCallout(ctx, { ...c, w }, from, to, INK, false);
    }
  }
}
