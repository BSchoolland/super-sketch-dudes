import type { Hitbox, Move, PoseKey, Pose } from "../types";

type HbExtra = Partial<Omit<Hitbox, "frames" | "x" | "y" | "r" | "damage" | "angle" | "base" | "growth">>;

/** hb([start,end], x, y, r, damage, angle, base, growth, extra) */
export function hb(frames: [number, number], x: number, y: number, r: number, damage: number, angle: number, base: number, growth: number, extra: HbExtra = {}): Hitbox {
  return { frames, x, y, r, damage, angle, base, growth, ...extra };
}
/** A capsule hitbox from (x,y) to (x2,y2). */
export function cap(frames: [number, number], x: number, y: number, x2: number, y2: number, r: number, damage: number, angle: number, base: number, growth: number, extra: HbExtra = {}): Hitbox {
  return { frames, x, y, x2, y2, r, damage, angle, base, growth, ...extra };
}
export function key(frame: number, pose: Pose, snap = false): PoseKey {
  return snap ? { frame, pose, snap } : { frame, pose };
}
export function mv(id: string, total: number, hitboxes: Hitbox[], poses: PoseKey[], extra: Partial<Move> = {}): Move {
  return { id, total, hitboxes, poses, ...extra };
}
/** Throw moves: one pseudo-hitbox carries the throw's damage and knockback. */
export function throwMove(id: string, total: number, throwFrame: number, damage: number, angle: number, base: number, growth: number, poses: PoseKey[]): Move {
  return { id, total, throwFrame, hitboxes: [hb([0, 0], 0, 0, 0, damage, angle, base, growth)], poses };
}
