/**
 * Mouse / touch / pen on the game canvas, in view coordinates (VIEW_W x VIEW_H). Taps are for
 * buttons; `onPointer` hands raw strokes to whoever draws (the draw pad).
 */
export interface ViewPoint { x: number; y: number }
export interface PointerStroke { id: number; phase: "down" | "move" | "up"; points: ViewPoint[] }
type StrokeListener = (stroke: PointerStroke) => void;

let cssScale = 1, cssOffX = 0, cssOffY = 0;
const taps: ViewPoint[] = [];
/**
 * Where the pointer is for hover, and whether it tapped this frame (ui.ts `hover`/`clicked`). The
 * tap keeps its own position: a lifted finger leaves the canvas before the frame reads it.
 */
export const pointer = { x: -1, y: -1, present: false, clicked: false, tapX: -1, tapY: -1, down: false, downX: -1, downY: -1 };
const downs = new Map<number, ViewPoint>();
/** Presses that became something else (a scroll drag): lifting them is no tap. */
const claimed = new Set<number>();
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

export function attachPointer(canvas: HTMLCanvasElement): () => void {
  const ac = new AbortController();
  const on = <K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void) => canvas.addEventListener(type, fn, { signal: ac.signal });
  const emit = (stroke: PointerStroke) => { for (const listener of listeners) listener(stroke); };
  const track = (p: ViewPoint) => { pointer.x = p.x; pointer.y = p.y; pointer.present = true; };
  on("pointerdown", (e) => {
    // only the primary button taps and draws; the others are fight buttons (input/devices)
    if (e.button !== 0) { e.preventDefault(); return; }
    canvas.setPointerCapture(e.pointerId);
    const p = toView(e.clientX, e.clientY);
    track(p);
    downs.set(e.pointerId, p);
    pointer.down = true; pointer.downX = p.x; pointer.downY = p.y;
    emit({ id: e.pointerId, phase: "down", points: [p] });
    e.preventDefault();
  });
  on("pointermove", (e) => {
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
    pointer.down = downs.size > 0;
    const p = toView(e.clientX, e.clientY);
    emit({ id: e.pointerId, phase: "up", points: [p] });
    if (claimed.delete(e.pointerId)) return;
    if (e.type === "pointerup" && Math.hypot(p.x - start.x, p.y - start.y) < 40) { taps.push(start); track(start); pointer.clicked = true; pointer.tapX = start.x; pointer.tapY = start.y; }
  };
  on("pointerleave", () => { pointer.present = false; });
  // pinch-zoom sends ctrl
  on("wheel", (e) => {
    if (e.ctrlKey) return;
    const px = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 40 : e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? 800 : 1;
    wheelPending += (e.deltaY * px) / cssScale;
    wheelAt = performance.now();
  });
  on("pointerup", end);
  on("pointercancel", end);
  return () => ac.abort();
}

export function onPointer(listener: StrokeListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let wheelPending = 0, wheelAt = -Infinity;

/** How far the mouse wheel (or a touchpad's two-finger scroll) moved since the last call, in view pixels; down is positive. */
export function wheelDelta(): number {
  // nobody read it while it was fresh (another screen's wheel): it's not this screen's
  const n = performance.now() - wheelAt < 150 ? wheelPending : 0;
  wheelPending = 0;
  return n;
}

/** The press under way stops being a tap: its lift won't click anything. */
export function claimPress(): void {
  for (const id of downs.keys()) claimed.add(id);
}

/** The taps since the last sim tick, for a screen's update. */
export function consumeTaps(): ViewPoint[] {
  return taps.splice(0);
}

/**
 * Taps are read by updates on the sim clock, `pointer.clicked` by draws on the paint clock: each
 * clock drops only its own, or a paint landing between a tap and the next tick eats the tap.
 */
export function endPointerTick(): void {
  taps.length = 0;
}

export function endPointerFrame(): void {
  pointer.clicked = false;
}
