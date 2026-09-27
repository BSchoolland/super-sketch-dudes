import type { FighterDef, Pose } from "../../../shared/types";
import { drawSprite } from "../render/sprite";
import { cellForAnim } from "../../../shared/gen/sprite";
import { pointer } from "../input/pointer";
import { hover } from "./ui";

export interface PortraitBounds { x: number; y: number; w: number; h: number }

/** What the player is doing to this fighter right now. */
export interface PortraitMood {
  /** Chosen (picked, focused): it cheers when this turns on. */
  picked?: boolean;
  /** Locked in: it bounces on its toes. */
  ready?: boolean;
  /** Cheer the first time it's drawn here, e.g. a slot card that just got a new fighter. */
  cheerOnArrival?: boolean;
  /** Hop, step or crouch now and then: only fighters in the match being set up, not every cell on a shelf. */
  fidget?: boolean;
}

type Act = { cell: string; at: number; len: number; kind: "swing" | "cheer" | "hop" | "step" | "crouch" };
interface Puppet { facing: 1 | -1; hovered: boolean; picked: boolean; act: Act | null; nextFidget: number; seen: number }

const puppets = new Map<string, Puppet>();
const now = (): number => performance.now() / 1000;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

function puppetAt(key: string, mood: PortraitMood): Puppet {
  let p = puppets.get(key);
  if (!p) {
    const t = now();
    p = { facing: 1, hovered: false, picked: !!mood.picked, act: mood.cheerOnArrival ? { cell: "atk-up", at: t, len: 0.7, kind: "cheer" } : null, nextFidget: t + 4 + hash(key) * 12, seen: t };
    puppets.set(key, p);
  }
  // spots nobody has drawn for a while (a scrolled-away cell, a left screen) start over next time
  if (now() - p.seen > 1) { p.act = null; p.hovered = false; p.picked = !!mood.picked; }
  p.seen = now();
  return p;
}

/** The fidgets an idle fighter does now and then. */
const FIDGETS: Pick<Act, "cell" | "len" | "kind">[] = [
  { cell: "jump", len: 0.5, kind: "hop" },
  { cell: "walk", len: 0.6, kind: "step" },
  { cell: "block", len: 0.5, kind: "crouch" },
];

/**
 * The fighter standing in the box, alive: breathing, glancing toward the pointer, swinging
 * when hovered, cheering when picked, and (`fidget`) hopping about now and then. `key` names the
 * spot on screen, so two boxes showing the same fighter act on their own.
 */
export function drawFighterPortrait(ctx: CanvasRenderingContext2D, def: FighterDef, key: string, b: PortraitBounds, mood: PortraitMood = {}): void {
  const sp = def.sprite;
  if (!sp) throw new Error(`${def.id} has no sprite`);
  const p = puppetAt(`${key}:${def.id}`, mood);
  const t = now();
  const cx = b.x + b.w / 2;
  if (pointer.present && Math.abs(pointer.x - cx) > 24) p.facing = pointer.x < cx ? -1 : 1;
  const over = hover(b.x, b.y, b.w, b.h);
  if (over && !p.hovered) p.act = { cell: "atk-fwd", at: t, len: 0.35, kind: "swing" };
  p.hovered = over;
  if (mood.picked && !p.picked) p.act = { cell: "atk-up", at: t, len: 0.7, kind: "cheer" };
  p.picked = !!mood.picked;
  if (p.act && t - p.act.at > p.act.len) p.act = null;
  if (!p.act && mood.fidget && t >= p.nextFidget) {
    const f = mood.ready ? FIDGETS[0] : FIDGETS[Math.floor(hash(`${key}${Math.floor(t)}`) * FIDGETS.length)];
    p.act = { ...f, at: t };
    p.nextFidget = t + (mood.ready ? 1.2 : 8 + hash(`${key}:${Math.floor(t * 7)}`) * 12);
  }

  const h = def.stats.height;
  const breath = 0.5 - 0.5 * Math.cos(t * Math.PI * 2 * (mood.ready ? 2 : 0.8));
  const pose: Pose = { sy: 1 - breath * (mood.ready ? 0.06 : 0.03), sx: 1 + breath * (mood.ready ? 0.03 : 0.01) };
  let cell: string = cellForAnim(def, "idle");
  if (p.act) {
    const k = (t - p.act.at) / p.act.len, arc = Math.sin(Math.PI * k);
    cell = sp.cells[p.act.cell] ? p.act.cell : cell;
    if (p.act.kind === "cheer") { pose.dy = -arc * h * 0.22; pose.sy = 1 + arc * 0.08; pose.sx = 1 - arc * 0.05; }
    if (p.act.kind === "hop") pose.dy = -arc * h * 0.12;
    if (p.act.kind === "swing") { pose.dx = arc * h * 0.08; pose.rot = arc * 8; }
    if (p.act.kind === "step") pose.dx = arc * h * 0.06;
    if (p.act.kind === "crouch") { pose.sy = 1 - arc * 0.1; pose.sx = 1 + arc * 0.06; }
  }

  const u = h / sp.heightPx;
  const side = sp.px * u;
  const k = Math.min(b.w, b.h) / side;
  ctx.save();
  ctx.translate(cx, b.y + (b.h - Math.min(b.w, b.h)) / 2 + sp.feetPx * u * k);
  ctx.scale(k, k);
  if (pose.dx) pose.dx *= p.facing;
  if (pose.rot) pose.rot *= p.facing;
  drawSprite(ctx, def, cell, pose, { flip: p.facing < 0 });
  ctx.restore();
}
