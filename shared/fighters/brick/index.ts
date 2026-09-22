import type { Bone, FighterDef, Move, PoseKey, Stats } from "../../types";
import { cap, hb, key, mv, throwMove } from "../helpers";
import { setAction } from "../../fighter";
import { spawnProjectile } from "../../hits";
import { STICK_DEAD } from "../../input";
import { sign } from "../../fixed";

const stats: Stats = {
  weight: 125, walk: 3.2, run: 6.0, dashInit: 6.8, airSpeed: 3.4, airAccel: 0.14,
  fallSpeed: 9.5, fastFall: 14, gravity: 0.58, shortHop: 9, fullHop: 15, doubleJump: 14,
  jumps: 2, wallJump: false, traction: 0.7, height: 130, width: 78, crouchHeight: 100, landLag: 5, ledgeReach: 36,
};

// Rig: a stack of three slabs on two stubby legs, piston arms hung from invisible shoulder bones.
// Slab bones point up; the slab shape draws a rect `len` tall and size[0] wide.
const bones: Bone[] = [
  { name: "base", parent: null, len: 22, thick: 0, rest: 180, color: "tar", shape: "circle", size: 0, z: 0 },
  { name: "legB", parent: "base", len: 22, thick: 11, rest: 176, at: 1, color: "tar", z: 1 },
  { name: "legF", parent: "base", len: 22, thick: 11, rest: 184, at: 1, color: "tar", z: 4 },
  { name: "slab1", parent: "base", len: 34, thick: 1, rest: 0, at: 1, color: "brick", shape: "slab", size: [96, 34], z: 3 },
  { name: "slab2", parent: "slab1", len: 32, thick: 1, rest: 0, at: 1, color: "brickLight", shape: "slab", size: [84, 32], z: 3.1 },
  { name: "slab3", parent: "slab2", len: 28, thick: 1, rest: 0, at: 1, color: "brick", shape: "slab", size: [72, 28], z: 3.2 },
  { name: "head", parent: "slab3", len: 16, thick: 1, rest: 0, at: 1, color: "mortar", shape: "slab", size: [30, 16], z: 3.3 },
  { name: "eye", parent: "head", len: 2, thick: 0, rest: 90, at: 0.5, color: "tar", shape: "circle", size: 3.5, z: 3.4 },
  { name: "rebar", parent: "slab3", len: 26, thick: 2.5, rest: -150, at: 0.9, color: "steel", z: 2.9 },
  { name: "shB", parent: "slab2", len: 44, thick: 0, rest: -90, at: 0.6, color: "tar", shape: "circle", size: 0, z: 2 },
  { name: "armB", parent: "shB", len: 30, thick: 10, rest: -90, at: 1, color: "tar", z: 2 },
  { name: "armB2", parent: "armB", len: 26, thick: 9, rest: 0, at: 1, color: "brickLight", z: 2 },
  { name: "fistB", parent: "armB2", len: 4, thick: 0, rest: 0, at: 1, color: "tar", shape: "circle", size: 13, z: 2.1 },
  { name: "shF", parent: "slab2", len: 44, thick: 0, rest: 90, at: 0.6, color: "tar", shape: "circle", size: 0, z: 5 },
  { name: "armF", parent: "shF", len: 30, thick: 10, rest: 90, at: 1, color: "tar", z: 5 },
  { name: "armF2", parent: "armF", len: 26, thick: 9, rest: 0, at: 1, color: "brickLight", z: 5 },
  { name: "fistF", parent: "armF2", len: 4, thick: 0, rest: 0, at: 1, color: "tar", shape: "circle", size: 13, z: 5.1 },
];

const rest = { a: {} };
const P = (a: Record<string, number>, extra: { dx?: number; dy?: number; sx?: number; sy?: number } = {}) => ({ a, ...extra });
const idleA = { armF: 0, armB: 0, slab2: 0, slab3: 0 };
const anims: Record<string, PoseKey[]> = {
  idle: [key(0, P({ ...idleA })), key(40, P({ ...idleA, slab2: 2, slab3: -3, armF: 4, armB: -4 }, { dy: 3 })), key(80, P({ ...idleA }))],
  walk: [key(0, P({ legF: 25, legB: -25, slab2: 3, slab3: -3, armF: 15, armB: -15 })), key(14, P({ legF: -25, legB: 25, slab2: -3, slab3: 3, armF: -15, armB: 15 })), key(28, P({ legF: 25, legB: -25, slab2: 3, slab3: -3, armF: 15, armB: -15 }))],
  run: [key(0, P({ legF: 40, legB: -40, slab1: 14, slab2: 4, slab3: 4, armF: 40, armB: -40 })), key(9, P({ legF: -40, legB: 40, slab1: 14, slab2: -4, slab3: -4, armF: -40, armB: 40 })), key(18, P({ legF: 40, legB: -40, slab1: 14, slab2: 4, slab3: 4, armF: 40, armB: -40 }))],
  dash: [key(0, P({ legF: 40, legB: -30, slab1: 22, slab2: 6, slab3: 6, armF: 50, armB: -50 }, { sx: 1.1, sy: 0.9 })), key(8, P({ legF: -20, legB: 30, slab1: 18, armF: 30, armB: -30 }, { sx: 1, sy: 1 }))],
  skid: [key(0, P({ legF: -20, legB: 20, slab1: -10, slab2: -6, slab3: -6, armF: 60, armB: 60 }))],
  crouch: [key(0, P({ legF: 40, legB: -40, slab1: 6, slab2: -6 }, { dy: 24, sx: 1.15, sy: 0.82 }))],
  jumpSquat: [key(0, P({ legF: 30, legB: -30 }, { dy: 12, sx: 1.12, sy: 0.88 }))],
  jump: [key(0, P({ legF: 40, legB: -20, armF: -60, armB: 60, slab2: -3, slab3: -3 }, { sx: 0.92, sy: 1.1 })), key(12, P({ legF: 20, legB: -10, armF: -40, armB: 40 }, { sx: 1, sy: 1 }))],
  fall: [key(0, P({ legF: 10, legB: -10, armF: -100, armB: 100, slab3: 3 }))],
  land: [key(0, P({ legF: 40, legB: -40, slab1: 6, slab2: -8, slab3: 6 }, { dy: 14, sx: 1.18, sy: 0.82 })), key(5, rest)],
  helpless: [key(0, P({ armF: -150, armB: 150, slab1: 12, slab3: -10 })), key(20, P({ armF: -130, armB: 130, slab1: -12, slab3: 10 })), key(40, P({ armF: -150, armB: 150, slab1: 12, slab3: -10 }))],
  shield: [key(0, P({ armF: 100, armF2: -60, armB: 100, armB2: -60, legF: 10, legB: -10 }, { dy: 6 }))],
  hitstun: [key(0, P({ slab1: -14, slab2: -8, slab3: -8, head: -10, armF: -70, armB: 70, legF: 20 }, { sx: 1.06 }))],
  tumble: [key(0, P({ slab1: -60, armF: -120, armB: 120, legF: 40, legB: -40 })), key(14, P({ slab1: -200, armF: -120, armB: 120, legF: 40, legB: -40 })), key(28, P({ slab1: -340, armF: -120, armB: 120, legF: 40, legB: -40 })), key(42, P({ slab1: -480, armF: -120, armB: 120, legF: 40, legB: -40 }))],
  knockdown: [key(0, P({ slab1: -88, slab2: 4, slab3: 4, head: 6, armF: -40, armB: -40 }, { dy: 34 }))],
  ledgeHang: [key(0, P({ armF: 190, armF2: -30, armB: 180, armB2: -20, legF: 20, legB: 10, slab1: -8 }))],
  grabHold: [key(0, P({ armF: 100, armF2: -10, armB: 90, armB2: -10, slab1: 6 }))],
  grabbed: [key(0, P({ slab1: -6, armF: -30, armB: 30, legF: 20, legB: -20 }))],
  dead: [key(0, rest)],
  taunt: [key(0, P({ head: 0 })), key(15, P({ head: 25, slab3: -4 })), key(30, P({ head: -25, slab3: 4 })), key(45, P({ head: 0 }))],
  respawn: [key(0, P({ armF: -20, armB: 20 }))],
  spotDodge: [key(0, P({ legF: 40, legB: -40, slab1: 10 }, { dy: 20, sx: 1.1, sy: 0.8 }))],
  roll: [key(0, P({ slab1: 40, legF: 60, legB: -50 }, { dy: 20 })), key(16, P({ slab1: 400, legF: 60, legB: -50 }, { dy: 20 })), key(32, P({ slab1: 720 }))],
  airDodge: [key(0, P({ slab1: 20, legF: 40, legB: -30, armF: 40, armB: -40 }, { sx: 0.85, sy: 0.85 })), key(30, rest)],
};

const A = { fx: "heavy" as const };
const stack = (a: Record<string, number>, extra: { dx?: number; dy?: number; sx?: number; sy?: number } = {}) => P({ ...idleA, ...a }, extra);

const moves: Record<string, Move> = {
  jab1: mv("jab1", 26, [cap([7, 9], 40, -80, 96, -80, 16, 5, 60, 30, 60, { fx: "hit" })], [key(0, stack({ armF: 20, armF2: -40 })), key(6, stack({ armF: 90, armF2: 0, slab1: 8 }, { dx: 6 })), key(12, stack({ armF: 90, slab1: 8 }, { dx: 6 })), key(26, stack({}))], { iasa: 18, next: "jab2", nextFrom: 8 }),
  jab2: mv("jab2", 30, [cap([8, 10], 40, -84, 104, -84, 18, 8, 45, 40, 90, A)], [key(0, stack({ armB: 20, armB2: -40, armF: 60 })), key(7, stack({ armB: 95, armB2: 0, slab1: 12, armF: 30 }, { dx: 10 })), key(14, stack({ armB: 95, slab1: 12 }, { dx: 10 })), key(30, stack({}))]),
  ftilt: mv("ftilt", 38, [cap([12, 15], 40, -84, 116, -84, 18, 13, 40, 45, 85, A)], [key(0, stack({ armF: -20, armF2: -60, slab1: -6 }, { dx: -6 })), key(11, stack({ armF: 92, armF2: 0, slab1: 14, slab2: 4 }, { dx: 14 })), key(18, stack({ armF: 92, slab1: 14 }, { dx: 14 })), key(38, stack({}))], { armour: { frames: [1, 15], threshold: 6 } }),
  utilt: mv("utilt", 34, [cap([9, 13], -50, -170, 50, -170, 26, 11, 88, 40, 95, A)], [key(0, stack({ armF: 20, armB: -20, slab3: 6 }, { dy: 6 })), key(8, stack({ armF: 170, armB: -170, slab3: -8, head: 10 }, { dy: -4 })), key(14, stack({ armF: 170, armB: -170, slab3: -8 })), key(34, stack({}))]),
  dtilt: mv("dtilt", 28, [cap([8, 10], 20, -14, 100, -14, 16, 9, 25, 35, 70, { fx: "hit" })], [key(0, stack({ legF: 40, legB: -40, slab1: 12 }, { dy: 24, sy: 0.85, sx: 1.12 })), key(7, stack({ legF: 40, legB: -40, slab1: 30, armF: 120, armF2: 30 }, { dy: 26, sy: 0.85, sx: 1.12 })), key(12, stack({ legF: 40, legB: -40, slab1: 30, armF: 120, armF2: 30 }, { dy: 26, sy: 0.85, sx: 1.12 })), key(28, stack({}))]),
  dashAttack: mv("dashAttack", 46, [cap([14, 21], 10, -100, 70, -90, 30, 14, 55, 60, 70, A)], [key(0, stack({ slab1: 20, slab2: 10 })), key(13, stack({ slab1: 45, slab2: 12, slab3: 8, armF: -60, armB: -60 }, { dx: 20 })), key(22, stack({ slab1: 45, slab2: 12 }, { dx: 20 })), key(46, stack({}))], { motion: [[1, 8, 0], [14, 5, 0], [22, 1, 0]], armour: { frames: [8, 21], threshold: 6 } }),
  fsmash: mv("fsmash", 62, [cap([22, 26], 30, -60, 120, -30, 28, 22, 38, 50, 95, A)], [key(0, stack({ armF: 170, armF2: -20, armB: 170, armB2: -20, slab1: -12, slab3: -6 }, { dx: -8 })), key(20, stack({ armF: 40, armF2: 20, armB: 40, armB2: 20, slab1: 34, slab2: 8, slab3: 6 }, { dx: 16, dy: 8 })), key(30, stack({ armF: 40, armF2: 20, armB: 40, armB2: 20, slab1: 34 }, { dx: 16, dy: 8 })), key(62, stack({}))], { smash: true, armour: { frames: [1, 26], threshold: 12 } }),
  usmash: mv("usmash", 58, [cap([18, 23], -70, -180, 70, -180, 34, 20, 90, 45, 100, A)], [key(0, stack({ slab2: 0, slab3: 0 }, { dy: 10, sy: 0.9, sx: 1.08 })), key(17, stack({ slab2: 0, slab3: 0, armF: 60, armB: -60 }, { dy: -18, sy: 1.12, sx: 0.95 })), key(24, stack({ armF: 60, armB: -60 }, { dy: -14 })), key(58, stack({}))], { smash: true, armour: { frames: [1, 23], threshold: 12 } }),
  dsmash: mv("dsmash", 60, [
    cap([20, 23], 20, -20, 110, -20, 24, 17, 30, 50, 85, { ...A, group: 0 }),
    cap([26, 29], -20, -20, -110, -20, 24, 17, 30, 50, 85, { ...A, group: 1 }),
  ], [key(0, stack({ legF: 30, legB: -30 }, { dy: 10 })), key(19, stack({ legF: 70, legB: -20, slab1: 10 }, { dy: 20, sx: 1.15, sy: 0.85 })), key(25, stack({ legF: -20, legB: 70, slab1: -10 }, { dy: 20, sx: 1.15, sy: 0.85 })), key(60, stack({}))], { smash: true, armour: { frames: [1, 29], threshold: 12 } }),
  nair: mv("nair", 44, [cap([8, 27], -60, -70, 60, -70, 40, 12, 60, 35, 70, { ...A, group: 0 }), cap([16, 27], -60, -70, 60, -70, 40, 8, 60, 30, 60, { fx: "hit", group: 1, priority: 2 })], [key(0, stack({})), key(8, stack({ slab1: 90, slab2: 30, slab3: 30, armF: 90, armB: -90 })), key(27, stack({ slab1: 450, slab2: 30, slab3: 30, armF: 90, armB: -90 })), key(44, stack({ slab1: 720 }))], { aerial: true, landingLag: 12 }),
  fair: mv("fair", 50, [cap([16, 19], 30, -40, 90, -60, 26, 17, 45, 40, 95, A)], [key(0, stack({ armF: 170, armF2: -30, slab1: -10 })), key(15, stack({ armF: 60, armF2: 30, slab1: 30, slab2: 8 })), key(22, stack({ armF: 60, armF2: 30, slab1: 30 })), key(50, stack({}))], { aerial: true, landingLag: 22 }),
  bair: mv("bair", 42, [cap([12, 15], -40, -100, -120, -110, 20, 16, 35, 45, 90, A)], [key(0, stack({ rebar: 0, slab3: 10 })), key(11, stack({ slab1: -30, slab3: -20, rebar: -60, armB: -140, armB2: -20 })), key(18, stack({ slab1: -30, slab3: -20, rebar: -60, armB: -140 })), key(42, stack({}))], { aerial: true, landingLag: 14 }),
  uair: mv("uair", 40, [cap([10, 14], -40, -170, 40, -170, 28, 13, 85, 40, 85, A)], [key(0, stack({ head: 0 })), key(9, stack({ head: 0, slab3: 0, armF: 160, armB: -160 }, { dy: -8, sy: 1.1 })), key(16, stack({ armF: 160, armB: -160 })), key(40, stack({}))], { aerial: true, landingLag: 12 }),
  dair: mv("dair", 56, [
    cap([18, 20], -30, 10, 30, 10, 30, 18, 270, 30, 95, { ...A, spike: true, priority: 0 }),
    cap([21, 24], -30, 10, 30, 10, 28, 14, 60, 30, 85, { ...A, priority: 1 }),
  ], [key(0, stack({ legF: 30, legB: -30 }, { sy: 1.08 })), key(17, stack({ legF: 0, legB: 0, armF: 10, armB: 10, slab1: 6 }, { dy: 6, sy: 0.9, sx: 1.1 })), key(26, stack({ armF: 10, armB: 10 })), key(56, stack({}))], { aerial: true, landingLag: 24, hover: [12, 17] }),
  grab: mv("grab", 40, [hb([8, 10], 62, -80, 28, 0, 0, 0, 0, { grab: true })], [key(0, stack({ armF: 20 })), key(7, stack({ armF: 100, armF2: 0, armB: 100, armB2: 0, slab1: 10 }, { dx: 8 })), key(14, stack({ armF: 100, armB: 100, slab1: 10 }, { dx: 8 })), key(40, stack({}))], { isGrab: true }),
  dashGrab: mv("dashGrab", 46, [hb([10, 12], 76, -80, 30, 0, 0, 0, 0, { grab: true })], [key(0, stack({ slab1: 16 })), key(9, stack({ armF: 100, armB: 100, slab1: 24 }, { dx: 14 })), key(16, stack({ armF: 100, armB: 100, slab1: 24 }, { dx: 14 })), key(46, stack({}))], { isGrab: true, motion: [[1, 5, 0], [10, 0, 0]] }),
  pummel: mv("pummel", 18, [], [key(0, stack({ armB: 100, armF: 40 })), key(6, stack({ armB: 100, armF: 110, armF2: -20 })), key(18, stack({ armB: 100, armF: 40 }))]),
  fthrow: throwMove("fthrow", 36, 16, 11, 45, 60, 75, [key(0, stack({ armB: 100, armF: 100 })), key(16, stack({ armB: 150, armF: 150, slab1: 26 }, { dx: 10 })), key(36, stack({}))]),
  bthrow: throwMove("bthrow", 44, 20, 12, 40, 65, 80, [key(0, stack({ armB: 100, armF: 100 })), key(20, stack({ slab1: -40, armB: -150, armF: -150 })), key(44, stack({}))]),
  uthrow: throwMove("uthrow", 40, 18, 10, 90, 70, 80, [key(0, stack({ armB: 100, armF: 100 })), key(18, stack({ armB: 190, armF: 190, slab3: -6 }, { dy: -10, sy: 1.1 })), key(40, stack({}))]),
  dthrow: throwMove("dthrow", 44, 22, 8, 70, 50, 40, [key(0, stack({ armB: 100, armF: 100 })), key(22, stack({ armB: 140, armF: 140, slab1: 50, legF: 40, legB: -40 }, { dy: 24 })), key(44, stack({}))]),
  // Demolition: chargeable double-fist ground slam with a shockwave at full charge
  nspecial: mv("nspecial", 70, [cap([24, 29], -20, -30, 90, -20, 34, 18, 42, 40, 110, A)], [key(0, stack({ armF: 180, armF2: -20, armB: 180, armB2: -20, slab1: -20, slab3: -10 }, { dx: -10 })), key(23, stack({ armF: 30, armF2: 30, armB: 30, armB2: 30, slab1: 50, slab2: 10 }, { dx: 20, dy: 10 })), key(34, stack({ armF: 30, armF2: 30, armB: 30, armB2: 30, slab1: 50 }, { dx: 20, dy: 10 })), key(70, stack({}))], { hook: "demolition", armour: { frames: [1, 34], threshold: 12 }, fx: "quake" }),
  // Concrete Hug: command grab, then three lumbering steps in the held direction and a slam
  sspecial: mv("sspecial", 50, [hb([14, 19], 70, -80, 34, 0, 0, 0, 0, { grab: true, unblockable: true })], [key(0, stack({ armF: -30, armB: -30, slab1: -8 })), key(13, stack({ armF: 100, armF2: 20, armB: 100, armB2: 20, slab1: 20 }, { dx: 16 })), key(22, stack({ armF: 100, armF2: 20, armB: 100, armB2: 20, slab1: 20 }, { dx: 16 })), key(50, stack({}))], { hook: "hug", motion: [[10, 6, 0], [19, 0, 0]] }),
  hugWalk: mv("hugWalk", 70, [], [key(0, stack({ armF: 110, armF2: 30, armB: 110, armB2: 30, legF: 30, legB: -30, slab1: 10 })), key(12, stack({ armF: 110, armF2: 30, armB: 110, armB2: 30, legF: -30, legB: 30, slab1: 10 })), key(24, stack({ armF: 110, armF2: 30, armB: 110, armB2: 30, legF: 30, legB: -30, slab1: 10 })), key(36, stack({ armF: 110, armF2: 30, armB: 110, armB2: 30, legF: -30, legB: 30, slab1: 10 })), key(50, stack({ armF: 30, armF2: 30, armB: 30, armB2: 30, slab1: 60 }, { dx: 16, dy: 16 })), key(70, stack({}))], { hook: "hugWalk", throwFrame: 50 }),
  // Piston Jump: one huge vertical burst
  uspecial: mv("uspecial", 60, [cap([6, 12], -40, -60, 40, -60, 44, 12, 80, 50, 70, A)], [key(0, stack({ legF: 40, legB: -40, slab1: 8 }, { dy: 16, sx: 1.15, sy: 0.85 })), key(5, stack({ legF: -10, legB: 10, armF: 170, armB: -170 }, { dy: -10, sx: 0.85, sy: 1.2 })), key(30, stack({ armF: 150, armB: -150 })), key(60, stack({ armF: -150, armB: 150, slab1: 12 }))], { hook: "piston", helpless: true, ledgeOk: true }),
  // Foundation: plant, armour, reflect
  dspecial: mv("dspecial", 200, [], [key(0, stack({ legF: 30, legB: -30 }, { dy: 6 })), key(4, stack({ legF: 50, legB: -50, armF: 60, armF2: -80, armB: 60, armB2: -80, slab1: 4 }, { dy: 18, sx: 1.2, sy: 0.85 })), key(200, stack({ legF: 50, legB: -50, armF: 60, armF2: -80, armB: 60, armB2: -80 }, { dy: 18, sx: 1.2, sy: 0.85 }))], { hook: "foundation", armour: { frames: [4, 200], threshold: 20 }, reflect: true, fx: "guard" }),
  foundationRelease: mv("foundationRelease", 20, [], [key(0, stack({ legF: 50, legB: -50 }, { dy: 18, sx: 1.2, sy: 0.85 })), key(20, stack({}))]),
  ledgeAttack: mv("ledgeAttack", 46, [cap([14, 18], 10, -60, 110, -70, 26, 10, 45, 40, 70, A)], [key(0, stack({ slab1: 40 }, { dy: 30 })), key(13, stack({ armF: 110, armF2: 20, slab1: 20 })), key(20, stack({ armF: 110, armF2: 20 })), key(46, stack({}))], { invuln: [1, 16] }),
  getupAttack: mv("getupAttack", 50, [cap([14, 17], 10, -40, 110, -50, 26, 8, 45, 40, 60, { ...A, group: 0 }), cap([24, 27], -10, -40, -110, -50, 26, 8, 45, 40, 60, { ...A, group: 1 })], [key(0, stack({ slab1: -88 }, { dy: 34 })), key(13, stack({ armF: 120, slab1: 30 }, { dy: 10 })), key(23, stack({ armB: -120, slab1: -30 }, { dy: 10 })), key(50, stack({}))], { invuln: [1, 26] }),
  taunt: mv("taunt", 60, [], anims.taunt),
};

export const brick: FighterDef = {
  id: "brick",
  name: "BRICK",
  tagline: "The wall. Make them commit, then punish once.",
  stats,
  moves,
  rig: { bones, anims, loops: { idle: 80, walk: 28, run: 18, helpless: 40 } },
  palette: {
    colors: { brick: "#e8642c", brickLight: "#f4884a", tar: "#1a1412", mortar: "#f2e6c8", steel: "#9aa3ad", accent: "#f2e6c8" },
    accent: "mortar",
    outline: "#1a1412",
  },
  special: () => ({ charge: 0, hugSteps: 0, plant: 0 }),
  hooks: {
    demolition: ({ f, input, state }) => {
      // hold on frames 1..23 charges up to 90 frames; damage 18 -> 34, full charge adds a ground shockwave
      if (f.frame <= 23 && f.special.charge < 90 && (input.b & 4)) {
        f.special.charge++;
        if (f.frame === 23) f.frame = 22;
        return;
      }
      if (f.frame === 24) {
        const c = f.special.charge;
        f.chargeMul = 1 + (c / 90) * 0.9;
        if (c >= 90 && f.grounded) {
          spawnProjectile(state, f, "shock", f.x + f.moveFacing * 60, f.y - 10, f.moveFacing * 9, 0, 40, { frames: [0, 999], x: 0, y: 0, r: 22, damage: 12, angle: 70, base: 50, growth: 70, fx: "heavy" });
        }
        f.special.charge = 0;
      }
    },
    hug: ({ f, state }) => {
      // the command grab connected: switch to the walk-and-slam move
      if (f.grabbing >= 0 && f.frame >= 14) {
        f.special.hugSteps = 0;
        f.action = "attack"; f.frame = 0; f.move = "hugWalk"; f.moveInstance++;
        const v = state.fighters[f.grabbing];
        if (v) { v.action = "grabbed"; v.frame = 0; }
      }
    },
    hugWalk: ({ f, input, state }) => {
      const v = state.fighters[f.grabbing];
      if (!v || v.grabbedBy !== f.slot) { setAction(f, "idle"); f.grabbing = -1; return; }
      if (f.frame < 48) {
        const dir = Math.abs(input.x) >= STICK_DEAD ? sign(input.x) : f.moveFacing;
        f.facing = dir as 1 | -1; f.moveFacing = f.facing;
        f.vx = dir * 2.2;
        if (!f.grounded) { f.vx = dir * 1.2; }
        v.x = f.x + f.facing * 60; v.y = f.y; v.facing = (-f.facing) as 1 | -1;
        v.action = "grabbed";
      }
      if (f.frame === 48) {
        // slam: the throwFrame machinery releases at 50 with these numbers
        moves.hugWalk.hitboxes = [hb([0, 0], 0, 0, 0, 14, 50, 70, 75, { fx: "heavy" })];
      }
    },
    piston: ({ f, input }) => {
      if (f.frame === 5) { f.vy = -stats.fullHop * 2.2; f.grounded = false; f.platform = -1; f.usedUpSpecial = true; }
      if (f.frame > 5 && f.frame < 30) f.vx = (input.x / 100) * 1.2;
    },
    foundation: ({ f, input }) => {
      f.vx = 0;
      if (f.frame < 4) return;
      f.special.plant = f.frame;
      const release = (input.b & (1 | 2 | 4 | 16)) !== 0 || Math.abs(input.x) >= 70;
      if ((release && f.frame > 6) || f.frame >= 199) {
        const stagger = f.frame > 90;
        f.action = "attack"; f.frame = stagger ? 0 : 10; f.move = "foundationRelease"; f.moveInstance++;
      }
    },
  },
  meters: [],
};
