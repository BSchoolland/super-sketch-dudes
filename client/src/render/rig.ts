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
    if (b.thick > 0 || b.shape === "circle") segs.push({ x1: jx, y1: jy, x2: ex, y2: ey, thick: b.thick, color: b.color, z: b.z ?? 0, shape: b.shape ?? "capsule", size: b.size, name: b.name });
  }
  segs.sort((a, b) => a.z - b.z);
  return { segs, sx: pose.sx ?? 1, sy: pose.sy ?? 1, dx: pose.dx ?? 0, dy: pose.dy ?? 0 };
}

export function tintColors(def: FighterDef, slot: number, accents: string[]): Record<string, string> {
  const c = { ...def.palette.colors };
  if (accents[slot]) c[def.palette.accent] = accents[slot];
  return c;
}

function drawSeg(ctx: CanvasRenderingContext2D, s: Seg, color: string, widen: number): void {
  if (s.shape === "circle") {
    const r = (typeof s.size === "number" ? s.size : s.thick) + widen;
    if (r <= 0) return;
    const cx = (s.x1 + s.x2) / 2, cy = (s.y1 + s.y2) / 2;
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    return;
  }
  if (s.shape === "blade") {
    const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const w = s.thick + widen;
    const guard = 5 + widen;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(s.x1 + nx * guard, s.y1 + ny * guard);
    ctx.lineTo(s.x1 - nx * guard, s.y1 - ny * guard);
    ctx.lineTo(s.x1 - nx * w + dx * 0.08, s.y1 - ny * w + dy * 0.08);
    ctx.lineTo(s.x2 - nx * 0.4, s.y2 - ny * 0.4);
    ctx.lineTo(s.x2 + nx * 0.4, s.y2 + ny * 0.4);
    ctx.lineTo(s.x1 + nx * w + dx * 0.08, s.y1 + ny * w + dy * 0.08);
    ctx.closePath(); ctx.fill();
    return;
  }
  if (s.shape === "slab") {
    const [w, h] = Array.isArray(s.size) ? s.size : [s.thick * 2, s.thick * 2];
    const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
    const ang = Math.atan2(dy, dx);
    ctx.save();
    ctx.translate(s.x1, s.y1);
    ctx.rotate(ang);
    ctx.fillStyle = color;
    const r = 4;
    const W = h + widen * 2, H = w + widen * 2;
    ctx.beginPath();
    ctx.roundRect(-widen, -H / 2, Math.max(1, Math.hypot(dx, dy) + widen * 2), H, r);
    void W;
    ctx.fill();
    ctx.restore();
    return;
  }
  if (s.shape === "flame") {
    // a teardrop along the bone: round at the joint, pointed at the tip, with a wobble
    const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const w = s.thick + widen;
    const t = performance.now() / 90;
    const wob = Math.sin(t + s.x1 * 0.1) * w * 0.25;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(s.x2 + nx * wob, s.y2 + ny * wob);
    ctx.bezierCurveTo(s.x2 + nx * w * 0.6 + dx * -0.35, s.y2 + ny * w * 0.6 + dy * -0.35, s.x1 + nx * w * 1.05, s.y1 + ny * w * 1.05, s.x1 + nx * w * 0.2 - dx * 0.16, s.y1 + ny * w * 0.2 - dy * 0.16);
    ctx.bezierCurveTo(s.x1 - nx * w * 0.2 - dx * 0.16, s.y1 - ny * w * 0.2 - dy * 0.16, s.x1 - nx * w * 1.05, s.y1 - ny * w * 1.05, s.x2 - nx * w * 0.6 + dx * -0.35, s.y2 - ny * w * 0.6 + dy * -0.35);
    ctx.closePath(); ctx.fill();
    return;
  }
  // capsule
  ctx.strokeStyle = color;
  ctx.lineCap = "round";
  ctx.lineWidth = (s.thick + widen) * 2;
  ctx.beginPath(); ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); ctx.stroke();
}

/** Draw a resolved pose at the current transform (origin at the feet, +x already facing). */
export function drawRig(ctx: CanvasRenderingContext2D, rp: ResolvedPose, colors: Record<string, string>, outline: string, opts: { alpha?: number; flash?: string; outlineWidth?: number } = {}): void {
  ctx.save();
  if (opts.alpha !== undefined) ctx.globalAlpha = opts.alpha;
  ctx.scale(rp.sx, rp.sy);
  ctx.translate(rp.dx, rp.dy);
  const ow = opts.outlineWidth ?? 3;
  for (const s of rp.segs) drawSeg(ctx, s, outline, ow);
  for (const s of rp.segs) drawSeg(ctx, s, opts.flash ?? (colors[s.color] ?? s.color), 0);
  ctx.restore();
}
