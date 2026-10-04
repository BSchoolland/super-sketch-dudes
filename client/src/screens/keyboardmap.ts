import { FONT, INK, PAPER, PENCIL, hatch, inkPath } from "../render/paper";

/** A keyboard and a mouse drawn on the paper, every key where it sits on a real one. View coordinates. */
export interface Rect { x: number; y: number; w: number; h: number }
export type KeyLook = "bound" | "focused" | "waiting";

export const RED = "#c8402c";
/** One key's width. */
export const U = 66;
const BOARD = { x: 195, y: 404 };
/** The board is the main block plus the arrows, with the space over the arrows kept for keys from elsewhere. */
const BOARD_W = 18.5 * U, BOARD_H = 5 * U;

const row = (codes: string[]): [string, number][] => codes.map((c) => [c, 1]);
const letters = (s: string): [string, number][] => row([...s].map((c) => `Key${c}`));
const ROWS: [string, number][][] = [
  [["Backquote", 1], ...row([..."1234567890"].map((d) => `Digit${d}`)), ["Minus", 1], ["Equal", 1], ["Backspace", 2]],
  [["Tab", 1.5], ...letters("QWERTYUIOP"), ["BracketLeft", 1], ["BracketRight", 1], ["Backslash", 1.5]],
  [["CapsLock", 1.75], ...letters("ASDFGHJKL"), ["Semicolon", 1], ["Quote", 1], ["Enter", 2.25]],
  [["ShiftLeft", 2.25], ...letters("ZXCVBNM"), ["Comma", 1], ["Period", 1], ["Slash", 1], ["ShiftRight", 2.75]],
  [["ControlLeft", 1.25], ["MetaLeft", 1.25], ["AltLeft", 1.25], ["Space", 6.25], ["AltRight", 1.25], ["MetaRight", 1.25], ["ContextMenu", 1.25], ["ControlRight", 1.25]],
];
const ARROWS: [string, number, number][] = [["ArrowUp", 16.5, 3], ["ArrowLeft", 15.5, 4], ["ArrowDown", 16.5, 4], ["ArrowRight", 17.5, 4]];

/** Every key on the board by KeyboardEvent.code, with its row (0: the number row). */
export const KEYS = new Map<string, Rect & { row: number }>();
ROWS.forEach((keys, r) => {
  let x = 0;
  for (const [code, w] of keys) {
    KEYS.set(code, { x: BOARD.x + x * U, y: BOARD.y + r * U, w: w * U, h: U, row: r });
    x += w;
  }
});
for (const [code, x, r] of ARROWS) KEYS.set(code, { x: BOARD.x + x * U, y: BOARD.y + r * U, w: U, h: U, row: r });

/** Where the i-th key that isn't on the board (numpad, F keys, a missing key) is drawn: over the arrows. */
export function spareKey(i: number): Rect & { row: number } {
  const col = i % 3, r = Math.floor(i / 3) % 3;
  return { x: BOARD.x + (15.5 + col) * U, y: BOARD.y + r * U, w: U, h: U, row: r };
}

const LEGEND: Record<string, string> = {
  Backquote: "`", Minus: "-", Equal: "=", Backspace: "⌫", Tab: "tab", BracketLeft: "[", BracketRight: "]", Backslash: "\\",
  CapsLock: "caps", Semicolon: ";", Quote: "'", Enter: "enter", ShiftLeft: "shift", ShiftRight: "shift", Comma: ",", Period: ".", Slash: "/",
  ControlLeft: "ctrl", ControlRight: "ctrl", AltLeft: "alt", AltRight: "alt", MetaLeft: "", MetaRight: "", ContextMenu: "", Space: "",
  ArrowUp: "▲", ArrowLeft: "◀", ArrowDown: "▼", ArrowRight: "▶",
};
/** What's printed on a key. */
export function legendOf(code: string, fallback: string): string {
  if (code in LEGEND) return LEGEND[code];
  const m = /^(?:Key|Digit)(.)$/.exec(code);
  return m ? m[1] : fallback;
}

function capPoints(r: Rect, c = 9): [number, number][] {
  const { x, y, w, h } = r;
  return [[x + c, y], [x + w - c, y], [x + w, y + c], [x + w, y + h - c], [x + w - c, y + h], [x + c, y + h], [x, y + h - c], [x, y + c]];
}

/** One key cap. Unbound keys are faint pencil; `mark` is a small arrow in the corner (a move key). */
export function drawKey(ctx: CanvasRenderingContext2D, key: Rect, legend: string, look: KeyLook | null, mark = ""): void {
  const r = { x: key.x + 4, y: key.y + 4, w: key.w - 8, h: key.h - 8 };
  const seed = Math.round(key.x * 3 + key.y);
  ctx.save();
  ctx.lineJoin = "round";
  if (!look) {
    inkPath(ctx, capPoints(r), true, seed);
    ctx.globalAlpha = 0.45; ctx.lineWidth = 1.1; ctx.strokeStyle = PENCIL; ctx.stroke();
    ctx.globalAlpha = 0.4;
    keyText(ctx, legend, r, PENCIL, 600);
    ctx.restore();
    return;
  }
  ctx.fillStyle = "rgba(41,39,34,0.1)"; ctx.fillRect(r.x + 4, r.y + 5, r.w, r.h);
  inkPath(ctx, capPoints(r), true, seed);
  ctx.fillStyle = PAPER; ctx.fill();
  const color = look === "waiting" ? RED : INK;
  ctx.lineWidth = look === "bound" ? 2.4 : 4; ctx.strokeStyle = color; ctx.stroke();
  if (look === "focused") { inkPath(ctx, capPoints({ x: r.x - 4, y: r.y + 3, w: r.w + 7, h: r.h - 1 }), true, seed + 1); ctx.lineWidth = 1; ctx.strokeStyle = PENCIL; ctx.stroke(); }
  ctx.globalAlpha = 0.35; ctx.lineWidth = 1.5;
  inkPath(ctx, [[r.x + 6, r.y + r.h - 8], [r.x + r.w - 6, r.y + r.h - 8]], false, seed + 2); ctx.stroke();
  ctx.globalAlpha = 1;
  keyText(ctx, look === "waiting" ? "?" : legend, r, color, 900);
  if (mark && look !== "waiting") {
    ctx.fillStyle = INK; ctx.font = `900 ${Math.round(U * 0.22)}px ${FONT}`; ctx.textAlign = "right"; ctx.textBaseline = "alphabetic";
    ctx.fillText(mark, r.x + r.w - 6, r.y + r.h - 12);
  }
  ctx.restore();
}

function keyText(ctx: CanvasRenderingContext2D, text: string, r: Rect, color: string, weight: number): void {
  if (!text) return;
  let size = [...text].length === 1 ? U * 0.46 : U * 0.3;
  ctx.font = `${weight} ${size}px ${FONT}`;
  const w = ctx.measureText(text).width;
  if (w > r.w - 10) { size *= (r.w - 10) / w; ctx.font = `${weight} ${size}px ${FONT}`; }
  ctx.fillStyle = color; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(text, r.x + r.w / 2, r.y + r.h * 0.44);
}

/** The board's outline and every key on it; `looks` picks out the keys that do something. */
export function drawBoard(ctx: CanvasRenderingContext2D, looks: Map<string, KeyLook>, marks: Map<string, string>): void {
  ctx.save();
  inkPath(ctx, capPoints({ x: BOARD.x - 16, y: BOARD.y - 16, w: BOARD_W + 32, h: BOARD_H + 32 }, 22), true, 77);
  ctx.lineWidth = 2.2; ctx.strokeStyle = INK; ctx.stroke();
  ctx.restore();
  for (const [code, key] of KEYS) drawKey(ctx, key, legendOf(code, ""), looks.get(code) ?? null, marks.get(code));
}

export const MOUSE: Rect = { x: BOARD.x + BOARD_W + 120, y: BOARD.y, w: 190, h: 300 };
const SPLIT = MOUSE.y + MOUSE.h * 0.42;
/** The mouse's buttons, named the way input/devices names them. */
export const MOUSE_BUTTONS: Record<string, Rect> = {
  Mouse0: { x: MOUSE.x, y: MOUSE.y, w: MOUSE.w / 2, h: SPLIT - MOUSE.y },
  Mouse2: { x: MOUSE.x + MOUSE.w / 2, y: MOUSE.y, w: MOUSE.w / 2, h: SPLIT - MOUSE.y },
  Mouse1: { x: MOUSE.x + MOUSE.w / 2 - 16, y: MOUSE.y + 34, w: 32, h: 62 },
  Mouse3: { x: MOUSE.x - 10, y: MOUSE.y + MOUSE.h * 0.62, w: 18, h: 40 },
  Mouse4: { x: MOUSE.x - 10, y: MOUSE.y + MOUSE.h * 0.5, w: 18, h: 40 },
};

function mousePoints(): [number, number][] {
  const { x, y, w, h } = MOUSE, top = w / 2, bottom = w * 0.42, pts: [number, number][] = [];
  for (let i = 0; i <= 16; i++) { const a = Math.PI + (Math.PI * i) / 16; pts.push([x + w / 2 + Math.cos(a) * w / 2, y + top + Math.sin(a) * top]); }
  for (let i = 0; i <= 10; i++) { const a = (Math.PI / 2) * (i / 10); pts.push([x + w - bottom + Math.cos(a) * bottom, y + h - bottom + Math.sin(a) * bottom]); }
  for (let i = 0; i <= 10; i++) { const a = Math.PI / 2 + (Math.PI / 2) * (i / 10); pts.push([x + bottom + Math.cos(a) * bottom, y + h - bottom + Math.sin(a) * bottom]); }
  return pts;
}

/** The mouse: buttons that do something are hatched, the focused one darker, the one waiting for a press in red. */
export function drawMouse(ctx: CanvasRenderingContext2D, looks: Map<string, KeyLook>): void {
  const { x, y, w } = MOUSE;
  ctx.save();
  ctx.fillStyle = "rgba(41,39,34,0.1)";
  ctx.translate(5, 6); inkPath(ctx, mousePoints(), true, 5); ctx.fill(); ctx.translate(-5, -6);
  inkPath(ctx, mousePoints(), true, 5);
  ctx.fillStyle = PAPER; ctx.fill();
  ctx.save();
  ctx.clip();
  for (const code of ["Mouse0", "Mouse2"]) {
    const look = looks.get(code), b = MOUSE_BUTTONS[code];
    if (!look) continue;
    if (look === "waiting") { ctx.fillStyle = "rgba(200,64,44,0.18)"; ctx.fillRect(b.x, b.y, b.w, b.h); }
    else hatch(ctx, b.x, b.y, b.w, b.h, look === "focused" ? INK : PENCIL);
  }
  ctx.restore();
  ctx.lineWidth = 2.6; ctx.strokeStyle = INK; ctx.lineJoin = "round"; ctx.stroke();
  ctx.lineWidth = 2.2; ctx.lineCap = "round";
  inkPath(ctx, [[x, SPLIT], [x + w, SPLIT]], false, 6); ctx.stroke();
  inkPath(ctx, [[x + w / 2, y], [x + w / 2, SPLIT]], false, 7); ctx.stroke();
  for (const code of ["Mouse0", "Mouse2"]) if (looks.get(code) === "waiting") {
    const b = MOUSE_BUTTONS[code];
    ctx.fillStyle = RED; ctx.font = `900 54px ${FONT}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("?", b.x + b.w / 2, b.y + b.h * 0.62);
  }
  wheel(ctx, MOUSE_BUTTONS.Mouse1, looks.get("Mouse1") ?? null);
  for (const code of ["Mouse3", "Mouse4"]) if (looks.has(code)) wheel(ctx, MOUSE_BUTTONS[code], looks.get(code)!);
  ctx.restore();
}

function wheel(ctx: CanvasRenderingContext2D, b: Rect, look: KeyLook | null): void {
  inkPath(ctx, capPoints(b, 8), true, Math.round(b.y));
  ctx.fillStyle = look === "waiting" ? "#f3d6cf" : look === "focused" ? INK : look ? PENCIL : PAPER;
  ctx.fill();
  ctx.lineWidth = look ? 2.6 : 2; ctx.strokeStyle = look === "waiting" ? RED : INK; ctx.stroke();
}
