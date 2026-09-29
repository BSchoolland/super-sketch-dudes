import type { Platform, PlatformMotion, Stage } from "./types";

/**
 * A player-made stage, as the editor keeps it: solid terrain blocks, thin platforms (some of
 * them moving) and four spawn points. `stageFromMap` derives everything the sim needs from it
 * (ledges, blast zones, camera, respawn) so a map is only what its maker drew.
 */
export interface MapTerrain { kind: "terrain"; x: number; y: number; w: number; h: number }
export interface MapPlatform { kind: "platform"; x: number; y: number; w: number; motion?: PlatformMotion }
export type MapPiece = MapTerrain | MapPlatform;
export interface MapSpawn { x: number; y: number; facing: 1 | -1 }

export interface MapDoc {
  id: string;
  name: string;
  owner: string;
  ownerName: string;
  createdAt: number;
  updatedAt: number;
  pieces: MapPiece[];
  spawns: MapSpawn[];
}

export const MAP_NAME_MAX = 28;
export const MAP_PIECES_MAX = 48;
/** Coordinates are kept inside this box; the stage is a few thousand units across at most. */
export const MAP_EXTENT = 6000;
export const TERRAIN_MIN = { w: 80, h: 40 };
export const PLATFORM_MIN_W = 60;
export const PERIOD_MIN = 120, PERIOD_MAX = 3600;
/** How far a moving platform may travel from its rest position. */
export const MOTION_MAX = 3000;
export const MAP_JSON_MAX = 64 * 1024;
export const MAP_ID = /^map-[0-9a-f]{10}$/;

/** Blast zones sit this far outside the outermost terrain and platforms (the shipped stages' proportions). */
const BLAST = { side: 750, top: 850, bottom: 260 };
/** The camera may show this much less than the blast zone, so nobody dies in the middle of the screen. */
const CAMERA_INSET = { side: 200, top: 150, bottom: 140 };
const RESPAWN_HEIGHT = 440;

const num = (v: unknown, lo = -MAP_EXTENT, hi = MAP_EXTENT): v is number => typeof v === "number" && isFinite(v) && v >= lo && v <= hi;

function checkMotion(m: unknown, at: string, p: string[]): void {
  if (!m || typeof m !== "object") { p.push(`${at}: motion must be an object`); return; }
  const o = m as Record<string, unknown>;
  if (!num(o.period, PERIOD_MIN, PERIOD_MAX)) p.push(`${at}: period must be ${PERIOD_MIN}–${PERIOD_MAX} frames`);
  if (!num(o.phase, 0, PERIOD_MAX)) p.push(`${at}: phase must be 0–${PERIOD_MAX}`);
  if (o.kind === "line") {
    if (!num(o.dx, -MOTION_MAX, MOTION_MAX) || !num(o.dy, -MOTION_MAX, MOTION_MAX)) p.push(`${at}: line motion needs dx and dy within ${MOTION_MAX}`);
  } else if (o.kind === "orbit") {
    if (!num(o.cx) || !num(o.cy)) p.push(`${at}: orbit needs a centre`);
    if (!num(o.rx, 10, MOTION_MAX) || !num(o.ry, 10, MOTION_MAX)) p.push(`${at}: orbit radii must be 10–${MOTION_MAX}`);
  } else p.push(`${at}: motion kind must be line or orbit`);
}

/** Everything wrong with a map document; empty when it can be played. Runs on the server and on every client that receives one. */
export function checkMap(v: unknown): string[] {
  const p: string[] = [];
  if (!v || typeof v !== "object" || Array.isArray(v)) return ["map must be an object"];
  const d = v as Record<string, unknown>;
  if (typeof d.id !== "string" || !MAP_ID.test(d.id)) p.push("bad map id");
  if (typeof d.name !== "string" || !d.name.trim() || d.name.length > MAP_NAME_MAX) p.push("the map needs a name");
  if (typeof d.owner !== "string" || !d.owner) p.push("map has no owner");
  if (!Array.isArray(d.pieces)) return [...p, "pieces must be a list"];
  if (d.pieces.length > MAP_PIECES_MAX) p.push(`at most ${MAP_PIECES_MAX} pieces`);
  let terrain = 0;
  d.pieces.forEach((piece, i) => {
    const at = `piece ${i + 1}`;
    if (!piece || typeof piece !== "object") { p.push(`${at}: not an object`); return; }
    const o = piece as Record<string, unknown>;
    if (!num(o.x) || !num(o.y)) p.push(`${at}: position out of range`);
    if (o.kind === "terrain") {
      terrain++;
      if (!num(o.w, TERRAIN_MIN.w, MAP_EXTENT) || !num(o.h, TERRAIN_MIN.h, MAP_EXTENT)) p.push(`${at}: terrain must be at least ${TERRAIN_MIN.w}×${TERRAIN_MIN.h}`);
    } else if (o.kind === "platform") {
      if (!num(o.w, PLATFORM_MIN_W, MAP_EXTENT)) p.push(`${at}: platforms must be at least ${PLATFORM_MIN_W} wide`);
      if (o.motion !== undefined) checkMotion(o.motion, at, p);
    } else p.push(`${at}: kind must be terrain or platform`);
  });
  if (!terrain) p.push("a map needs at least one piece of terrain");
  if (!Array.isArray(d.spawns) || d.spawns.length !== 4) p.push("a map needs four spawn points");
  else d.spawns.forEach((s, i) => {
    const o = s as Record<string, unknown> | null;
    if (!o || typeof o !== "object" || !num(o.x) || !num(o.y) || (o.facing !== 1 && o.facing !== -1)) p.push(`spawn ${i + 1} is malformed`);
  });
  return p;
}

/** The terrain blocks, biggest first: the biggest is the main stage (the camera keeps it in frame, fighters start on it). */
export function terrainOf(doc: MapDoc): MapTerrain[] {
  return doc.pieces.filter((p): p is MapTerrain => p.kind === "terrain").sort((a, b) => b.w * b.h - a.w * a.h);
}

/** Where a piece's motion can take it: the box its rest rectangle sweeps. */
function motionBox(p: MapPlatform): { x1: number; x2: number; y1: number; y2: number } {
  const m = p.motion;
  if (!m) return { x1: p.x, x2: p.x + p.w, y1: p.y, y2: p.y };
  if (m.kind === "line") return { x1: Math.min(p.x, p.x + m.dx), x2: Math.max(p.x + p.w, p.x + p.w + m.dx), y1: Math.min(p.y, p.y + m.dy), y2: Math.max(p.y, p.y + m.dy) };
  return { x1: m.cx - m.rx - p.w / 2, x2: m.cx + m.rx + p.w / 2, y1: m.cy - m.ry, y2: m.cy + m.ry };
}

export function stageFromMap(doc: MapDoc): Stage {
  const terrain = terrainOf(doc);
  const main = terrain[0];
  if (!main) throw new Error(`map ${doc.id} has no terrain`);
  const thin = doc.pieces.filter((p): p is MapPlatform => p.kind === "platform");
  const platforms: Platform[] = [
    ...terrain.map((t): Platform => ({ x1: t.x, x2: t.x + t.w, y: t.y, solid: true, bottom: t.y + t.h })),
    ...thin.map((p): Platform => ({ x1: p.x, x2: p.x + p.w, y: p.y, ...(p.motion ? { motion: p.motion } : {}) })),
  ];
  // a corner is a ledge unless another block fills the air beside it or stands on it
  const solidAt = (x: number, y: number) => terrain.some((t) => x > t.x && x < t.x + t.w && y > t.y && y < t.y + t.h);
  const ledges = terrain.flatMap((t, i) => [
    { x: t.x, y: t.y, side: -1 as const, platform: i },
    { x: t.x + t.w, y: t.y, side: 1 as const, platform: i },
  ]).filter((l) => !solidAt(l.x + l.side * 2, l.y + 2) && !solidAt(l.x - l.side * 2, l.y - 2));
  let x1 = Infinity, x2 = -Infinity, y1 = Infinity, y2 = -Infinity;
  for (const t of terrain) { x1 = Math.min(x1, t.x); x2 = Math.max(x2, t.x + t.w); y1 = Math.min(y1, t.y); y2 = Math.max(y2, t.y + t.h); }
  for (const p of thin) { const b = motionBox(p); x1 = Math.min(x1, b.x1); x2 = Math.max(x2, b.x2); y1 = Math.min(y1, b.y1); y2 = Math.max(y2, b.y2); }
  const blast = { left: x1 - BLAST.side, right: x2 + BLAST.side, top: y1 - BLAST.top, bottom: y2 + BLAST.bottom };
  const camera = { left: blast.left + CAMERA_INSET.side, right: blast.right - CAMERA_INSET.side, top: blast.top + CAMERA_INSET.top, bottom: blast.bottom - CAMERA_INSET.bottom, minWidth: 900 };
  return {
    id: doc.id,
    name: doc.name,
    platforms,
    ledges,
    blast,
    camera,
    spawns: doc.spawns.map((s) => ({ x: s.x, y: s.y, facing: s.facing })),
    respawn: { x: main.x + main.w / 2, y: main.y - RESPAWN_HEIGHT },
    theme: "custom",
  };
}

/** A fresh map: one block of ground with the four spawns spread along it. */
export function newMapDoc(id: string, owner: string, ownerName: string, name: string, now: number): MapDoc {
  const main: MapTerrain = { kind: "terrain", x: -560, y: 0, w: 1120, h: 260 };
  return { id, name, owner, ownerName, createdAt: now, updatedAt: now, pieces: [main], spawns: defaultSpawns(main) };
}

export function defaultSpawns(main: MapTerrain): MapSpawn[] {
  const cx = main.x + main.w / 2, half = main.w / 2;
  return [
    { x: cx - half * 0.7, y: main.y, facing: 1 },
    { x: cx + half * 0.7, y: main.y, facing: -1 },
    { x: cx - half * 0.23, y: main.y, facing: 1 },
    { x: cx + half * 0.23, y: main.y, facing: -1 },
  ];
}
