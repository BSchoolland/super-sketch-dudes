import { VIEW_H, VIEW_W } from "../render/camera";
import { INK, PAPER, PENCIL, drawPaper, inkLine, inkRect } from "../render/paper";
import { drawStage } from "../render/stage";
import { SLOT_COLORS } from "../render/hud";
import { platformMotion } from "../../../shared/physics";
import { onPointer, pointer, type PointerStroke, type ViewPoint } from "../input/pointer";
import type { MenuInput } from "../input/devices";
import { sfx } from "../audio/audio";
import { account } from "../account";
import { mapsApi, refreshMaps, registerMap } from "../maps";
import { button, card, label, title, goTo, type Screen } from "./ui";
import { TextField } from "./textfield";
import { RED } from "./character";
import { checkMap, newMapDoc, stageFromMap, terrainOf, MAP_NAME_MAX, PERIOD_MAX, PERIOD_MIN, PLATFORM_MIN_W, TERRAIN_MIN, type MapDoc, type MapPiece, type MapPlatform, type MapSpawn } from "../../../shared/maps";
import type { Platform, State } from "../../../shared/types";
import type { Nav } from "./nav";

type Tool = "select" | "terrain" | "platform" | "mover";
type Sel = { kind: "piece"; i: number } | { kind: "spawn"; i: number } | null;
type Handle = "l" | "r" | "t" | "b" | "tl" | "tr" | "bl" | "br";
interface WorldPt { x: number; y: number }
interface Rect { x: number; y: number; w: number; h: number }
type Drag =
  | { mode: "pan"; from: ViewPoint; cam: WorldPt; moved: boolean }
  | { mode: "draw"; a: WorldPt; b: WorldPt }
  | { mode: "move"; sel: NonNullable<Sel>; from: WorldPt; orig: MapPiece | MapSpawn; before: string; moved: boolean }
  | { mode: "resize"; i: number; handle: Handle; from: WorldPt; orig: MapPiece; before: string }
  | { mode: "far"; i: number; from: WorldPt; orig: MapPlatform; before: string };

const GRID = 10;
const ZOOM = { min: 0.12, max: 2.5 };
const TOOLS: { id: Tool; text: string; key: string }[] = [
  { id: "select", text: "SELECT", key: "V" },
  { id: "terrain", text: "TERRAIN", key: "T" },
  { id: "platform", text: "PLATFORM", key: "P" },
  { id: "mover", text: "MOVING", key: "M" },
];
const COL = { x: 30, w: 210, h: 64, y0: 120, step: 76 };
const NAME = { x: VIEW_W / 2 - 300, y: 22, w: 600, h: 64 };
const INSPECT = { x: VIEW_W - 320, y: 120, w: 290 };
const HANDLE = 9, HIT = 14, SPAWN_HIT = 34;
/** Terrain and platform blocks a click (rather than a drag) drops in. */
const DEFAULT_TERRAIN = { w: 600, h: 240 }, DEFAULT_PLATFORM_W = 220;
const DEFAULT_PERIOD = 360;

const snap = (v: number): number => Math.round(v / GRID) * GRID;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const localId = (): string => `map-${Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => b.toString(16).padStart(2, "0")).join("")}`;

function pieceRect(p: MapPiece): Rect {
  return p.kind === "terrain" ? { x: p.x, y: p.y, w: p.w, h: p.h } : { x: p.x, y: p.y - 4, w: p.w, h: 20 };
}
function asPlatform(p: MapPlatform): Platform {
  return { x1: p.x, x2: p.x + p.w, y: p.y, ...(p.motion ? { motion: p.motion } : {}) };
}
/** The far point of a mover's path: where a line ends, or an orbit's centre. */
function farPoint(p: MapPlatform): WorldPt | null {
  const m = p.motion;
  if (!m) return null;
  return m.kind === "line" ? { x: p.x + p.w / 2 + m.dx, y: p.y + m.dy } : { x: m.cx, y: m.cy };
}
const inRect = (pt: WorldPt, r: Rect, pad = 0): boolean => pt.x >= r.x - pad && pt.x <= r.x + r.w + pad && pt.y >= r.y - pad && pt.y <= r.y + r.h + pad;

/**
 * The map editor: the whole screen is the map on paper. Drag empty paper to pan, wheel to zoom;
 * pick a tool and drag to draw terrain or platforms, or select something and drag it, its handles,
 * or a mover's path end. Spawns are always there to drag. TEST plays it, SAVE keeps it.
 */
export class MapEditorScreen implements Screen {
  t = 0;
  private doc: MapDoc;
  /** True once the server has this map (PUT, not POST, from then on). */
  private stored: boolean;
  private dirty = false;
  private tool: Tool = "select";
  private sel: Sel = null;
  private drag: Drag | null = null;
  private cam: WorldPt = { x: 0, y: -100 };
  private zoom = 0.6;
  private past: string[] = [];
  private future: string[] = [];
  private name: TextField | null = null;
  private status = "";
  private problem = "";
  private saving = false;
  private leaveArmed = -Infinity;
  private space = false;
  private clipboard: MapPiece | null = null;
  private detachers: (() => void)[] = [];

  constructor(private nav: Nav, doc: MapDoc | null) {
    const me = account.player;
    if (!me) throw new Error("the map editor needs a signed-in player");
    this.stored = !!doc;
    this.doc = doc ? clone(doc) : newMapDoc(localId(), me.id, me.name, "", Date.now());
    this.fit();
  }

  enter(): void {
    this.name = new TextField({ maxLength: MAP_NAME_MAX, upper: true, quiet: !!this.doc.name, value: this.doc.name, onSubmit: () => this.name?.el.blur(), onCancel: () => this.name?.el.blur() });
    this.name.el.placeholder = "NAME THIS MAP";
    this.name.el.addEventListener("input", () => { this.dirty = true; });
    const canvas = document.getElementById("game");
    const onWheel = (e: WheelEvent) => { e.preventDefault(); this.wheel(e); };
    const onKey = (e: KeyboardEvent) => this.key(e);
    const onKeyUp = (e: KeyboardEvent) => { if (e.code === "Space") this.space = false; };
    canvas?.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    this.detachers = [
      onPointer((s) => this.stroke(s)),
      () => canvas?.removeEventListener("wheel", onWheel),
      () => window.removeEventListener("keydown", onKey),
      () => window.removeEventListener("keyup", onKeyUp),
    ];
  }

  abandon(): void {
    this.detach();
  }

  private detach(): void {
    for (const d of this.detachers) d();
    this.detachers = [];
    this.name?.remove();
    this.name = null;
    this.drag = null;
  }

  private leaveTo(next: Screen): Screen {
    this.detach();
    return next;
  }

  // ---- geometry -------------------------------------------------------------

  private toView(p: WorldPt): ViewPoint {
    return { x: (p.x - this.cam.x) * this.zoom + VIEW_W / 2, y: (p.y - this.cam.y) * this.zoom + VIEW_H / 2 };
  }
  private toWorld(p: ViewPoint): WorldPt {
    return { x: (p.x - VIEW_W / 2) / this.zoom + this.cam.x, y: (p.y - VIEW_H / 2) / this.zoom + this.cam.y };
  }

  /** Frames the whole stage, blast zone included. */
  private fit(): void {
    const problems = checkMap({ ...this.doc, name: this.doc.name || "x" });
    if (problems.length) return;
    const b = stageFromMap(this.doc).blast;
    const w = b.right - b.left, h = b.bottom - b.top;
    this.zoom = Math.max(ZOOM.min, Math.min(ZOOM.max, Math.min((VIEW_W - 700) / w, (VIEW_H - 260) / h)));
    this.cam = { x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 };
  }

  private get frame(): number {
    return Math.floor(this.t * 60);
  }

  /** Where a mover is right now, relative to where it rests. */
  private offsetOf(p: MapPiece): WorldPt {
    if (p.kind !== "platform" || !p.motion) return { x: 0, y: 0 };
    const o = platformMotion(asPlatform(p), this.frame);
    return { x: o.dx, y: o.dy };
  }

  /** The nearest surface a spawn can stand on, looking a little above and well below it. */
  private groundUnder(x: number, y: number): number | null {
    let best: number | null = null;
    for (const p of this.doc.pieces) {
      if (x < p.x || x > p.x + p.w) continue;
      if (p.y < y - 60 || p.y > y + 500) continue;
      if (best === null || Math.abs(p.y - y) < Math.abs(best - y)) best = p.y;
    }
    return best;
  }

  /** What stops the map being played; `live` leaves out the missing name, which only matters once they try to save or test. */
  private problems(live = false): string[] {
    const list = checkMap({ ...this.doc, name: live ? this.name?.value.trim() || "untitled" : this.name?.value.trim() || this.doc.name });
    this.doc.spawns.forEach((s, i) => { if (this.groundUnder(s.x, s.y) !== s.y) list.push(`P${i + 1} isn't standing on anything`); });
    return list;
  }

  // ---- editing --------------------------------------------------------------

  /** Runs a change against the map with undo. */
  private edit(change: () => void): void {
    const before = JSON.stringify(this.doc);
    change();
    this.settle(before);
  }

  /** After a change: a history entry if anything moved, spawns back on the ground. */
  private settle(before: string): void {
    for (const s of this.doc.spawns) { const g = this.groundUnder(s.x, s.y); if (g !== null) s.y = g; }
    const after = JSON.stringify(this.doc);
    if (after === before) return;
    this.past.push(before);
    if (this.past.length > 200) this.past.shift();
    this.future = [];
    this.dirty = true;
    this.status = "";
  }

  private undo(): void {
    const prev = this.past.pop();
    if (prev === undefined) return;
    this.future.push(JSON.stringify(this.doc));
    this.doc = JSON.parse(prev) as MapDoc;
    this.sel = null; this.dirty = true; sfx.menuMove();
  }
  private redo(): void {
    const next = this.future.pop();
    if (next === undefined) return;
    this.past.push(JSON.stringify(this.doc));
    this.doc = JSON.parse(next) as MapDoc;
    this.sel = null; this.dirty = true; sfx.menuMove();
  }

  private deleteSelection(): void {
    if (this.sel?.kind !== "piece") return;
    const i = this.sel.i;
    this.edit(() => { this.doc.pieces.splice(i, 1); });
    this.sel = null;
    sfx.menuBack();
  }

  private nudge(dx: number, dy: number): void {
    const sel = this.sel;
    if (!sel) return;
    this.edit(() => {
      const o = sel.kind === "piece" ? this.doc.pieces[sel.i] : this.doc.spawns[sel.i];
      o.x += dx; o.y += dy;
    });
  }

  private setTool(tool: Tool): void {
    this.tool = tool;
    if (tool !== "select") this.sel = null;
    sfx.menuMove();
  }

  private selectedPiece(): MapPiece | null {
    return this.sel?.kind === "piece" ? this.doc.pieces[this.sel.i] : null;
  }

  private setMotion(p: MapPlatform, kind: "none" | "line" | "orbit"): void {
    this.edit(() => {
      const period = p.motion?.period ?? DEFAULT_PERIOD, phase = p.motion?.phase ?? 0;
      if (kind === "none") delete p.motion;
      else if (kind === "line") p.motion = { kind: "line", dx: 0, dy: -300, period, phase };
      else p.motion = { kind: "orbit", cx: p.x + p.w / 2, cy: p.y - 260, rx: 260, ry: 260, period, phase };
    });
  }

  // ---- pointer --------------------------------------------------------------

  /** Cards the pointer is over belong to the buttons, not the map. */
  private overUi(v: ViewPoint): boolean {
    const rects: Rect[] = [{ x: 0, y: 0, w: VIEW_W, h: 100 }, { x: 0, y: COL.y0 - 10, w: COL.x + COL.w + 20, h: 6 * COL.step + 60 }, { x: 0, y: VIEW_H - 130, w: VIEW_W, h: 130 }];
    if (this.sel) rects.push({ x: INSPECT.x - 10, y: INSPECT.y - 10, w: INSPECT.w + 30, h: 560 });
    return rects.some((r) => inRect(v, r));
  }

  private handleAt(v: ViewPoint): Handle | "far" | null {
    const p = this.selectedPiece();
    if (!p) return null;
    if (p.kind === "platform") {
      const far = farPoint(p);
      if (far) { const fv = this.toView(far); if (Math.hypot(fv.x - v.x, fv.y - v.y) <= HIT + 4) return "far"; }
    }
    for (const [h, pt] of this.handles(p)) { const hv = this.toView(pt); if (Math.abs(hv.x - v.x) <= HIT && Math.abs(hv.y - v.y) <= HIT) return h; }
    return null;
  }

  private handles(p: MapPiece): [Handle, WorldPt][] {
    const r = pieceRect(p);
    if (p.kind === "platform") return [["l", { x: r.x, y: p.y }], ["r", { x: r.x + r.w, y: p.y }]];
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    return [["tl", { x: r.x, y: r.y }], ["t", { x: cx, y: r.y }], ["tr", { x: r.x + r.w, y: r.y }], ["r", { x: r.x + r.w, y: cy }], ["br", { x: r.x + r.w, y: r.y + r.h }], ["b", { x: cx, y: r.y + r.h }], ["bl", { x: r.x, y: r.y + r.h }], ["l", { x: r.x, y: cy }]];
  }

  /** Topmost thing under a view point: a spawn marker, else a piece (at rest or where its motion has it). */
  private hit(v: ViewPoint): Sel {
    const w = this.toWorld(v);
    for (let i = this.doc.spawns.length - 1; i >= 0; i--) {
      const s = this.toView(this.doc.spawns[i]);
      if (Math.abs(s.x - v.x) <= SPAWN_HIT / 2 && v.y <= s.y + 6 && v.y >= s.y - SPAWN_HIT - 30) return { kind: "spawn", i };
    }
    const pad = 6 / this.zoom;
    for (let i = this.doc.pieces.length - 1; i >= 0; i--) {
      const p = this.doc.pieces[i];
      const r = pieceRect(p), o = this.offsetOf(p);
      if (inRect(w, r, pad) || inRect(w, { ...r, x: r.x + o.x, y: r.y + o.y }, pad)) return { kind: "piece", i };
    }
    return null;
  }

  private stroke(s: PointerStroke): void {
    const v = s.points[s.points.length - 1];
    if (s.phase === "down") {
      if (this.overUi(v)) return;
      this.name?.el.blur();
      const w = this.toWorld(v);
      const pan = (): Drag => ({ mode: "pan", from: v, cam: { ...this.cam }, moved: false });
      if (this.space) { this.drag = pan(); return; }
      if (this.tool === "select") {
        const h = this.handleAt(v);
        const p = this.selectedPiece();
        if (h && this.sel?.kind === "piece" && p) {
          const before = JSON.stringify(this.doc);
          this.drag = h === "far" ? { mode: "far", i: this.sel.i, from: w, orig: clone(p as MapPlatform), before } : { mode: "resize", i: this.sel.i, handle: h, from: w, orig: clone(p), before };
          return;
        }
        const target = this.hit(v);
        if (target) {
          this.sel = target;
          const orig = target.kind === "piece" ? this.doc.pieces[target.i] : this.doc.spawns[target.i];
          this.drag = { mode: "move", sel: target, from: w, orig: clone(orig), before: JSON.stringify(this.doc), moved: false };
          return;
        }
        this.drag = pan();
        return;
      }
      this.drag = { mode: "draw", a: { x: snap(w.x), y: snap(w.y) }, b: { x: snap(w.x), y: snap(w.y) } };
      return;
    }
    const d = this.drag;
    if (!d) return;
    const w = this.toWorld(v);
    if (d.mode === "pan") {
      this.cam = { x: d.cam.x - (v.x - d.from.x) / this.zoom, y: d.cam.y - (v.y - d.from.y) / this.zoom };
      if (Math.hypot(v.x - d.from.x, v.y - d.from.y) > 4) d.moved = true;
      if (s.phase === "up") { if (!d.moved) this.sel = null; this.drag = null; }
      return;
    }
    if (d.mode === "draw") {
      d.b = { x: snap(w.x), y: snap(w.y) };
      if (s.phase === "up") { this.finishDraw(d); this.drag = null; }
      return;
    }
    const dx = snap(w.x - d.from.x), dy = snap(w.y - d.from.y);
    if (d.mode === "move") {
      if (dx || dy) d.moved = true;
      const o = d.sel.kind === "piece" ? this.doc.pieces[d.sel.i] : this.doc.spawns[d.sel.i];
      o.x = d.orig.x + dx; o.y = d.orig.y + dy;
      if (o !== d.orig && "kind" in o && o.kind === "platform" && o.motion?.kind === "orbit" && "motion" in d.orig && d.orig.motion?.kind === "orbit") { o.motion.cx = d.orig.motion.cx + dx; o.motion.cy = d.orig.motion.cy + dy; }
    } else if (d.mode === "resize") {
      const p = this.doc.pieces[d.i], o = d.orig, h = d.handle;
      if (p.kind === "terrain" && o.kind === "terrain") {
        let x1 = o.x, y1 = o.y, x2 = o.x + o.w, y2 = o.y + o.h;
        if (h.includes("l")) x1 = Math.min(o.x + dx, x2 - TERRAIN_MIN.w);
        if (h.includes("r")) x2 = Math.max(o.x + o.w + dx, x1 + TERRAIN_MIN.w);
        if (h.includes("t")) y1 = Math.min(o.y + dy, y2 - TERRAIN_MIN.h);
        if (h.includes("b")) y2 = Math.max(o.y + o.h + dy, y1 + TERRAIN_MIN.h);
        p.x = x1; p.y = y1; p.w = x2 - x1; p.h = y2 - y1;
      } else if (p.kind === "platform" && o.kind === "platform") {
        if (h === "l") { const x1 = Math.min(o.x + dx, o.x + o.w - PLATFORM_MIN_W); p.w = o.x + o.w - x1; p.x = x1; }
        else { p.w = Math.max(PLATFORM_MIN_W, o.w + dx); }
      }
    } else if (d.mode === "far") {
      const p = this.doc.pieces[d.i];
      if (p.kind === "platform" && p.motion && d.orig.motion) {
        if (p.motion.kind === "line" && d.orig.motion.kind === "line") { p.motion.dx = d.orig.motion.dx + dx; p.motion.dy = d.orig.motion.dy + dy; }
        else if (p.motion.kind === "orbit" && d.orig.motion.kind === "orbit") {
          const cx = d.orig.motion.cx + dx, cy = d.orig.motion.cy + dy;
          const r = Math.max(10, snap(Math.hypot(cx - (p.x + p.w / 2), cy - p.y)));
          p.motion.cx = cx; p.motion.cy = cy; p.motion.rx = r; p.motion.ry = r;
        }
      }
    }
    if (s.phase === "up") { this.settle(d.before); this.drag = null; }
  }

  private finishDraw(d: Extract<Drag, { mode: "draw" }>): void {
    const x = Math.min(d.a.x, d.b.x), y = Math.min(d.a.y, d.b.y), w = Math.abs(d.b.x - d.a.x), h = Math.abs(d.b.y - d.a.y);
    const click = w < GRID * 2 && h < GRID * 2;
    this.edit(() => {
      let piece: MapPiece;
      if (this.tool === "terrain") piece = click ? { kind: "terrain", x: snap(d.a.x - DEFAULT_TERRAIN.w / 2), y: d.a.y, ...DEFAULT_TERRAIN } : { kind: "terrain", x, y, w: Math.max(TERRAIN_MIN.w, w), h: Math.max(TERRAIN_MIN.h, h) };
      else {
        piece = click ? { kind: "platform", x: snap(d.a.x - DEFAULT_PLATFORM_W / 2), y: d.a.y, w: DEFAULT_PLATFORM_W } : { kind: "platform", x, y: d.a.y, w: Math.max(PLATFORM_MIN_W, w) };
        if (this.tool === "mover") piece.motion = { kind: "line", dx: 0, dy: -300, period: DEFAULT_PERIOD, phase: 0 };
      }
      this.doc.pieces.push(piece);
      this.sel = { kind: "piece", i: this.doc.pieces.length - 1 };
    });
    this.tool = "select";
    sfx.menuConfirm();
  }

  /** A copy of `p` shifted by (dx, dy), its orbit centre moving with it. */
  private shifted(p: MapPiece, dx: number, dy: number): MapPiece {
    const c = clone(p);
    c.x += dx; c.y += dy;
    if (c.kind === "platform" && c.motion?.kind === "orbit") { c.motion.cx += dx; c.motion.cy += dy; }
    return c;
  }

  private place(piece: MapPiece): void {
    this.edit(() => {
      this.doc.pieces.push(piece);
      this.sel = { kind: "piece", i: this.doc.pieces.length - 1 };
    });
    this.tool = "select";
    sfx.menuConfirm();
  }

  private copy(): void {
    const p = this.selectedPiece();
    if (!p) return;
    this.clipboard = clone(p);
    this.status = "copied";
  }

  /** Pastes under the pointer when it's over the map, else a little off the original. */
  private paste(): void {
    const c = this.clipboard;
    if (!c) return;
    if (pointer.present && !this.overUi(pointer)) {
      const w = this.toWorld(pointer);
      const r = pieceRect(c);
      this.place(this.shifted(c, snap(w.x - r.w / 2) - c.x, snap(w.y) - c.y));
    } else this.place(this.shifted(c, 40, 40));
  }

  private duplicate(): void {
    const p = this.selectedPiece();
    if (p) this.place(this.shifted(p, 40, 40));
  }

  private wheel(e: WheelEvent): void {
    const canvas = e.currentTarget as HTMLCanvasElement;
    const r = canvas.getBoundingClientRect();
    const scale = Math.min(r.width / VIEW_W, r.height / VIEW_H);
    const v = { x: (e.clientX - r.left - (r.width - VIEW_W * scale) / 2) / scale, y: (e.clientY - r.top - (r.height - VIEW_H * scale) / 2) / scale };
    const before = this.toWorld(v);
    this.zoom = Math.max(ZOOM.min, Math.min(ZOOM.max, this.zoom * Math.pow(1.0015, -e.deltaY)));
    const after = this.toWorld(v);
    this.cam = { x: this.cam.x + before.x - after.x, y: this.cam.y + before.y - after.y };
  }

  private key(e: KeyboardEvent): void {
    if (this.name?.el === document.activeElement) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.code === "KeyZ") { e.preventDefault(); if (e.shiftKey) this.redo(); else this.undo(); return; }
    if (mod && e.code === "KeyY") { e.preventDefault(); this.redo(); return; }
    if (mod && e.code === "KeyS") { e.preventDefault(); void this.save(); return; }
    if (mod && e.code === "KeyC") { e.preventDefault(); this.copy(); return; }
    if (mod && e.code === "KeyV") { e.preventDefault(); this.paste(); return; }
    if (mod && e.code === "KeyD") { e.preventDefault(); this.duplicate(); return; }
    if (e.code === "Space") { this.space = true; e.preventDefault(); return; }
    if (e.code === "Delete" || e.code === "Backspace") { e.preventDefault(); this.deleteSelection(); return; }
    if (e.code === "Escape") { if (this.sel) this.sel = null; else this.setTool("select"); return; }
    const step = e.shiftKey ? 50 : GRID;
    if (e.code === "ArrowLeft") { e.preventDefault(); this.nudge(-step, 0); }
    else if (e.code === "ArrowRight") { e.preventDefault(); this.nudge(step, 0); }
    else if (e.code === "ArrowUp") { e.preventDefault(); this.nudge(0, -step); }
    else if (e.code === "ArrowDown") { e.preventDefault(); this.nudge(0, step); }
    else if (e.code === "KeyF") this.fit();
    else { const tool = TOOLS.find((t) => e.code === `Key${t.key}`); if (tool) this.setTool(tool.id); }
  }

  // ---- saving and testing -----------------------------------------------------

  private async save(): Promise<void> {
    if (this.saving) return;
    this.doc.name = this.name?.value.trim() ?? this.doc.name;
    const problems = this.problems();
    if (problems.length) { this.problem = problems[0]; return; }
    this.saving = true;
    this.status = "saving…";
    try {
      const { map } = this.stored ? await mapsApi.save(this.doc) : await mapsApi.create(this.doc);
      this.doc = { ...this.doc, ...map };
      if (this.name) this.name.value = this.doc.name;
      this.stored = true;
      this.dirty = false;
      this.status = "saved";
      registerMap(this.doc);
      void refreshMaps();
      sfx.menuConfirm();
    } catch (error) {
      console.error("map save failed", error);
      this.problem = error instanceof Error ? error.message : String(error);
      this.status = "";
    } finally {
      this.saving = false;
    }
  }

  private test(): Screen | null {
    this.doc.name = this.name?.value.trim() || "UNTITLED";
    const problems = this.problems();
    if (problems.length) { this.problem = problems[0]; return null; }
    sfx.go();
    return this.leaveTo(this.nav.testMap(clone(this.doc), () => this));
  }

  private back(): Screen | null {
    if (this.dirty && this.t - this.leaveArmed > 3) { this.leaveArmed = this.t; return null; }
    sfx.menuBack();
    return this.leaveTo(this.nav.maps());
  }

  // ---- frame ----------------------------------------------------------------

  update(dt: number, _m: MenuInput): Screen | null {
    this.t += dt;
    return null;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    drawPaper(ctx, VIEW_W, VIEW_H);
    this.drawWorld(ctx);
    this.drawChrome(ctx);
  }

  private drawWorld(ctx: CanvasRenderingContext2D): void {
    const doc = this.doc;
    const valid = !checkMap({ ...doc, name: "x" }).length;
    const stage = valid ? stageFromMap(doc) : null;
    ctx.save();
    ctx.translate(VIEW_W / 2, VIEW_H / 2);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.cam.x, -this.cam.y);
    const thin = 1 / this.zoom;
    if (stage) {
      const b = stage.blast, c = stage.camera;
      ctx.save();
      ctx.setLineDash([14 * thin, 10 * thin]);
      ctx.globalAlpha = 0.55;
      inkRect(ctx, b.left, b.top, b.right - b.left, b.bottom - b.top, RED, 2 * thin);
      ctx.globalAlpha = 0.35;
      inkRect(ctx, c.left, c.top, c.right - c.left, c.bottom - c.top, PENCIL, 1.5 * thin);
      ctx.restore();
      const fake = { platOffsets: stage.platforms.map((p) => platformMotion(p, this.frame)) } as unknown as State;
      drawStage(ctx, fake, stage);
    }
    // what's being drawn right now
    const d = this.drag;
    if (d?.mode === "draw") {
      const x = Math.min(d.a.x, d.b.x), y = Math.min(d.a.y, d.b.y), w = Math.abs(d.b.x - d.a.x), h = Math.abs(d.b.y - d.a.y);
      ctx.save(); ctx.setLineDash([8 * thin, 8 * thin]);
      if (this.tool === "terrain") inkRect(ctx, x, y, w, h, INK, 2 * thin);
      else inkLine(ctx, x, d.a.y, x + w, d.a.y, INK, 4 * thin);
      ctx.restore();
    }
    // movers: their rest position and path
    doc.pieces.forEach((p, i) => {
      if (p.kind !== "platform" || !p.motion) return;
      const selected = this.sel?.kind === "piece" && this.sel.i === i;
      ctx.save();
      ctx.setLineDash([6 * thin, 6 * thin]);
      ctx.globalAlpha = selected ? 0.9 : 0.45;
      inkRect(ctx, p.x, p.y - 4, p.w, 20, PENCIL, 1.5 * thin);
      const m = p.motion, cx = p.x + p.w / 2;
      if (m.kind === "line") inkLine(ctx, cx, p.y, cx + m.dx, p.y + m.dy, PENCIL, 2 * thin);
      else { ctx.strokeStyle = PENCIL; ctx.lineWidth = 2 * thin; ctx.beginPath(); ctx.ellipse(m.cx, m.cy, m.rx, m.ry, 0, 0, Math.PI * 2); ctx.stroke(); }
      ctx.restore();
    });
    // the selection
    const sp = this.selectedPiece();
    if (sp) { const r = pieceRect(sp); ctx.save(); ctx.globalAlpha = 0.9; inkRect(ctx, r.x - 3 * thin, r.y - 3 * thin, r.w + 6 * thin, r.h + 6 * thin, "#287ad4", 2.5 * thin); ctx.restore(); }
    ctx.restore();
    // spawns, handles and labels in view space so they keep their size
    doc.spawns.forEach((s, i) => {
      const v = this.toView(s), color = SLOT_COLORS[i];
      const selected = this.sel?.kind === "spawn" && this.sel.i === i;
      ctx.save();
      ctx.fillStyle = color; ctx.strokeStyle = INK; ctx.lineWidth = selected ? 3 : 1.5;
      ctx.beginPath(); ctx.moveTo(v.x - 12, v.y - 30); ctx.lineTo(v.x + 12, v.y - 30); ctx.lineTo(v.x, v.y - 10); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(v.x - 16, v.y); ctx.lineTo(v.x + 16, v.y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(v.x + s.facing * 4, v.y - 5); ctx.lineTo(v.x + s.facing * 12, v.y - 5); ctx.lineTo(v.x + s.facing * 9, v.y - 8); ctx.stroke();
      ctx.restore();
      label(ctx, `P${i + 1}`, v.x, v.y - 38, 24, color, "center", 900);
    });
    if (sp) {
      for (const [, pt] of this.handles(sp)) this.drawHandle(ctx, this.toView(pt), false);
      if (sp.kind === "platform") { const far = farPoint(sp); if (far) this.drawHandle(ctx, this.toView(far), true); }
    }
    if (stage) {
      const b = this.toView({ x: stage.blast.left, y: stage.blast.top });
      label(ctx, "blast zone", b.x + 8, b.y + 24, 20, RED, "left");
      const main = terrainOf(doc)[0];
      const mv = this.toView({ x: main.x + main.w / 2, y: main.y + main.h / 2 });
      label(ctx, "MAIN", mv.x, mv.y + 8, Math.max(14, Math.min(28, 40 * this.zoom)), "rgba(41,39,34,0.35)", "center", 900);
    }
  }

  private drawHandle(ctx: CanvasRenderingContext2D, v: ViewPoint, round: boolean): void {
    ctx.save();
    ctx.fillStyle = PAPER; ctx.strokeStyle = "#287ad4"; ctx.lineWidth = 2;
    ctx.beginPath();
    if (round) ctx.arc(v.x, v.y, HANDLE + 2, 0, Math.PI * 2); else ctx.rect(v.x - HANDLE, v.y - HANDLE, HANDLE * 2, HANDLE * 2);
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  private drawChrome(ctx: CanvasRenderingContext2D): void {
    label(ctx, "MAP EDITOR", 30, 62, 34, INK, "left", 900);
    card(ctx, NAME.x, NAME.y, NAME.w, NAME.h, INK, this.name?.el === document.activeElement);
    this.name?.place(NAME.x + 20, NAME.y + 8, NAME.w - 40, NAME.h - 16, 30);
    const status = this.saving ? "saving…" : this.dirty ? "unsaved changes" : this.status;
    if (status) label(ctx, status, VIEW_W - 40, 62, 24, PENCIL, "right");

    TOOLS.forEach((t, i) => {
      const y = COL.y0 + i * COL.step;
      if (button(ctx, COL.x, y, COL.w, COL.h, t.text, { focused: this.tool === t.id, key: t.key, size: 26 })) this.setTool(t.id);
    });
    const y2 = COL.y0 + TOOLS.length * COL.step + 30;
    if (button(ctx, COL.x, y2, COL.w, COL.h, "UNDO", { key: "Ctrl+Z", size: 26, disabled: !this.past.length })) this.undo();
    if (button(ctx, COL.x, y2 + COL.step, COL.w, COL.h, "REDO", { key: "Ctrl+Y", size: 26, disabled: !this.future.length })) this.redo();
    if (button(ctx, COL.x, y2 + COL.step * 2, COL.w, COL.h, "FIT VIEW", { key: "F", size: 26 })) this.fit();

    this.drawInspector(ctx);

    const armed = this.dirty && this.t - this.leaveArmed <= 3;
    if (button(ctx, 40, VIEW_H - 100, 220, 64, armed ? "LEAVE UNSAVED?" : "BACK", { size: 24 })) { const next = this.back(); if (next) goTo(next); }
    if (button(ctx, VIEW_W - 560, VIEW_H - 110, 240, 74, "TEST", { size: 32 })) { const next = this.test(); if (next) goTo(next); }
    if (button(ctx, VIEW_W - 300, VIEW_H - 110, 260, 74, "SAVE", { key: "Ctrl+S", size: 32, disabled: this.saving || !this.dirty })) void this.save();

    const problems = this.problems(true);
    const trouble = this.problem || problems[0] || "";
    if (this.problem && !problems.length && this.t % 1 < 0.02) this.problem = "";
    if (trouble) label(ctx, trouble, VIEW_W / 2, VIEW_H - 92, 26, RED);
    const hints: Record<Tool, string> = {
      select: "drag things to move them, their handles to resize · drag empty paper to pan, wheel to zoom · Delete removes, arrows nudge, Ctrl+C / Ctrl+V copy",
      terrain: "drag to draw a block of ground (click for a standard one) · walls and grabbable ledges come with it",
      platform: "drag to draw a thin platform (click for a standard one) · fighters drop through it",
      mover: "drag to draw a moving platform · then drag the round handle to set where it goes",
    };
    label(ctx, hints[this.tool], VIEW_W / 2, VIEW_H - 36, 20, "rgba(41,39,34,0.75)");
  }

  private drawInspector(ctx: CanvasRenderingContext2D): void {
    const sel = this.sel;
    if (!sel) return;
    const { x, y, w } = INSPECT;
    const row = (i: number) => y + 70 + i * 74;
    const stepper = (i: number, text: string, value: string, onStep: (dir: -1 | 1) => void) => {
      const ry = row(i);
      card(ctx, x, ry, w, 62, INK, false);
      label(ctx, text, x + 16, ry + 40, 22, INK, "left", 800);
      const arrowsAt = [[x + w - 156, -1], [x + w - 34, 1]] as const;
      for (const [ax, dir] of arrowsAt) {
        const over = pointer.present && pointer.x >= ax - 4 && pointer.x <= ax + 28 && pointer.y >= ry + 12 && pointer.y <= ry + 52;
        label(ctx, dir < 0 ? "◀" : "▶", ax + 12, ry + 42, over ? 30 : 26, over ? "#c8402c" : INK);
        if (over) document.body.style.cursor = "pointer";
        if (pointer.clicked && pointer.tapX >= ax - 4 && pointer.tapX <= ax + 28 && pointer.tapY >= ry + 12 && pointer.tapY <= ry + 52) { onStep(dir); sfx.menuMove(); }
      }
      label(ctx, value, x + w - 80, ry + 40, 22, INK, "center", 900, 100);
    };
    if (sel.kind === "spawn") {
      const s = this.doc.spawns[sel.i];
      card(ctx, x - 10, y - 10, w + 20, 240, INK, false);
      title(ctx, `SPAWN P${sel.i + 1}`, x + w / 2, y + 36, 34, SLOT_COLORS[sel.i]);
      stepper(0, "FACING", s.facing > 0 ? "right" : "left", () => this.edit(() => { s.facing = s.facing > 0 ? -1 : 1; }));
      label(ctx, "drag it onto any surface", x + w / 2, row(1) + 30, 20, PENCIL);
      return;
    }
    const p = this.doc.pieces[sel.i];
    const mover = p.kind === "platform" && !!p.motion;
    const rows = p.kind === "terrain" ? 2 : mover ? 5 : 2;
    card(ctx, x - 10, y - 10, w + 20, 80 + rows * 74 + 20, INK, false);
    title(ctx, p.kind === "terrain" ? "TERRAIN" : mover ? "MOVING PLATFORM" : "PLATFORM", x + w / 2, y + 36, 30, INK, "center", w);
    let i = 0;
    if (p.kind === "terrain") {
      stepper(i++, "WIDTH", `${p.w}`, (d) => this.edit(() => { p.w = Math.max(TERRAIN_MIN.w, p.w + d * 20); }));
      stepper(i++, "HEIGHT", `${p.h}`, (d) => this.edit(() => { p.h = Math.max(TERRAIN_MIN.h, p.h + d * 20); }));
      if (terrainOf(this.doc)[0] === p) label(ctx, "the main stage: fighters start here", x + w / 2, row(i) + 18, 18, PENCIL);
    } else {
      stepper(i++, "WIDTH", `${p.w}`, (d) => this.edit(() => { p.w = Math.max(PLATFORM_MIN_W, p.w + d * 20); }));
      const kinds = ["none", "line", "orbit"] as const;
      const current = p.motion?.kind ?? "none";
      const names = { none: "still", line: "back & forth", orbit: "circle" };
      stepper(i++, "MOVES", names[current], (d) => this.setMotion(p, kinds[(kinds.indexOf(current) + d + 3) % 3]));
      if (p.motion) {
        const m = p.motion;
        stepper(i++, "TRIP", `${(m.period / 60).toFixed(1)}s`, (d) => this.edit(() => { m.period = Math.max(PERIOD_MIN, Math.min(PERIOD_MAX, m.period + d * 60)); }));
        stepper(i++, "OFFSET", `${Math.round((m.phase / m.period) * 100)}%`, (d) => this.edit(() => { m.phase = ((m.phase + d * Math.round(m.period / 8)) % m.period + m.period) % m.period; }));
        label(ctx, m.kind === "line" ? "drag the round handle to the far end" : "drag the round handle to the circle's centre", x + w / 2, row(i) + 18, 18, PENCIL);
        i++;
      }
    }
    const half = (w - 12) / 2;
    if (button(ctx, x, row(i) + 10, half, 58, "DUPLICATE", { key: "Ctrl+D", size: 22 })) this.duplicate();
    if (button(ctx, x + half + 12, row(i) + 10, half, 58, "DELETE", { key: "Del", size: 22 })) this.deleteSelection();
  }
}
