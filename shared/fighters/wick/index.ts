import type { Bone, FighterDef, Move, PoseKey, Stats } from "../../types";
import { cap, hb, key, mv, throwMove } from "../helpers";
import { setAction } from "../../fighter";
import { spawnProjectile } from "../../hits";
import { STICK_DEAD } from "../../input";
import { sign } from "../../fixed";

const stats: Stats = {
  weight: 72, walk: 4.5, run: 9.4, dashInit: 10.5, airSpeed: 5.8, airAccel: 0.3,
  fallSpeed: 6.5, fastFall: 10.5, gravity: 0.34, shortHop: 7.5, fullHop: 12.5, doubleJump: 12,
  jumps: 2, wallJump: true, traction: 0.5, height: 74, width: 46, crouchHeight: 50, landLag: 3, ledgeReach: 30,
};

// Rig: a hovering teardrop of flame with two stubby arm-flames and dot eyes. No legs.
const bones: Bone[] = [
  { name: "core", parent: null, len: 8, thick: 0, rest: 180, color: "ember", shape: "circle", size: 0, z: 0 },
  { name: "tail", parent: "core", len: 18, thick: 9, rest: 180, at: 1, color: "ember", shape: "flame", z: 0.5 },
  { name: "body", parent: "core", len: 58, thick: 22, rest: 0, at: 1, color: "flame", shape: "flame", z: 1 },
  { name: "inner", parent: "core", len: 40, thick: 12, rest: 0, at: 1, color: "core", shape: "flame", z: 1.5 },
  { name: "shB", parent: "body", len: 16, thick: 0, rest: -90, at: 0.45, color: "flame", shape: "circle", size: 0, z: 0.8 },
  { name: "armB", parent: "shB", len: 20, thick: 7, rest: 60, at: 1, color: "flame", z: 0.8 },
  { name: "shF", parent: "body", len: 16, thick: 0, rest: 90, at: 0.45, color: "flame", shape: "circle", size: 0, z: 2 },
  { name: "armF", parent: "shF", len: 20, thick: 7, rest: -60, at: 1, color: "flame", z: 2 },
  { name: "eyeF", parent: "body", len: 2, thick: 0, rest: 90, at: 0.62, color: "ink", shape: "circle", size: 3.2, z: 3 },
  { name: "eyeB", parent: "body", len: 2, thick: 0, rest: 90, at: 0.62, color: "ink", shape: "circle", size: 3.2, z: 3 },
  { name: "mouth", parent: "body", len: 6, thick: 1.6, rest: 90, at: 0.5, color: "ink", z: 3 },
];
// eyeB sits behind eyeF: give it a negative offset via its rest angle in poses (renderer uses angles only), so
// instead place it with a tiny bone from the body pointing backward
bones[bones.findIndex((b) => b.name === "eyeB")] = { name: "eyeB", parent: "body", len: 2, thick: 0, rest: -30, at: 0.62, color: "ink", shape: "circle", size: 3.2, z: 3 };

const P = (a: Record<string, number>, extra: { dx?: number; dy?: number; sx?: number; sy?: number } = {}) => ({ a, ...extra });
const base = { body: 0, armF: 0, armB: 0, tail: 0 };
const B_ = (a: Record<string, number>, extra: { dx?: number; dy?: number; sx?: number; sy?: number } = {}) => P({ ...base, ...a }, extra);
const anims: Record<string, PoseKey[]> = {
  idle: [key(0, B_({}, { dy: -6 })), key(20, B_({ body: 3, armF: 10, armB: -10 }, { dy: -12, sx: 0.96, sy: 1.05 })), key(40, B_({}, { dy: -6 }))],
  walk: [key(0, B_({ body: 8, armF: 20, armB: -20 }, { dy: -8 })), key(10, B_({ body: 8, armF: -20, armB: 20 }, { dy: -14 })), key(20, B_({ body: 8, armF: 20, armB: -20 }, { dy: -8 }))],
  run: [key(0, B_({ body: 30, tail: 20, armF: 40, armB: -40 }, { dy: -10, sx: 1.1, sy: 0.95 })), key(6, B_({ body: 26, tail: 16, armF: -40, armB: 40 }, { dy: -16, sx: 1.05, sy: 1 })), key(12, B_({ body: 30, tail: 20, armF: 40, armB: -40 }, { dy: -10, sx: 1.1, sy: 0.95 }))],
  dash: [key(0, B_({ body: 40, tail: 30 }, { dy: -8, sx: 1.2, sy: 0.9 })), key(8, B_({ body: 30, tail: 20 }, { dy: -12 }))],
  skid: [key(0, B_({ body: -20, tail: -20, armF: 30, armB: 30 }, { dy: -8 }))],
  crouch: [key(0, B_({ body: 0 }, { dy: 2, sx: 1.3, sy: 0.7 }))],
  jumpSquat: [key(0, B_({}, { dy: 2, sx: 1.25, sy: 0.8 }))],
  jump: [key(0, B_({ armF: -80, armB: 80, tail: 10 }, { dy: -10, sx: 0.85, sy: 1.25 })), key(12, B_({ armF: -50, armB: 50 }, { dy: -10, sx: 1, sy: 1 }))],
  fall: [key(0, B_({ armF: -110, armB: 110, tail: 0 }, { dy: -8, sx: 1.05, sy: 0.95 }))],
  land: [key(0, B_({}, { dy: 4, sx: 1.3, sy: 0.7 })), key(4, B_({}, { dy: -6 }))],
  helpless: [key(0, B_({ body: 20, armF: -140, armB: 140 }, { dy: -6 })), key(20, B_({ body: -20, armF: -140, armB: 140 }, { dy: -6 })), key(40, B_({ body: 20, armF: -140, armB: 140 }, { dy: -6 }))],
  shield: [key(0, B_({ armF: 60, armB: 60 }, { dy: -2, sx: 1.1, sy: 0.9 }))],
  hitstun: [key(0, B_({ body: -25, armF: -60, armB: 60 }, { dy: -6, sx: 1.15, sy: 0.9 }))],
  tumble: [key(0, B_({ body: -60, armF: -120, armB: 120 }, { dy: -6 })), key(12, B_({ body: -200, armF: -120, armB: 120 }, { dy: -6 })), key(24, B_({ body: -340, armF: -120, armB: 120 }, { dy: -6 })), key(36, B_({ body: -480, armF: -120, armB: 120 }, { dy: -6 }))],
  knockdown: [key(0, B_({ body: -85, tail: 30 }, { dy: 10, sx: 1.1 }))],
  ledgeHang: [key(0, B_({ armF: 190, armB: 180, body: -10 }, { dy: -6 }))],
  grabHold: [key(0, B_({ armF: 100, armB: 90 }, { dy: -6 }))],
  grabbed: [key(0, B_({ body: -6, armF: -30, armB: 30 }, { dy: -6, sx: 0.9, sy: 1.1 }))],
  dead: [key(0, B_({}))],
  taunt: [key(0, B_({}, { dy: -6 })), key(10, B_({ body: 20 }, { dy: -6, sx: 0.6, sy: 1.1 })), key(20, B_({ body: -20 }, { dy: -6, sx: 1.2, sy: 0.9 })), key(30, B_({}, { dy: -6 }))],
  respawn: [key(0, B_({}, { dy: -6 }))],
  spotDodge: [key(0, B_({}, { dy: 2, sx: 1.3, sy: 0.6 }))],
  roll: [key(0, B_({ body: 40 }, { dy: -4 })), key(16, B_({ body: 400 }, { dy: -4 })), key(32, B_({ body: 720 }, { dy: -6 }))],
  airDodge: [key(0, B_({ body: 20 }, { dy: -6, sx: 0.8, sy: 0.8 })), key(30, B_({}, { dy: -6 }))],
};

const F = { fx: "fire" as const };
const W = (a: Record<string, number>, extra: { dx?: number; dy?: number; sx?: number; sy?: number } = {}) => B_(a, { dy: -6, ...extra });

const moves: Record<string, Move> = {
  jab1: mv("jab1", 14, [hb([3, 4], 44, -44, 12, 2, 70, 10, 30, F)], [key(0, W({ armF: 20 })), key(2, W({ armF: 100, body: 6 }, { dx: 4 })), key(6, W({ armF: 100, body: 6 }, { dx: 4 })), key(14, W({}))], { iasa: 9, next: "jab2", nextFrom: 4 }),
  jab2: mv("jab2", 16, [hb([3, 4], 46, -46, 12, 2, 70, 10, 30, F)], [key(0, W({ armB: 20 })), key(2, W({ armB: 100, body: -6 }, { dx: 4 })), key(6, W({ armB: 100, body: -6 }, { dx: 4 })), key(16, W({}))], { iasa: 10, next: "jabRapid", nextFrom: 4 }),
  jabRapid: mv("jabRapid", 40, [
    hb([4, 5], 48, -44, 14, 1, 0, 8, 20, { ...F, group: 1 }), hb([8, 9], 48, -44, 14, 1, 0, 8, 20, { ...F, group: 2 }), hb([12, 13], 48, -44, 14, 1, 0, 8, 20, { ...F, group: 3 }),
    hb([16, 17], 48, -44, 14, 1, 0, 8, 20, { ...F, group: 4 }), hb([20, 21], 48, -44, 14, 1, 0, 8, 20, { ...F, group: 5 }), hb([24, 25], 48, -44, 14, 1, 0, 8, 20, { ...F, group: 6 }),
    hb([30, 32], 56, -44, 18, 4, 50, 40, 100, { ...F, group: 7 }),
  ], [key(0, W({ armF: 100, armB: 100, body: 10 })), key(4, W({ armF: 120, armB: 60 })), key(8, W({ armF: 60, armB: 120 })), key(12, W({ armF: 120, armB: 60 })), key(16, W({ armF: 60, armB: 120 })), key(20, W({ armF: 120, armB: 60 })), key(24, W({ armF: 60, armB: 120 })), key(30, W({ armF: 110, armB: 110, body: 20 }, { dx: 8, sx: 1.2 })), key(40, W({}))]),
  ftilt: mv("ftilt", 22, [cap([5, 7], 20, -46, 66, -46, 13, 7, 40, 30, 70, F)], [key(0, W({ armF: 20 })), key(4, W({ armF: 110, body: 16 }, { dx: 8, sx: 1.15, sy: 0.9 })), key(9, W({ armF: 110, body: 16 }, { dx: 8 })), key(22, W({}))], { iasa: 18 }),
  utilt: mv("utilt", 20, [cap([4, 7], -20, -90, 24, -104, 16, 6, 95, 25, 80, F)], [key(0, W({ armF: 40 })), key(3, W({ armF: 170, armB: -170, body: -6 }, { dy: -14, sy: 1.15, sx: 0.9 })), key(9, W({ armF: 170, armB: -170 }, { dy: -12 })), key(20, W({}))], { iasa: 16 }),
  dtilt: mv("dtilt", 18, [cap([4, 5], 10, -14, 60, -12, 12, 5, 80, 20, 60, F)], [key(0, W({}, { dy: 0, sx: 1.2, sy: 0.8 })), key(3, W({ armF: 130, body: 30 }, { dx: 10, dy: 2, sx: 1.3, sy: 0.7 })), key(8, W({ armF: 130, body: 30 }, { dx: 10, dy: 2, sx: 1.3, sy: 0.7 })), key(18, W({}))], { iasa: 14 }),
  dashAttack: mv("dashAttack", 32, [
    hb([6, 8], 30, -40, 26, 3, 60, 20, 30, { ...F, group: 1 }), hb([10, 12], 30, -40, 26, 3, 60, 20, 30, { ...F, group: 2 }), hb([14, 16], 34, -40, 28, 3, 60, 40, 60, { ...F, group: 3 }),
  ], [key(0, W({ body: 40, tail: 30 }, { sx: 1.25, sy: 0.85 })), key(6, W({ body: 60, tail: 40 }, { dx: 10, sx: 1.4, sy: 0.8 })), key(16, W({ body: 60, tail: 40 }, { dx: 10, sx: 1.4, sy: 0.8 })), key(32, W({}))], { motion: [[1, 11, 0], [6, 8, 0], [16, 1, 0]], fx: "trail" }),
  fsmash: mv("fsmash", 42, [cap([12, 15], 20, -46, 96, -44, 16, 14, 42, 48, 108, F)], [key(0, W({ body: -20, tail: -10, armF: -40, armB: -40 }, { dx: -10, sx: 0.85, sy: 1.15 })), key(11, W({ body: 80, tail: 30, armF: 90, armB: 90 }, { dx: 24, sx: 1.6, sy: 0.7 })), key(18, W({ body: 80, tail: 30, armF: 90, armB: 90 }, { dx: 24, sx: 1.6, sy: 0.7 })), key(42, W({}))], { smash: true, motion: [[11, 6, 0], [15, 0, 0]], fx: "trail" }),
  usmash: mv("usmash", 46, [cap([11, 14], -12, -60, 12, -150, 17, 9, 90, 34, 116, F)], [key(0, W({}, { dy: 4, sx: 1.3, sy: 0.7 })), key(10, W({ armF: 170, armB: -170 }, { dy: -30, sx: 0.6, sy: 2.0 })), key(16, W({ armF: 170, armB: -170 }, { dy: -30, sx: 0.6, sy: 2.0 })), key(46, W({}))], { smash: true }),
  dsmash: mv("dsmash", 38, [
    hb([10, 12], 60, -22, 24, 11, 35, 40, 102, { ...F, group: 0 }),
    hb([16, 18], -60, -22, 24, 11, 35, 40, 102, { ...F, group: 1 }),
  ], [key(0, W({}, { dy: 2, sx: 1.2, sy: 0.8 })), key(9, W({ armF: 110, body: 20 }, { dx: 10, dy: 4, sx: 1.5, sy: 0.65 })), key(15, W({ armB: -110, body: -20 }, { dx: -10, dy: 4, sx: 1.5, sy: 0.65 })), key(38, W({}))], { smash: true }),
  nair: mv("nair", 30, [hb([4, 8], 0, -46, 40, 7, 50, 25, 65, { ...F, group: 0 }), hb([9, 18], 0, -46, 36, 4, 50, 20, 55, { ...F, group: 1, priority: 2 })], [key(0, W({})), key(4, W({ body: 90, armF: 90, armB: -90 }, { sx: 1.2, sy: 1.2 })), key(18, W({ body: 450, armF: 90, armB: -90 }, { sx: 1.2, sy: 1.2 })), key(30, W({ body: 720 }))], { aerial: true, landingLag: 6 }),
  fair: mv("fair", 34, [
    hb([7, 9], 50, -46, 16, 3, 45, 20, 40, { ...F, group: 1 }), hb([13, 15], 50, -46, 16, 3, 45, 20, 40, { ...F, group: 2 }), hb([19, 21], 56, -46, 18, 5, 45, 30, 85, { ...F, group: 3 }),
  ], [key(0, W({ armF: 30 })), key(7, W({ armF: 120, body: 10 })), key(13, W({ armB: 120, armF: 40, body: 10 })), key(19, W({ armF: 130, armB: 130, body: 20 }, { dx: 6, sx: 1.2 })), key(34, W({}))], { aerial: true, landingLag: 8 }),
  bair: mv("bair", 28, [cap([6, 8], -30, -50, -80, -40, 16, 10, 40, 42, 108, F)], [key(0, W({ tail: 10 })), key(5, W({ body: -40, tail: -80, armB: -120 }, { dx: -6, sx: 1.2 })), key(10, W({ body: -40, tail: -80, armB: -120 }, { dx: -6 })), key(28, W({}))], { aerial: true, landingLag: 8 }),
  uair: mv("uair", 24, [cap([5, 8], -20, -90, 20, -100, 18, 7, 85, 30, 96, F)], [key(0, W({})), key(4, W({ armF: 170, armB: -170 }, { dy: -16, sy: 1.25, sx: 0.85 })), key(9, W({ armF: 170, armB: -170 }, { dy: -14 })), key(24, W({}))], { aerial: true, landingLag: 6 }),
  dair: mv("dair", 42, [hb([11, 13], 0, 4, 18, 9, 270, 20, 80, { ...F, spike: true })], [key(0, W({})), key(8, W({ armF: 60, armB: 60, body: 0 }, { dy: 6, sx: 1.1, sy: 0.9 })), key(14, W({ armF: 60, armB: 60 }, { dy: 6 })), key(40, W({}))], { aerial: true, landingLag: 12, hover: [5, 8] }),
  grab: mv("grab", 30, [hb([6, 7], 40, -44, 18, 0, 0, 0, 0, { grab: true })], [key(0, W({})), key(5, W({ armF: 100, armB: 100, body: 12 }, { dx: 6 })), key(10, W({ armF: 100, armB: 100 }, { dx: 6 })), key(30, W({}))], { isGrab: true }),
  dashGrab: mv("dashGrab", 36, [hb([8, 9], 52, -44, 20, 0, 0, 0, 0, { grab: true })], [key(0, W({ body: 20 })), key(7, W({ armF: 100, armB: 100, body: 30 }, { dx: 12 })), key(12, W({ armF: 100, armB: 100 }, { dx: 12 })), key(36, W({}))], { isGrab: true, motion: [[1, 6, 0], [8, 0, 0]] }),
  pummel: mv("pummel", 12, [], [key(0, W({ armF: 100, armB: 60 })), key(4, W({ armF: 100, armB: 120 })), key(12, W({ armF: 100, armB: 60 }))]),
  fthrow: throwMove("fthrow", 26, 10, 7, 50, 50, 60, [key(0, W({ armF: 100, armB: 100 })), key(10, W({ armF: 150, armB: 150, body: 30 }, { dx: 8 })), key(26, W({}))]),
  bthrow: throwMove("bthrow", 30, 12, 8, 45, 60, 90, [key(0, W({ armF: 100, armB: 100 })), key(12, W({ body: -50, armF: -150, armB: -150 })), key(30, W({}))]),
  uthrow: throwMove("uthrow", 28, 12, 6, 90, 55, 75, [key(0, W({ armF: 100, armB: 100 })), key(12, W({ armF: 190, armB: 190 }, { dy: -14, sy: 1.2 })), key(28, W({}))]),
  dthrow: throwMove("dthrow", 30, 14, 5, 60, 40, 55, [key(0, W({ armF: 100, armB: 100 })), key(14, W({ armF: 140, armB: 140, body: 40 }, { dy: 6, sx: 1.2, sy: 0.8 })), key(30, W({}))]),
  // Flare: short burst in front; at 100 heat it's a Nova all round
  nspecial: mv("nspecial", 30, [hb([8, 10], 44, -46, 26, 9, 60, 40, 85, F)], [key(0, W({ armF: -40, armB: -40 }, { sx: 0.85, sy: 1.1 })), key(7, W({ armF: 100, armB: 100, body: 10 }, { dx: 6, sx: 1.3, sy: 1.2 })), key(12, W({ armF: 100, armB: 100 }, { dx: 6 })), key(30, W({}))], { hook: "flare" }),
  nova: mv("nova", 40, [hb([8, 12], 0, -44, 90, 16, 60, 60, 90, { ...F, radial: true })], [key(0, W({}, { sx: 0.8, sy: 0.8 })), key(8, W({ armF: 90, armB: -90 }, { sx: 2.2, sy: 2.2 })), key(14, W({ armF: 90, armB: -90 }, { sx: 2.0, sy: 2.0 })), key(40, W({}))]),
  // Flicker: blink 220 units, hit where you reappear
  sspecial: mv("sspecial", 34, [hb([15, 17], 10, -46, 34, 8, 45, 30, 80, F)], [key(0, W({ body: 10 }, { sx: 0.9, sy: 1.1 })), key(5, W({}, { sx: 0.3, sy: 1.6 })), key(14, W({}, { sx: 0.3, sy: 1.6 })), key(15, W({ body: 20 }, { sx: 1.5, sy: 1.3 }), true), key(34, W({}))], { hook: "flicker", invuln: [6, 14], ledgeOk: true, fx: "trail" }),
  // Flashfire: spiral rise, multi-hit then a launcher
  uspecial: mv("uspecial", 50, [
    hb([6, 8], 0, -50, 36, 2, 80, 20, 30, { ...F, group: 1 }), hb([10, 12], 0, -56, 36, 2, 80, 20, 30, { ...F, group: 2 }), hb([14, 16], 0, -62, 36, 2, 80, 20, 30, { ...F, group: 3 }),
    hb([18, 20], 0, -66, 36, 2, 80, 20, 30, { ...F, group: 4 }), hb([22, 24], 0, -70, 36, 2, 80, 20, 30, { ...F, group: 5 }), hb([26, 28], 0, -80, 44, 6, 80, 30, 90, { ...F, group: 6 }),
  ], [key(0, W({}, { sx: 1.2, sy: 0.8 })), key(5, W({ body: 0, armF: 90, armB: -90 }, { sx: 0.8, sy: 1.4 })), key(28, W({ body: 720, armF: 90, armB: -90 }, { sx: 0.8, sy: 1.4 })), key(50, W({ armF: -140, armB: 140 }))], { hook: "flashfire", helpless: true, fx: "trail" }),
  // Snuff: go out, come back with a puff; costs 30 heat
  dspecial: mv("dspecial", 40, [hb([28, 30], 0, -44, 40, 6, 70, 30, 60, F)], [key(0, W({}, { sx: 1.1, sy: 1.1 })), key(3, W({}, { sx: 0.05, sy: 0.05 })), key(27, W({}, { sx: 0.05, sy: 0.05 })), key(28, W({}, { sx: 1.6, sy: 1.6 }), true), key(40, W({}))], { hook: "snuff", invuln: [3, 26], ledgeOk: true }),
  ledgeAttack: mv("ledgeAttack", 34, [cap([10, 13], 10, -40, 80, -46, 18, 7, 45, 40, 70, F)], [key(0, W({ body: 40 }, { dy: 20 })), key(9, W({ armF: 110, body: 20 })), key(15, W({ armF: 110 })), key(34, W({}))], { invuln: [1, 12] }),
  getupAttack: mv("getupAttack", 40, [hb([10, 12], 50, -30, 22, 6, 45, 40, 60, { ...F, group: 0 }), hb([18, 20], -50, -30, 22, 6, 45, 40, 60, { ...F, group: 1 })], [key(0, W({ body: -85 }, { dy: 10 })), key(9, W({ armF: 120, body: 30 })), key(17, W({ armB: -120, body: -30 })), key(40, W({}))], { invuln: [1, 20] }),
  taunt: mv("taunt", 60, [], anims.taunt),
};

const HEAT_MAX = 100;

export const wick: FighterDef = {
  id: "wick",
  name: "WICK",
  tagline: "The runaway flame. Never stop moving.",
  stats,
  moves,
  rig: { bones, anims, loops: { idle: 40, walk: 20, run: 12, helpless: 40 } },
  palette: {
    colors: { core: "#fff1a8", flame: "#ffc43a", ember: "#ff4d2e", ink: "#2a0f0a", accent: "#fff1a8" },
    accent: "core",
    outline: "#ff4d2e",
  },
  special: () => ({ heat: 30, flickerUsed: 0, blinkX: 0, blinkY: 0 }),
  hooks: {
    flare: ({ f, state }) => {
      if (f.frame === 1 && f.special.heat >= HEAT_MAX) {
        f.action = "attack"; f.frame = 0; f.move = "nova"; f.moveInstance++;
        f.special.heat = 0;
        state.events.push({ t: "sfx", frame: state.frame, slot: f.slot, name: "nova", x: f.x, y: f.y - 40 });
      }
    },
    flicker: ({ f, input, state }) => {
      if (f.frame === 1) {
        if (!f.grounded && f.special.flickerUsed) { setAction(f, "air"); return; }
        if (!f.grounded) f.special.flickerUsed = 1;
        const dx = Math.abs(input.x) >= STICK_DEAD ? sign(input.x) : f.moveFacing;
        const dy = Math.abs(input.y) >= 60 ? sign(input.y) : 0;
        f.special.blinkX = dx; f.special.blinkY = dy;
        f.facing = dx as 1 | -1; f.moveFacing = f.facing;
        f.vx = 0; f.vy = 0;
      }
      if (f.frame >= 6 && f.frame <= 14) { f.vx = 0; f.vy = 0; }
      if (f.frame === 14) {
        const dist = 220;
        const empowered = f.special.heat >= HEAT_MAX;
        f.x += f.special.blinkX * dist * (f.special.blinkY ? 0.7 : 1);
        f.y += f.special.blinkY * dist * 0.6;
        if (f.grounded && f.special.blinkY !== 0) { f.grounded = false; f.platform = -1; }
        if (empowered) {
          // ignite the path: a lingering hitbox trail
          for (let i = 1; i <= 3; i++) spawnProjectile(state, f, "emberTrail", f.x - f.special.blinkX * dist * (i / 4), f.y - 40, 0, 0, 30, { frames: [0, 999], x: 0, y: 0, r: 30, damage: 5, angle: 70, base: 30, growth: 50, fx: "fire", rehit: 999 });
          f.special.heat = 0;
        }
        state.events.push({ t: "dash", frame: state.frame, slot: f.slot, x: f.x, y: f.y, facing: f.moveFacing });
      }
    },
    flashfire: ({ f, input }) => {
      if (f.frame === 1) { f.vy = -8; f.grounded = false; f.platform = -1; f.usedUpSpecial = true; }
      if (f.frame >= 2 && f.frame <= 28) { f.vy = -6.5 + f.frame * 0.1; f.vx = (input.x / 100) * 3.2; }
    },
    snuff: ({ f, state }) => {
      if (f.frame === 1) {
        if (f.special.heat < 30) { setAction(f, f.grounded ? "idle" : "air"); return; }
        f.special.heat -= 30;
        f.vx *= 0.3;
      }
      if (f.frame >= 3 && f.frame <= 26) { f.vx *= 0.9; if (!f.grounded) f.vy = Math.min(f.vy, 2); }
      if (f.frame === 28) state.events.push({ t: "sfx", frame: state.frame, slot: f.slot, name: "reignite", x: f.x, y: f.y - 40 });
    },
  },
  onHit: ({ f, state }, victim, hbx) => {
    f.special.heat = Math.min(HEAT_MAX, f.special.heat + hbx.damage * 1.0);
    if (f.special.heat >= 60 && hbx.damage >= 7) {
      spawnProjectile(state, f, "ember", victim.x, victim.y - 30, 0, 0, 12, { frames: [0, 999], x: 0, y: 0, r: 16, damage: 2, angle: 80, base: 20, growth: 30, fx: "fire" });
    }
  },
  onHurt: ({ f }, _a, damage) => { f.special.heat = Math.max(0, f.special.heat - damage * 1.2); },
  onFrame: ({ f, state }) => {
    if (f.grounded) f.special.flickerUsed = 0;
    f.special.heat = Math.max(0, f.special.heat - 0.05);
    if (f.special.heat >= 60 && f.action === "run" && state.frame % 10 === 0) {
      spawnProjectile(state, f, "ember", f.x - f.facing * 20, f.y - 10, 0, 0, 14, { frames: [0, 999], x: 0, y: 0, r: 14, damage: 2, angle: 80, base: 20, growth: 30, fx: "fire" });
    }
  },
  meters: [{ label: "HEAT", color: "#ffc43a", get: (f) => f.special.heat / HEAT_MAX }],
  visual: (f) => ({ scale: 0.8 + (f.special.heat / HEAT_MAX) * 0.4, glow: f.special.heat / HEAT_MAX }),
};
