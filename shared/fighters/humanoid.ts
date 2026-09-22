import type { Bone, PoseKey } from "../types";
import { key } from "./helpers";

/**
 * A standard two-arm two-leg rig. Angles are degrees relative to the parent bone;
 * 0 continues the parent, positive turns toward the fighter's facing. World angle 0 points
 * down, 180 up, 90 forward. The hip is an invisible root bone from the feet up to the hip.
 */
export interface HumanoidSpec {
  hipHeight: number;
  torso: number;
  head: number;
  upperArm: number;
  foreArm: number;
  thigh: number;
  shin: number;
  thick: number;
  colors: { torso: string; head: string; arms: string; legs: string };
  weapon?: { len: number; thick: number; color: string; shape?: Bone["shape"] };
  /** Extra bones appended after the standard set (coats, hats, boots, tails). */
  extras?: Bone[];
}

export function humanoidBones(s: HumanoidSpec): Bone[] {
  const bones: Bone[] = [
    { name: "hip", parent: null, len: s.hipHeight, thick: 0, rest: 180, color: s.colors.torso, shape: "circle", size: 0, z: 0 },
    { name: "legB", parent: "hip", len: s.thigh, thick: s.thick, rest: 172, at: 1, color: s.colors.legs, z: 1 },
    { name: "legB2", parent: "legB", len: s.shin, thick: s.thick * 0.9, rest: 6, color: s.colors.legs, z: 1 },
    { name: "torso", parent: "hip", len: s.torso, thick: s.thick * 1.6, rest: 0, at: 1, color: s.colors.torso, z: 3 },
    { name: "armB", parent: "torso", len: s.upperArm, thick: s.thick * 0.85, rest: 172, at: 0.92, color: s.colors.arms, z: 2 },
    { name: "armB2", parent: "armB", len: s.foreArm, thick: s.thick * 0.8, rest: -12, color: s.colors.arms, z: 2 },
    { name: "head", parent: "torso", len: s.head * 2, thick: s.head, rest: 0, at: 1, color: s.colors.head, shape: "circle", size: s.head, z: 5 },
    { name: "legF", parent: "hip", len: s.thigh, thick: s.thick, rest: 188, at: 1, color: s.colors.legs, z: 4 },
    { name: "legF2", parent: "legF", len: s.shin, thick: s.thick * 0.9, rest: -6, color: s.colors.legs, z: 4 },
    { name: "armF", parent: "torso", len: s.upperArm, thick: s.thick * 0.85, rest: 188, at: 0.92, color: s.colors.arms, z: 6 },
    { name: "armF2", parent: "armF", len: s.foreArm, thick: s.thick * 0.8, rest: 12, color: s.colors.arms, z: 6 },
  ];
  if (s.weapon) bones.push({ name: "weapon", parent: "armF2", len: s.weapon.len, thick: s.weapon.thick, rest: 0, at: 1, color: s.weapon.color, shape: s.weapon.shape ?? "blade", z: 7 });
  if (s.extras) bones.push(...s.extras);
  return bones;
}

/** Generic locomotion animations for a humanoid; fighters override what they want. */
export function humanoidAnims(): Record<string, PoseKey[]> {
  return {
    idle: [
      key(0, { a: { torso: 0, armF: -6, armF2: -10, armB: 6, armB2: -10 }, dy: 0 }),
      key(30, { a: { torso: 2, armF: -8, armF2: -14, armB: 8, armB2: -14 }, dy: 2 }),
      key(60, { a: { torso: 0, armF: -6, armF2: -10, armB: 6, armB2: -10 }, dy: 0 }),
    ],
    walk: [
      key(0, { a: { legF: 30, legF2: -10, legB: -25, legB2: 30, armF: -20, armB: 20, torso: 4 } }),
      key(12, { a: { legF: -25, legF2: 30, legB: 30, legB2: -10, armF: 20, armB: -20, torso: 4 } }),
      key(24, { a: { legF: 30, legF2: -10, legB: -25, legB2: 30, armF: -20, armB: 20, torso: 4 } }),
    ],
    run: [
      key(0, { a: { legF: 55, legF2: -30, legB: -45, legB2: 70, armF: -50, armF2: -60, armB: 45, armB2: -60, torso: 18 }, dy: 0 }),
      key(4, { a: { legF: 10, legF2: 10, legB: 0, legB2: 40, armF: -10, armF2: -60, armB: 10, armB2: -60, torso: 18 }, dy: -6 }),
      key(8, { a: { legF: -45, legF2: 70, legB: 55, legB2: -30, armF: 45, armF2: -60, armB: -50, armB2: -60, torso: 18 }, dy: 0 }),
      key(12, { a: { legF: 0, legF2: 40, legB: 10, legB2: 10, armF: 10, armF2: -60, armB: -10, armB2: -60, torso: 18 }, dy: -6 }),
      key(16, { a: { legF: 55, legF2: -30, legB: -45, legB2: 70, armF: -50, armF2: -60, armB: 45, armB2: -60, torso: 18 }, dy: 0 }),
    ],
    dash: [
      key(0, { a: { legF: 40, legF2: -20, legB: -50, legB2: 60, armF: -40, armB: 40, torso: 26 }, sx: 1.08, sy: 0.92 }),
      key(6, { a: { legF: -30, legF2: 50, legB: 40, legB2: -20, armF: 30, armB: -40, torso: 24 }, sx: 1.0, sy: 1.0 }),
    ],
    skid: [key(0, { a: { legF: -30, legF2: 10, legB: 20, legB2: 0, torso: -14, armF: 30, armB: 30 } })],
    crouch: [key(0, { a: { legF: 70, legF2: -110, legB: -60, legB2: 110, torso: 25, armF: 30, armB: -30 }, dy: 26 })],
    jumpSquat: [key(0, { a: { legF: 40, legF2: -70, legB: -40, legB2: 70, torso: 10 }, dy: 14, sx: 1.1, sy: 0.9 })],
    jump: [
      key(0, { a: { legF: 30, legF2: -50, legB: -20, legB2: 40, armF: -60, armB: 60, torso: -4 }, sx: 0.9, sy: 1.12 }),
      key(10, { a: { legF: 15, legF2: -30, legB: -10, legB2: 30, armF: -40, armB: 40, torso: 0 }, sx: 1, sy: 1 }),
    ],
    fall: [key(0, { a: { legF: 10, legF2: -20, legB: -20, legB2: 40, armF: -50, armF2: -40, armB: 50, armB2: -40, torso: 6 } })],
    land: [key(0, { a: { legF: 35, legF2: -60, legB: -35, legB2: 60, torso: 12 }, dy: 12, sx: 1.12, sy: 0.88 }), key(4, { a: {}, dy: 0, sx: 1, sy: 1 })],
    helpless: [key(0, { a: { legF: 20, legF2: 20, legB: -20, legB2: 20, armF: -120, armB: 120, torso: -10 } }), key(20, { a: { legF: 20, legF2: 20, legB: -20, legB2: 20, armF: -100, armB: 100, torso: 10 } }), key(40, { a: { legF: 20, legF2: 20, legB: -20, legB2: 20, armF: -120, armB: 120, torso: -10 } })],
    shield: [key(0, { a: { legF: 20, legF2: -30, legB: -20, legB2: 30, torso: 8, armF: 60, armF2: 80, armB: 40, armB2: 80 }, dy: 6 })],
    hitstun: [key(0, { a: { torso: -30, head: -20, armF: -60, armB: 60, legF: 30, legB: -20 }, sx: 1.05 })],
    tumble: [key(0, { a: { torso: -60, head: -30, armF: -120, armB: 120, legF: 60, legF2: -40, legB: -40, legB2: 60 } }), key(12, { a: { torso: -160, head: -30, armF: -120, armB: 120, legF: 60, legF2: -40, legB: -40, legB2: 60 } }), key(24, { a: { torso: -280, head: -30, armF: -120, armB: 120, legF: 60, legF2: -40, legB: -40, legB2: 60 } }), key(36, { a: { torso: -420, head: -30, armF: -120, armB: 120, legF: 60, legF2: -40, legB: -40, legB2: 60 } })],
    knockdown: [key(0, { a: { torso: -85, head: 10, armF: -40, armB: -40, legF: 20, legB: -10 }, dy: 40 })],
    ledgeHang: [key(0, { a: { torso: -10, armF: 190, armF2: -20, armB: 180, armB2: -10, legF: 20, legF2: -30, legB: 10, legB2: -20 } })],
    grabHold: [key(0, { a: { torso: 6, armF: 100, armF2: -10, armB: 90, armB2: -20, legF: 20, legB: -20 } })],
    grabbed: [key(0, { a: { torso: -8, armF: -30, armB: 30, legF: 20, legF2: -20, legB: -20, legB2: 20 } })],
    dead: [key(0, { a: {} })],
    taunt: [key(0, { a: { armF: 120, armF2: 40, torso: -6 } }), key(20, { a: { armF: 160, armF2: 20, torso: -10 } }), key(40, { a: { armF: 120, armF2: 40, torso: -6 } })],
    respawn: [key(0, { a: { armF: -20, armB: 20 } })],
    spotDodge: [key(0, { a: { legF: 50, legF2: -80, legB: -50, legB2: 80, torso: 30 }, dy: 20, sx: 0.85 })],
    roll: [key(0, { a: { torso: 40, legF: 60, legF2: -90, legB: -50, legB2: 90 }, dy: 20 }), key(16, { a: { torso: 400, legF: 60, legF2: -90, legB: -50, legB2: 90 }, dy: 20 }), key(32, { a: { torso: 720 }, dy: 0 })],
    airDodge: [key(0, { a: { torso: 20, legF: 40, legF2: -60, legB: -30, legB2: 60, armF: 40, armB: -40 }, sx: 0.85, sy: 0.85 }), key(30, { a: {}, sx: 1, sy: 1 })],
  };
}
export const humanoidLoops: Record<string, number> = { idle: 60, walk: 24, run: 16, helpless: 40 };
