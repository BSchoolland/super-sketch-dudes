import { hatch, inkArc, inkLine, inkPath, inkRect, INK, PAPER, PENCIL } from "./paper";
import type { Bone, Fighter, FighterDef, Pose, PoseKey } from "../../../shared/types";
import { currentMove } from "../../../shared/fighter";

export interface Seg { x1: number; y1: number; x2: number; y2: number; thick: number; color: string; z: number; shape: Bone["shape"]; size?: number | [number, number]; name: string }
export interface ResolvedPose { segs: Seg[]; sx: number; sy: number; dx: number; dy: number }

const DEG = Math.PI / 180;

function ease(t: number): number { return t * t * (3 - 2 * t); }

function lerpPose(a: Pose, b: Pose, t: number): Pose {
  const out: Pose = { a: {}, dx: (a.dx ?? 0) + ((b.dx ?? 0) - (a.dx ?? 0)) * t, dy: (a.dy ?? 0) + ((b.dy ?? 0) - (a.dy ?? 0)) * t, sx: (a.sx ?? 1) + ((b.sx ?? 1) - (a.sx ?? 1)) * t, sy: (a.sy ?? 1) + ((b.sy ?? 1) - (a.sy ?? 1)) * t };
  const names = new Set([...Object.keys(a.a ?? {}), ...Object.keys(b.a ?? {})]);
  for (const n of names) out.a![n] = (a.a?.[n] ?? 0) + ((b.a?.[n] ?? 0) - (a.a?.[n] ?? 0)) * t;
  return out;
}

export function poseAt(keys: PoseKey[], frame: number, loop?: number): Pose {
  if (!keys.length) return {};
  if (loop) frame = ((frame % loop) + loop) % loop;
  if (frame <= keys[0].frame) return keys[0].pose;
  for (let i = 0; i < keys.length - 1; i++) {
    const k0 = keys[i], k1 = keys[i + 1];
    if (frame >= k0.frame && frame < k1.frame) {
      if (k1.snap) return k0.pose;
      const t = (frame - k0.frame) / (k1.frame - k0.frame);
      return lerpPose(k0.pose, k1.pose, ease(t));
    }
  }
  return keys[keys.length - 1].pose;
}

/** Which named animation (and frame) a fighter is showing, from its sim state. */
export function animFor(f: Fighter, def: FighterDef): { keys: PoseKey[]; frame: number; loop?: number } {
  const anims = def.rig.anims;
  const pick = (name: string, frame = f.frame): { keys: PoseKey[]; frame: number; loop?: number } => ({ keys: anims[name] ?? anims.idle ?? [], frame, loop: def.rig.loops[name] });
  switch (f.action) {
    case "attack": {
      const mv = currentMove(f);
      return mv ? { keys: mv.poses, frame: f.frame } : pick("idle");
    }
    case "smashCharge": {
      const mv = f.move ? def.moves[f.move] : null;
      return mv ? { keys: mv.poses.slice(0, 1), frame: 0 } : pick("idle");
    }
    case "idle": return pick("idle");
    case "walk": return pick("walk");
    case "dash": return pick("dash");
    case "run": return pick("run");
    case "runTurn": return pick("skid");
    case "skid": return pick("skid");
    case "crouch": case "crouchStart": return pick("crouch");
    case "jumpSquat": return pick("jumpSquat");
    case "air": return f.vy < 0 ? pick("jump") : pick("fall", f.vy * 2);
    case "land": return pick("land", f.frame + 4);
    case "helpless": return pick("helpless");
    case "shield": case "shieldDrop": case "shieldStun": case "parry": return pick("shield");
    case "shieldBreak": return pick("hitstun");
    case "spotDodge": return pick("spotDodge");
    case "roll": case "getupRoll": case "techRoll": case "ledgeRoll": return pick("roll");
    case "airDodge": return pick("airDodge");
    case "hitstun": return pick("hitstun");
    case "tumble": case "thrown": return pick("tumble");
    case "knockdown": return pick("knockdown");
    case "getup": case "tech": case "wallTech": return pick("land");
    case "ledgeGrab": case "ledgeHang": case "ledgeClimb": case "ledgeJump": return pick("ledgeHang");
    case "grabHold": return pick("grabHold");
    case "grabbed": return pick("grabbed");
    case "respawn": return pick("respawn");
    case "taunt": return pick("taunt");
    case "dead": return pick("dead");
    default: return pick("idle");
  }
}

/** Forward kinematics in fighter space (+x facing, +y down, origin at the feet). */
export function resolvePose(def: FighterDef, pose: Pose): ResolvedPose {
  const bones = def.rig.bones;
  const joints = new Map<string, { x: number; y: number; ang: number; len: number }>();
  const segs: Seg[] = [];
  for (const b of bones) {
    let jx = 0, jy = 0, pang = 0;
    if (b.parent) {
      const p = joints.get(b.parent);
      if (!p) throw new Error(`bone ${b.name} before parent ${b.parent}`);
      const at = b.at ?? 0;
      jx = p.x + Math.sin(p.ang * DEG) * p.len * at;
      jy = p.y + Math.cos(p.ang * DEG) * p.len * at;
      pang = p.ang;
    }
    const ang = pang + b.rest + (pose.a?.[b.name] ?? 0);
    const ex = jx + Math.sin(ang * DEG) * b.len;
    const ey = jy + Math.cos(ang * DEG) * b.len;
    joints.set(b.name, { x: jx, y: jy, ang, len: b.len });
    if (b.thick > 0 || b.shape === "circle" || b.shape === "slab") segs.push({ x1: jx, y1: jy, x2: ex, y2: ey, thick: b.thick, color: b.color, z: b.z ?? 0, shape: b.shape ?? "capsule", size: b.size, name: b.name });
  }
  segs.sort((a, b) => a.z - b.z);
  return { segs, sx: pose.sx ?? 1, sy: pose.sy ?? 1, dx: pose.dx ?? 0, dy: pose.dy ?? 0 };
}

export function tintColors(def: FighterDef, slot: number, accents: string[]): Record<string, string> {
  const c = { ...def.palette.colors };
  if (accents[slot]) { c[def.palette.accent] = accents[slot]; c.marker = accents[slot]; }
  return c;
}

export function drawRig(ctx: CanvasRenderingContext2D, rp: ResolvedPose, colors: Record<string, string>, _outline: string, opts: { alpha?: number; flash?: string; outlineWidth?: number } = {}): void {
  ctx.save();
  if (opts.alpha !== undefined) ctx.globalAlpha *= opts.alpha;
  ctx.scale(rp.sx, rp.sy); ctx.translate(rp.dx, rp.dy);
  const ghost = opts.outlineWidth === 0;
  const brick = rp.segs.some((s) => s.name === "slab1");
  const wick = rp.segs.some((s) => s.name === "body");
  const pilot = rp.segs.some((s) => s.name === "nose");
  const marker = ghost ? PENCIL : opts.flash ?? colors.marker ?? (brick ? colors.brick : wick ? colors.flame : pilot ? colors.cyan : colors.coat);
  const line = ghost ? PENCIL : INK;
  for (const [i, s] of rp.segs.entries()) {
    const x = (s.x1 + s.x2) / 2, y = (s.y1 + s.y2) / 2;
    const dx = s.x2 - s.x1, dy = s.y2 - s.y1, len = Math.hypot(dx, dy) || 1;
    if (s.name === "inner" || s.name === "visor" || s.name === "collar") continue;
    if (s.shape === "circle" && s.size === 0) continue;
    ctx.save();
    if (brick && (s.name === "legB" || s.name === "legF")) {
      const offset = s.name === "legB" ? -12 : 12;
      inkLine(ctx, s.x1 + offset, s.y1, s.x2 + offset, s.y2, line, 2.3, i, true);
      inkLine(ctx, s.x2 + offset, s.y2, s.x2 + offset + 6, s.y2, line, 2);
    } else if (s.name.startsWith("eye")) {
      ctx.fillStyle = line; ctx.beginPath(); ctx.arc(x, y, 2.3, 0, Math.PI * 2); ctx.fill();
    } else if (s.name.startsWith("fist") || s.shape === "slab") {
      const size = Array.isArray(s.size) ? s.size : [22, 20];
      ctx.translate(x, y); ctx.rotate(-Math.atan2(dx, dy));
      ctx.fillStyle = PAPER; ctx.fillRect(-size[0] / 2, -size[1] / 2, size[0], size[1]);
      if (s.name.startsWith("slab")) hatch(ctx, -size[0] / 2, -size[1] / 2, size[0], size[1], marker);
      inkRect(ctx, -size[0] / 2, -size[1] / 2, size[0], size[1], line, 2.3);
    } else if (s.shape === "circle") {
      const r = typeof s.size === "number" ? s.size : s.thick;
      ctx.fillStyle = PAPER; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      inkArc(ctx, x, y, r, 0, Math.PI * 2, line, 2.3, i);
    } else if (s.shape === "flame") {
      ctx.translate(s.x1, s.y1); ctx.rotate(-Math.atan2(dx, dy));
      const w = s.thick;
      ctx.beginPath(); ctx.moveTo(0, len);
      ctx.bezierCurveTo(-w * 0.2, len * 0.6, -w * 1.25, len * 0.35, -w * 0.75, 3);
      ctx.bezierCurveTo(-w * 0.5, -10, w * 0.65, -9, w * 0.9, 4);
      ctx.bezierCurveTo(w * 1.15, len * 0.3, w * 0.3, len * 0.65, 0, len); ctx.closePath();
      ctx.fillStyle = ghost ? PAPER : marker; ctx.fill();
      ctx.strokeStyle = line; ctx.lineWidth = 2.3; ctx.stroke();
      ctx.save(); ctx.clip(); ctx.globalAlpha *= 0.45;
      for (let j = 0; j < 6; j++) {
        inkLine(ctx, -w + j * 3, 0, w - j * 2, len * 0.65 - j * 4, line, 0.8, j * 47, true);
      }
      ctx.restore();
    } else if (s.name === "nose" || s.name === "chest" || s.name.startsWith("coat") || (!pilot && !brick && !wick && s.name === "torso")) {
      const nx = -dy / len, ny = dx / len, w = s.name === "nose" ? 9 : s.thick * 0.7;
      inkPath(ctx, [[s.x1 + nx * w, s.y1 + ny * w], [s.x2, s.y2], [s.x1 - nx * w, s.y1 - ny * w]], true, i, true);
      ctx.fillStyle = s.name === "nose" || ghost ? PAPER : marker; ctx.fill();
      ctx.strokeStyle = line; ctx.lineWidth = 2.3; ctx.stroke();
    } else {
      inkLine(ctx, s.x1, s.y1, s.x2, s.y2, line, 2.3, i * 23, true);
      if (s.name.startsWith("nacelle")) {
        for (let j = -1; j <= 1; j++) inkLine(ctx, s.x2 + j * 5, s.y2 + 3, s.x2 + j * 6 - dx / len * 15, s.y2 + dy / len * 15, line, 1.2, i + j, true);
      }
      if (s.shape === "blade") inkLine(ctx, s.x1 - dy / len * 6, s.y1 + dx / len * 6, s.x1 + dy / len * 6, s.y1 - dx / len * 6, line, 2);
    }
    ctx.restore();
  }
  ctx.restore();
}
