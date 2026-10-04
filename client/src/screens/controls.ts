import { VIEW_H, VIEW_W } from "../render/camera";
import { FONT, INK, PENCIL, inkLine } from "../render/paper";
import { keyHeld, rumble, takeKeyPress, type DeviceId, type MenuInput } from "../input/devices";
import { kb1Bindings, kb1OverridesOf, keyName, rebind, type KeyAction } from "../input/bindings";
import { pointer, type ViewPoint } from "../input/pointer";
import { sfx } from "../audio/audio";
import { ButtonMenu, inside, type Button } from "./buttons";
import { label, title, settings, saveSettings } from "./ui";
import { KEYS, MOUSE_BUTTONS, RED, drawBoard, drawKey, drawMouse, legendOf, spareKey, type KeyLook, type Rect } from "./keyboardmap";
import { PAD_PARTS, drawGamepad, padStyleOf, partPoint } from "./gamepadmap";

type Pt = { x: number; y: number };

/** Keyboard 1's actions as the drawing names them; MOVE's four keys share a label. Pause stays on Esc. */
const GROUPS: { name: string; note?: string; actions: KeyAction[] }[] = [
  { name: "MOVE", note: "aims attacks and specials", actions: ["up", "left", "down", "right"] },
  { name: "JUMP", note: "again in the air", actions: ["jump"] },
  { name: "ATTACK", note: "hold it to SMASH", actions: ["attack"] },
  { name: "SPECIAL", note: "up + special flies you back", actions: ["special"] },
  { name: "SHIELD", note: "+ a direction: dodge", actions: ["shield"] },
  { name: "TAUNT", actions: ["taunt"] },
];
const MARK: Partial<Record<KeyAction, string>> = { up: "▲", left: "◀", down: "▼", right: "▶" };

/** One key doing one action, where the drawing has it (code null: an action left with no key). */
interface Slot { action: KeyAction; code: string | null; group: number; rect: Rect; row: number; mouse: boolean }

/** A label written beside the drawing with lines to what it names. */
interface Callout { name: string; note?: string; x: number; y: number; w: number; above: boolean; slots: Slot[]; to: Pt[]; box: Rect }

const NAME = 40, NOTE = 25;
const ABOVE_Y = 300, BELOW_Y = 830;

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

/** Pushes labels on one line apart so none overlap, keeping them inside lo..hi. */
function spread(items: { x: number; w: number }[], lo: number, hi: number, gap = 40): void {
  items.sort((a, b) => a.x - b.x);
  for (let pass = 0; pass < 80; pass++) {
    for (let i = 1; i < items.length; i++) {
      const a = items[i - 1], b = items[i], over = a.x + a.w / 2 + gap - (b.x - b.w / 2);
      if (over > 0) { a.x -= over / 2; b.x += over / 2; }
    }
    for (const it of items) it.x = Math.max(lo + it.w / 2, Math.min(hi - it.w / 2, it.x));
  }
}

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
    const b = kb1Bindings();
    const out: Slot[] = [];
    let spare = 0;
    GROUPS.forEach((g, group) => {
      for (const action of g.actions) {
        for (const code of b[action].length ? b[action] : [null]) {
          const mouse = code !== null && code in MOUSE_BUTTONS;
          const at = code === null ? null : mouse ? { ...MOUSE_BUTTONS[code], row: 0 } : KEYS.get(code);
          const rect = at ?? spareKey(spare++);
          out.push({ action, code, group, rect, row: rect.row, mouse });
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
    if (Object.keys(settings.keys).length) out.push({ id: "reset", x: VIEW_W - 340, y: VIEW_H - 100, w: 300, h: 64, text: "RESET KEYS", size: 26 });
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
    if (pressed === "reset") { settings.keys = {}; saveSettings(); this.menu.focus = 0; }
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
    const keys = kb1Bindings()[action];
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
    settings.keys = kb1OverridesOf(rebind(kb1Bindings(), next.action, next.old, code));
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
    if (this.view === "keys") this.drawKeys(ctx, this.menu.focused(buttons));
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
    const looks = new Map<string, KeyLook>(), marks = new Map<string, string>();
    for (const s of slots) if (s.code) {
      looks.set(s.code, lookOf(s));
      if (MARK[s.action]) marks.set(s.code, MARK[s.action]!);
    }
    drawBoard(ctx, looks, marks);
    for (const s of slots) if (!s.mouse && !(s.code && KEYS.has(s.code))) drawKey(ctx, s.rect, s.code ? legendOf(s.code, keyName(s.code)) : "", lookOf(s), MARK[s.action]);
    drawMouse(ctx, looks);
    this.callouts = this.layout(ctx, slots);
    for (const c of this.callouts) {
      const on = (s: Slot | null) => !!s && c.slots.includes(s);
      const from = { x: c.x, y: c.above ? c.y + (c.note ? 46 : 14) : c.y - NAME };
      const note = on(waiting) ? (MARK[waiting!.action] ? `press a key for ${MARK[waiting!.action]}` : "press a key") : c.note;
      drawCallout(ctx, { ...c, note }, from, c.to, on(waiting) ? RED : INK, on(focus));
    }
  }

  /** One label per action per device (keyboard or mouse), above the board for the top rows and below for the rest. */
  private layout(ctx: CanvasRenderingContext2D, slots: Slot[]): Callout[] {
    const out: Callout[] = [];
    // a group's note goes with its first key's label only
    const first = new Map<number, Slot>();
    for (const s of slots) if (!first.has(s.group)) first.set(s.group, s);
    for (const g of GROUPS.keys()) for (const mouse of [false, true]) {
      const mine = slots.filter((s) => s.group === g && s.mouse === mouse);
      if (!mine.length) continue;
      const above = mouse || mine.reduce((n, s) => n + s.row, 0) / mine.length < 1.5;
      const note = mine.includes(first.get(g)!) ? GROUPS[g].note : undefined;
      const w = Math.max(textWidth(ctx, GROUPS[g].name, NAME, 900), note ? textWidth(ctx, note, NOTE, 600) : 0);
      // a key hidden behind another of the same label (W behind S, from below) gets no line of its own
      const hidden = (s: Slot) => mine.some((o) => o !== s && (above ? o.rect.y < s.rect.y : o.rect.y > s.rect.y) && o.rect.x < s.rect.x + s.rect.w * 0.7 && o.rect.x + o.rect.w > s.rect.x + s.rect.w * 0.3);
      const to = mine.filter((s) => !hidden(s)).map((s) => ({
        x: s.rect.x + s.rect.w / 2,
        y: s.mouse ? s.rect.y + s.rect.h * 0.55 : above ? s.rect.y + 6 : s.rect.y + s.rect.h - 6,
      }));
      out.push({ name: GROUPS[g].name, note, x: to.reduce((n, p) => n + p.x, 0) / to.length, y: above ? ABOVE_Y : BELOW_Y, w, above, slots: mine, to, box: { x: 0, y: 0, w: 0, h: 0 } });
    }
    for (const above of [true, false]) spread(out.filter((c) => c.above === above), 60, VIEW_W - 60);
    for (const c of out) c.box = { x: c.x - c.w / 2 - 12, y: c.y - NAME, w: c.w + 24, h: c.note ? NAME + 46 : NAME + 14 };
    return out;
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
