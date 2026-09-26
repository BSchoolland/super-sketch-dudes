/**
 * Mouse / touch / pen on the game canvas, in view coordinates (VIEW_W x VIEW_H). Taps are for
 * buttons; `onPointer` hands raw strokes to whoever draws (the draw pad).
 */
export interface ViewPoint { x: number; y: number }
export interface PointerStroke { id: number; phase: "down" | "move" | "up"; points: ViewPoint[] }
type StrokeListener = (stroke: PointerStroke) => void;

let cssScale = 1, cssOffX = 0, cssOffY = 0;
const taps: ViewPoint[] = [];
/** Where the pointer is for hover, and whether it tapped this frame (ui.ts `hover`/`clicked`). */
export const pointer = { x: -1, y: -1, clicked: false, present: false };
const downs = new Map<number, ViewPoint>();
const listeners = new Set<StrokeListener>();

/** `scale`/`offX`/`offY` in CSS pixels: view (x, y) sits at client (offX + x * scale, offY + y * scale). */
export function setPointerTransform(scale: number, offX: number, offY: number): void {
  cssScale = scale; cssOffX = offX; cssOffY = offY;
}

export function toView(clientX: number, clientY: number): ViewPoint {
  return { x: (clientX - cssOffX) / cssScale, y: (clientY - cssOffY) / cssScale };
}

export function viewRectToCss(x: number, y: number, w: number, h: number): { left: number; top: number; width: number; height: number; scale: number } {
  return { left: cssOffX + x * cssScale, top: cssOffY + y * cssScale, width: w * cssScale, height: h * cssScale, scale: cssScale };
}

export function attachPointer(canvas: HTMLCanvasElement): void {
  const emit = (stroke: PointerStroke) => { for (const listener of listeners) listener(stroke); };
  const track = (p: ViewPoint) => { pointer.x = p.x; pointer.y = p.y; pointer.present = true; };
  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    const p = toView(e.clientX, e.clientY);
    track(p);
    downs.set(e.pointerId, p);
    emit({ id: e.pointerId, phase: "down", points: [p] });
    e.preventDefault();
  });
  canvas.addEventListener("pointermove", (e) => {
    track(toView(e.clientX, e.clientY));
    if (!downs.has(e.pointerId)) return;
    const events = e.getCoalescedEvents?.() ?? [];
    const points = (events.length ? events : [e]).map((ev) => toView(ev.clientX, ev.clientY));
    emit({ id: e.pointerId, phase: "move", points });
  });
  const end = (e: PointerEvent) => {
    const start = downs.get(e.pointerId);
    if (!start) return;
    downs.delete(e.pointerId);
    const p = toView(e.clientX, e.clientY);
    emit({ id: e.pointerId, phase: "up", points: [p] });
    if (e.type === "pointerup" && Math.hypot(p.x - start.x, p.y - start.y) < 40) { taps.push(start); track(start); pointer.clicked = true; }
  };
  canvas.addEventListener("pointerleave", () => { pointer.present = false; });
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
}

export function onPointer(listener: StrokeListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function consumeTaps(): ViewPoint[] {
  return taps.splice(0);
}

export function endPointerFrame(): void {
  taps.length = 0;
  pointer.clicked = false;
}
