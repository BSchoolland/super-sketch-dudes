import type { Fighter, FighterDef, Pose, PoseKey } from "../../../shared/types";
import { currentMove } from "../../../shared/fighter";

function ease(t: number): number { return t * t * (3 - 2 * t); }

function lerpPose(a: Pose, b: Pose, t: number): Pose {
  const mix = (x: number, y: number) => x + (y - x) * t;
  return { dx: mix(a.dx ?? 0, b.dx ?? 0), dy: mix(a.dy ?? 0, b.dy ?? 0), sx: mix(a.sx ?? 1, b.sx ?? 1), sy: mix(a.sy ?? 1, b.sy ?? 1), rot: mix(a.rot ?? 0, b.rot ?? 0) };
}

/** The pose a track shows on `frame`, eased between keys; `loop` wraps cyclic tracks. */
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
export interface AnimPick { keys: PoseKey[]; frame: number; loop?: number; /** animation (or move) name */ name: string }
export function animFor(f: Fighter, def: FighterDef): AnimPick {
  const anims = def.rig.anims;
  const pick = (name: string, frame = f.frame): AnimPick => ({ keys: anims[name] ?? anims.idle ?? [], frame, loop: def.rig.loops[name], name });
  switch (f.action) {
    case "attack": {
      const mv = currentMove(f);
      return mv ? { keys: mv.poses, frame: f.frame, name: mv.id } : pick("idle");
    }
    case "smashCharge": {
      const mv = f.move ? def.moves[f.move] : null;
      return mv ? { keys: mv.poses.slice(0, 1), frame: 0, name: mv.id } : pick("idle");
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

// Leftovers for the bone branch in client/src/screens (title, sheet, portrait), which only runs for a
// fighter without a sprite. Delete once the screens stop importing them.
/** @deprecated every fighter is a sprite */
export const resolvePose = (_def: FighterDef, pose: Pose): Pose => pose;
/** @deprecated every fighter is a sprite */
export function drawRig(..._args: unknown[]): never { throw new Error("drawRig: bone fighters are gone, every fighter has a sprite"); }
/** @deprecated every fighter is a sprite */
export function tintColors(..._args: unknown[]): never { throw new Error("tintColors: bone fighters are gone, every fighter has a sprite"); }
