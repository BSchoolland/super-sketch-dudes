import { formDef } from "../fighter";
import { HIT_FAMILIES, LOOK_SHAPES, LOOK_TEXTURES, LOOK_TRAILS } from "../types";
import type { Bar, Look, Move, FighterDef, SpriteRig } from "../types";
import { generatedApi } from "./api";
import { SPRITE_CELLS, defaultCellForMove, STATE_CELLS } from "./sprite";

/** Moves every fighter must define: the CPU, the input layer and the tests all assume them. */
export const CORE_MOVES = ["jab1", "ftilt", "utilt", "dtilt", "dashAttack", "fsmash", "usmash", "dsmash", "nair", "fair", "bair", "uair", "dair", "nspecial", "sspecial", "uspecial", "dspecial"] as const;

/** Source patterns that would break determinism or reach outside the sim. Same list as scripts/lint-determinism.mjs plus the browser. */
const BANNED: [RegExp, string][] = [
  [/Math\.(sin|cos|tan|atan2|atan|asin|acos|pow|exp|log|log2|log10|random|hypot|cbrt|sinh|cosh|tanh)\b/, "non-deterministic Math (use api.sinDeg/cosDeg/atan2Deg and arithmetic)"], // determinism-ok
  [/\bDate\b|performance\.now|structuredClone|parseFloat\(|toFixed\(/, "non-deterministic builtin"], // determinism-ok // determinism-ok
  [/\b(fetch|XMLHttpRequest|WebSocket|document|window|globalThis|localStorage|sessionStorage|indexedDB|navigator|process|require|setTimeout|setInterval|queueMicrotask|eval|Function|Worker|importScripts)\b/, "reaches outside the sim"],
  [/\bimport\s*\(|^\s*import\s/m, "imports are not allowed; everything comes from the api argument"],
  [/\basync\b|\bawait\b|\.then\(/, "must be synchronous"],
];

/** Comments and string literals blanked out (newlines kept), so a word in a comment can't trip the lint. */
export function codeOnly(src: string): string {
  let out = "", i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === "/" && d === "/") { while (i < n && src[i] !== "\n") { out += " "; i++; } continue; }
    if (c === "/" && d === "*") { i += 2; out += "  "; while (i < n && !(src[i] === "*" && src[i + 1] === "/")) { out += src[i] === "\n" ? "\n" : " "; i++; } i += 2; out += "  "; continue; }
    if (c === '"' || c === "'" || c === "`") {
      out += c; i++;
      while (i < n && src[i] !== c) { if (src[i] === "\\") { out += " "; i++; } out += src[i] === "\n" ? "\n" : " "; i++; }
      out += c; i++; continue;
    }
    out += c; i++;
  }
  return out;
}

export function lintGeneratedSource(src: string): string[] {
  const problems: string[] = [];
  codeOnly(src).split("\n").forEach((line, i) => {
    if (line.includes("// determinism-ok")) return;
    for (const [re, why] of BANNED) if (re.test(line)) problems.push(`line ${i + 1}: ${why}: ${line.trim().slice(0, 120)}`);
  });
  if (!/export\s+default\s+function/.test(src)) problems.push("module must `export default function make(api) { ... }`");
  return problems;
}

function checkBars(bars: unknown, p: string[]): void {
  if (!bars || typeof bars !== "object" || Array.isArray(bars)) { p.push("bars must be an object of { label, color, max, start?, trip?, rearm?, show? }"); return; }
  for (const [k, b] of Object.entries(bars as Record<string, Partial<Bar>>)) {
    const at = `bars.${k}`;
    if (!b || typeof b !== "object") { p.push(`${at} must be an object`); continue; }
    if (typeof b.label !== "string" || typeof b.color !== "string") p.push(`${at} needs a label and a color`);
    if (typeof b.max !== "number" || !isFinite(b.max) || b.max <= 0) { p.push(`${at}.max must be a positive number`); continue; }
    const inRange = (name: "start" | "trip" | "rearm") => {
      const v = b[name];
      if (v === undefined) return;
      if (typeof v !== "number" || !isFinite(v) || v < 0 || v > b.max!) p.push(`${at}.${name} must be a number from 0 to max (${b.max})`);
    };
    inRange("start"); inRange("trip"); inRange("rearm");
    if ((b.trip === undefined) !== (b.rearm === undefined)) p.push(`${at}: trip and rearm go together`);
    else if (b.trip !== undefined && b.trip === b.rearm) p.push(`${at}: trip and rearm must differ (the gap between them is what makes it a latch)`);
    if (b.show !== undefined && typeof b.show !== "function") p.push(`${at}.show must be a function`);
  }
}

/** Loads a generated module from source and calls its factory. Works in browsers and Node (data: URL import). */
export async function instantiateGenerated(src: string): Promise<(api: typeof generatedApi) => FighterDef> {
  const lint = lintGeneratedSource(src);
  if (lint.length) throw new Error(`generated fighter rejected:\n${lint.join("\n")}`);
  const url = `data:text/javascript;base64,${toBase64(src)}`;
  const mod = await import(/* @vite-ignore */ url);
  if (typeof mod.default !== "function") throw new Error("generated module has no default export function");
  return mod.default;
}

function toBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export interface GeneratedBundle {
  id: string;
  source: string;
  sprite: SpriteRig;
  player: string;
  description: string;
}

/** Builds and validates a FighterDef from a bundle. Throws with every problem listed, never a partial fighter. */
export async function buildGenerated(b: GeneratedBundle): Promise<FighterDef> {
  const make = await instantiateGenerated(b.source);
  let def: FighterDef;
  try { def = make(generatedApi); } catch (e) { throw new Error(`generated fighter factory threw: ${e instanceof Error ? e.message : String(e)}`); }
  def = { ...def, id: b.id, sprite: b.sprite, generated: { player: b.player, description: b.description } };
  if (!def.rig) def.rig = { anims: {}, loops: {} };
  const problems = validateGenerated(def);
  if (problems.length) throw new Error(`generated fighter ${b.id} invalid:\n${problems.join("\n")}`);
  return def;
}

const STAT_RANGES: Record<string, [number, number]> = {
  weight: [40, 400], walk: [0.5, 12], run: [1, 20], dashInit: [1, 24], airSpeed: [0.5, 12], airAccel: [0.02, 1], fallSpeed: [3, 30], fastFall: [3, 40],
  gravity: [0.15, 2], shortHop: [3, 30], fullHop: [5, 40], doubleJump: [0, 40], jumps: [1, 6], traction: [0.1, 3], height: [50, 300], width: [24, 200],
  crouchHeight: [30, 300], landLag: [0, 30], ledgeReach: [0, 120],
};

function checkLooks(looks: unknown, cells: Set<string>, px: number, p: string[]): void {
  if (!looks || typeof looks !== "object") { p.push("looks must be an object of named looks"); return; }
  for (const [name, l] of Object.entries(looks as Record<string, Look>)) {
    const at = `looks.${name}`;
    if (!l || typeof l !== "object") { p.push(`${at} must be an object`); continue; }
    if (l.cell !== undefined && !cells.has(l.cell)) p.push(`${at}.cell "${l.cell}" is not on the sheet`);
    if (l.crop !== undefined) {
      if (l.cell === undefined) p.push(`${at}.crop needs a cell`);
      if (!Array.isArray(l.crop) || l.crop.length !== 4 || l.crop.some((v) => typeof v !== "number" || !isFinite(v))) p.push(`${at}.crop must be [x, y, w, h] in cell pixels`);
      else if (l.crop[0] < 0 || l.crop[1] < 0 || l.crop[2] <= 0 || l.crop[3] <= 0 || l.crop[0] + l.crop[2] > px || l.crop[1] + l.crop[3] > px) p.push(`${at}.crop outside the ${px}x${px} cell`);
    }
    if (l.shape !== undefined && !(LOOK_SHAPES as readonly string[]).includes(l.shape)) p.push(`${at}.shape "${l.shape}" is not one of ${LOOK_SHAPES.join(", ")}`);
    if (l.texture !== undefined && !(LOOK_TEXTURES as readonly string[]).includes(l.texture)) p.push(`${at}.texture "${l.texture}" is not one of ${LOOK_TEXTURES.join(", ")}`);
    if (l.trail !== undefined && !(LOOK_TRAILS as readonly string[]).includes(l.trail)) p.push(`${at}.trail "${l.trail}" is not one of ${LOOK_TRAILS.join(", ")}`);
    for (const k of ["color", "ink"] as const) if (l[k] !== undefined && (typeof l[k] !== "string" || !l[k])) p.push(`${at}.${k} must be a CSS colour string`);
    for (const k of ["size", "spin"] as const) if (l[k] !== undefined && (typeof l[k] !== "number" || !isFinite(l[k]))) p.push(`${at}.${k} must be a finite number`);
    if (l.size !== undefined && (l.size < 4 || l.size > 800)) p.push(`${at}.size outside 4..800`);
    for (const k of ["aim", "flip"] as const) if (l[k] !== undefined && typeof l[k] !== "boolean") p.push(`${at}.${k} must be a boolean`);
  }
}

function checkMoves(moves: Record<string, Move>, def: FighterDef, cells: Set<string>, p: string[], at: string, strict: boolean): void {
  const looks = new Set([...HIT_FAMILIES, ...Object.keys(def.looks ?? {})]);
  for (const [id, mv] of Object.entries(moves)) {
    if (mv.id !== id) p.push(`${at}moves.${id}.id is ${mv.id}`);
    if (!Number.isInteger(mv.total) || mv.total < 1 || mv.total > 600) p.push(`${at}${id}.total must be 1..600`);
    if (!Array.isArray(mv.poses) || !mv.poses.length) p.push(`${at}${id} has no poses`);
    if (!Array.isArray(mv.hitboxes)) p.push(`${at}${id}.hitboxes missing`);
    else for (const [i, h] of mv.hitboxes.entries()) {
      for (const k of ["x", "y", "r", "damage", "angle", "base", "growth"] as const) if (typeof h[k] !== "number" || !isFinite(h[k])) p.push(`${at}${id}.hitboxes[${i}].${k} not a finite number`);
      if (!Array.isArray(h.frames) || h.frames.length !== 2) p.push(`${at}${id}.hitboxes[${i}].frames malformed`);
      else if (!mv.throwFrame && h.frames[1] > mv.total) p.push(`${at}${id}.hitboxes[${i}] active past total`);
      if (h.r < 0 || h.r > 400) p.push(`${at}${id}.hitboxes[${i}].r outside 0..400`);
      if (h.damage < 0 || h.damage > 999) p.push(`${at}${id}.hitboxes[${i}].damage outside 0..999`);
      if (strict && h.fx !== undefined && !looks.has(h.fx)) p.push(`${at}${id}.hitboxes[${i}].fx "${h.fx}" is neither a hit family (${HIT_FAMILIES.join(", ")}) nor one of the def's looks`);
    }
    const cell = mv.cell ?? defaultCellForMove(id);
    if (!cells.has(cell)) p.push(`${at}${id} shows cell "${cell}" which the sheet doesn't have`);
    for (const [from, c] of mv.cells ?? []) {
      if (!Number.isInteger(from) || from < 0) p.push(`${at}${id}.cells has a bad frame ${from}`);
      if (!cells.has(c)) p.push(`${at}${id}.cells names cell "${c}" which the sheet doesn't have`);
    }
    if (mv.hook && typeof def.hooks?.[mv.hook] !== "function") p.push(`${at}${id} names hook "${mv.hook}" which isn't a function`);
    if (mv.next && !def.moves[mv.next]) p.push(`${at}${id}.next names unknown move ${mv.next}`);
    if (mv.counter && !def.moves[mv.counter.move]) p.push(`${at}${id}.counter.move names unknown move ${mv.counter.move}`);
  }
}

function checkAnims(anims: Record<string, string>, cells: Set<string>, p: string[], at: string): void {
  for (const [anim, cell] of Object.entries(anims)) {
    if (!(anim in STATE_CELLS)) p.push(`${at}.${anim} is not a state animation`);
    if (!cells.has(cell)) p.push(`${at}.${anim} -> "${cell}" which the sheet doesn't have`);
  }
}

/** `strict` (the forge) also rejects hitbox fx names that are neither a family nor a look; the loader lets old fighters through. */
export function validateGenerated(def: FighterDef, { strict = false } = {}): string[] {
  const p: string[] = [];
  if (typeof def.name !== "string" || !def.name.trim()) p.push("name missing");
  if (typeof def.tagline !== "string") p.push("tagline missing");
  for (const [k, [lo, hi]] of Object.entries(STAT_RANGES)) {
    const v = (def.stats as unknown as Record<string, number>)?.[k];
    if (typeof v !== "number" || !isFinite(v)) p.push(`stats.${k} must be a finite number`);
    else if (v < lo || v > hi) p.push(`stats.${k}=${v} outside ${lo}..${hi}`);
  }
  if (typeof def.stats?.wallJump !== "boolean") p.push("stats.wallJump must be a boolean");
  if (!def.moves || typeof def.moves !== "object") { p.push("moves missing"); return p; }
  for (const m of CORE_MOVES) if (!def.moves[m]) p.push(`missing core move ${m}`);
  const cells = new Set(Object.keys(def.sprite?.cells ?? {}));
  for (const c of SPRITE_CELLS) if (!cells.has(c)) p.push(`sprite is missing cell ${c}`);
  if (def.looks !== undefined) checkLooks(def.looks, cells, def.sprite?.px ?? 512, p);
  checkMoves(def.moves, def, cells, p, "", strict);
  checkAnims(def.sprite?.anims ?? {}, cells, p, "sprite.anims");
  if (def.forms !== undefined || def.form !== undefined) {
    if (!def.forms || typeof def.forms !== "object") p.push("forms must be an object of form overlays");
    else if (typeof def.form !== "function") p.push("form must be a function when forms are defined");
    else for (const [name, o] of Object.entries(def.forms)) {
      if (!o || typeof o !== "object") { p.push(`forms.${name} must be an object`); continue; }
      const merged = formDef(def, name);
      for (const [k, [lo, hi]] of Object.entries(STAT_RANGES)) {
        const v = (merged.stats as unknown as Record<string, number>)[k];
        if (typeof v !== "number" || !isFinite(v)) p.push(`forms.${name}.stats.${k} must be a finite number`);
        else if (v < lo || v > hi) p.push(`forms.${name}.stats.${k}=${v} outside ${lo}..${hi}`);
      }
      if (o.moves) checkMoves(o.moves, merged, cells, p, `forms.${name}.`, strict);
      checkAnims(o.anims ?? {}, cells, p, `forms.${name}.anims`);
    }
  }
  if (typeof def.special !== "function") p.push("special must be a function returning a plain object of numbers");
  else {
    let sp: unknown;
    try { sp = def.special(); } catch (e) { p.push(`special() threw: ${e instanceof Error ? e.message : e}`); }
    if (sp && typeof sp === "object") { for (const [k, v] of Object.entries(sp)) if (typeof v !== "number") p.push(`special().${k} must be a number`); }
    else if (sp !== undefined) p.push("special() must return an object");
  }
  if (!def.hooks || typeof def.hooks !== "object") p.push("hooks must be an object (may be empty)");
  else for (const [k, v] of Object.entries(def.hooks)) if (typeof v !== "function") p.push(`hooks.${k} is not a function`);
  for (const k of ["onHit", "onHurt", "onFrame", "visual"] as const) if (def[k] !== undefined && typeof def[k] !== "function") p.push(`${k} must be a function`);
  if (def.meters !== undefined && !Array.isArray(def.meters)) p.push("meters must be an array");
  if (def.bars !== undefined) checkBars(def.bars, p);
  if (!def.palette?.colors || typeof def.palette.outline !== "string") p.push("palette.colors and palette.outline required");
  return p;
}
