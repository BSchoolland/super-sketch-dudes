import type { FighterDef, Move, Stats } from "../../types";
import { cap, hb, key, mv, throwMove } from "../helpers";
import { humanoidAnims, humanoidBones, humanoidLoops } from "../humanoid";
import { spawnProjectile } from "../../hits";
import { setAction } from "../../fighter";

const stats: Stats = {
  weight: 100, walk: 4.2, run: 7.8, dashInit: 8.6, airSpeed: 4.4, airAccel: 0.18,
  fallSpeed: 8.4, fastFall: 13, gravity: 0.48, shortHop: 8.6, fullHop: 14.2, doubleJump: 13,
  jumps: 2, wallJump: true, traction: 0.55, height: 126, width: 50, crouchHeight: 76, landLag: 4, ledgeReach: 40,
};

// Rapier reach: shoulder at (0,-95); the arm extends ~55, the blade ~95. A full lunge reaches x≈165.
// Every blade move has a tipper at the last 20% of the blade: priority 0 with more damage and knockback.
const T = { fx: "tip" as const, priority: 0, electric: false };
const S = { fx: "slash" as const, priority: 1 };
const tip = (d: number) => Math.round(d * 1.4 * 10) / 10;
const tipKb = (g: number) => Math.round(g * 1.3);

const stanceA = { torso: 8, legF: 25, legF2: -20, legB: -25, legB2: 25, armF: 100, armF2: -20, weapon: 10, armB: -40, armB2: -40 };
const lungePose = { torso: 30, legF: 70, legF2: -30, legB: -40, legB2: 10, armF: 60, armF2: 0, weapon: 0, armB: -40, armB2: -30 };

const moves: Record<string, Move> = {
  jab1: mv("jab1", 18, [
    hb([4, 5], 128, -88, 12, tip(3), 60, 20, 40, T),
    cap([4, 5], 50, -88, 118, -88, 11, 3, 60, 20, 40, S),
  ], [key(0, { a: stanceA }), key(3, { a: { ...stanceA, torso: 16, armF: 66, armF2: 0 } }), key(8, { a: { ...stanceA, torso: 16, armF: 66, armF2: 0 } }), key(18, { a: stanceA })], { iasa: 12, next: "jab2", nextFrom: 6 }),
  jab2: mv("jab2", 20, [
    hb([5, 6], 132, -84, 12, tip(3), 60, 20, 40, T),
    cap([5, 6], 50, -84, 122, -84, 11, 3, 60, 20, 40, S),
  ], [key(0, { a: { ...stanceA, armF: 120 } }), key(4, { a: { ...stanceA, torso: 18, armF: 68, armF2: 0 } }), key(9, { a: { ...stanceA, torso: 18, armF: 68 } }), key(20, { a: stanceA })], { iasa: 14, next: "jab3", nextFrom: 7 }),
  jab3: mv("jab3", 30, [
    hb([6, 8], 150, -80, 14, tip(5), 50, 40, 85, T),
    cap([6, 8], 50, -82, 138, -80, 12, 5, 50, 40, 85, S),
  ], [key(0, { a: { ...stanceA, armF: 90, torso: 0 } }), key(5, { a: lungePose, dx: 10 }), key(12, { a: lungePose, dx: 10 }), key(30, { a: stanceA, dx: 0 })]),
  ftilt: mv("ftilt", 30, [
    hb([8, 10], 158, -84, 14, tip(11), 38, 35, tipKb(85), T),
    cap([8, 10], 55, -86, 146, -84, 12, 11, 38, 35, 85, S),
  ], [key(0, { a: stanceA }), key(7, { a: lungePose, dx: 12 }), key(11, { a: lungePose, dx: 12 }), key(30, { a: stanceA, dx: 0 })], { iasa: 26 }),
  utilt: mv("utilt", 26, [
    hb([6, 10], 30, -215, 14, tip(8), 92, 30, tipKb(85), T),
    cap([6, 10], 20, -100, 30, -200, 12, 8, 92, 30, 85, S),
  ], [key(0, { a: { ...stanceA, armF: 60 } }), key(5, { a: { ...stanceA, torso: -6, armF: 172, armF2: 0, weapon: 0 } }), key(11, { a: { ...stanceA, torso: -6, armF: 172, armF2: 0 } }), key(26, { a: stanceA })], { iasa: 22 }),
  dtilt: mv("dtilt", 24, [
    hb([6, 8], 140, -22, 12, tip(8), 28, 30, tipKb(70), T),
    cap([6, 8], 40, -30, 128, -22, 11, 8, 28, 30, 70, S),
  ], [key(0, { a: { ...stanceA, legF: 60, legF2: -90, legB: -50, legB2: 90, torso: 25 }, dy: 24 }), key(5, { a: { legF: 60, legF2: -90, legB: -50, legB2: 90, torso: 45, armF: -8, armF2: 0, weapon: 0, armB: -60 }, dy: 26 }), key(10, { a: { legF: 60, legF2: -90, legB: -50, legB2: 90, torso: 45, armF: -8, armF2: 0 }, dy: 26 }), key(24, { a: stanceA, dy: 0 })], { iasa: 20 }),
  dashAttack: mv("dashAttack", 36, [
    hb([9, 13], 120, -70, 16, 10, 55, 45, 65, { fx: "slash", priority: 0 }),
    cap([9, 13], 30, -80, 100, -70, 12, 8, 55, 45, 60, S),
  ], [key(0, { a: { ...stanceA, torso: 30 } }), key(8, { a: { ...lungePose, torso: 45, armF: 60 }, dx: 16 }), key(14, { a: { ...lungePose, torso: 45 }, dx: 16 }), key(36, { a: stanceA, dx: 0 })], { motion: [[1, 9, 0], [9, 4, 0], [14, 1, 0]] }),
  fsmash: mv("fsmash", 50, [
    hb([14, 16], 172, -84, 16, tip(16), 40, 45, tipKb(100), T),
    cap([14, 16], 55, -88, 158, -84, 13, 16, 40, 45, 100, S),
  ], [key(0, { a: { ...stanceA, torso: -12, armF: 0, armF2: -40, weapon: 0 }, dx: -10 }), key(13, { a: { ...lungePose, torso: 34, armF: 62 }, dx: 26 }), key(18, { a: { ...lungePose, torso: 34, armF: 62 }, dx: 26 }), key(50, { a: stanceA, dx: 0 })], { smash: true, motion: [[13, 5, 0], [16, 0, 0]] }),
  usmash: mv("usmash", 44, [
    hb([10, 15], 24, -235, 16, tip(14), 90, 40, tipKb(100), T),
    cap([10, 15], 10, -120, 22, -220, 13, 14, 90, 40, 100, S),
  ], [key(0, { a: { ...stanceA, torso: 20, legF: 40, legF2: -50, legB: -30, legB2: 50, armF: 20, armF2: -20 }, dy: 14 }), key(9, { a: { ...stanceA, torso: -10, armF: 172, armF2: 0, weapon: 0 }, dy: -4 }), key(16, { a: { ...stanceA, torso: -12, armF: 172, armF2: 0 }, dy: 0 }), key(44, { a: stanceA, dy: 0 })], { smash: true }),
  dsmash: mv("dsmash", 44, [
    hb([12, 13], 140, -24, 14, tip(13), 32, 40, tipKb(90), { ...T, group: 0 }),
    cap([12, 13], 40, -30, 128, -24, 12, 13, 32, 40, 90, { ...S, group: 0 }),
    hb([18, 19], -140, -24, 14, tip(13), 32, 40, tipKb(90), { ...T, group: 1 }),
    cap([18, 19], -40, -30, -128, -24, 12, 13, 32, 40, 90, { ...S, group: 1 }),
  ], [key(0, { a: { ...stanceA, torso: 30, legF: 60, legF2: -90, legB: -50, legB2: 90 }, dy: 24 }), key(11, { a: { legF: 60, legF2: -90, legB: -50, legB2: 90, torso: 50, armF: -13, armF2: 0, armB: -60 }, dy: 26 }), key(17, { a: { legF: 60, legF2: -90, legB: -50, legB2: 90, torso: -40, armF: -13, armF2: 0, armB: 60 }, dy: 26 }), key(44, { a: stanceA, dy: 0 })], { smash: true }),
  nair: mv("nair", 32, [
    cap([5, 14], -80, -80, 80, -80, 16, 8, 45, 30, 70, { fx: "slash" }),
  ], [key(0, { a: { ...stanceA, armF: 100 } }), key(5, { a: { ...stanceA, torso: 0, armF: 90, armF2: 0, weapon: -10, legF: 30, legF2: -40, legB: -20, legB2: 40 } }), key(14, { a: { ...stanceA, torso: 0, armF: 450, armF2: 0, legF: 30, legF2: -40, legB: -20, legB2: 40 } }), key(32, { a: stanceA })], { aerial: true, landingLag: 8 }),
  fair: mv("fair", 40, [
    hb([9, 11], 150, -90, 14, tip(12), 42, 35, tipKb(90), T),
    cap([9, 11], 50, -92, 138, -90, 12, 12, 42, 35, 90, S),
  ], [key(0, { a: { ...stanceA, armF: 60, legF: 30, legF2: -40, legB: -20, legB2: 40 } }), key(8, { a: { ...lungePose, legF: 40, legF2: -30, legB: -30, legB2: 30 } }), key(13, { a: { ...lungePose, legF: 40, legF2: -30, legB: -30, legB2: 30 } }), key(40, { a: stanceA })], { aerial: true, landingLag: 12 }),
  bair: mv("bair", 34, [
    hb([8, 10], -150, -88, 14, tip(13), 35, 40, tipKb(95), T),
    cap([8, 10], -50, -90, -138, -88, 12, 13, 35, 40, 95, S),
  ], [key(0, { a: { ...stanceA, armF: 120, torso: 10, legF: 30, legF2: -40, legB: -20, legB2: 40 } }), key(7, { a: { torso: -30, armF: -68, armF2: 0, weapon: 0, armB: 40, legF: 40, legF2: -30, legB: -30, legB2: 30 } }), key(12, { a: { torso: -30, armF: -68, armF2: 0, legF: 40, legF2: -30, legB: -30, legB2: 30 } }), key(34, { a: stanceA })], { aerial: true, landingLag: 10 }),
  uair: mv("uair", 30, [
    hb([7, 10], 20, -230, 14, tip(9), 88, 30, tipKb(85), T),
    cap([7, 10], 10, -120, 18, -216, 12, 9, 88, 30, 85, S),
  ], [key(0, { a: { ...stanceA, armF: 120, legF: 30, legF2: -40, legB: -20, legB2: 40 } }), key(6, { a: { torso: -8, armF: 172, armF2: 0, weapon: 0, legF: 30, legF2: -40, legB: -20, legB2: 40 } }), key(11, { a: { torso: -8, armF: 172, armF2: 0, legF: 30, legF2: -40, legB: -20, legB2: 40 } }), key(30, { a: stanceA })], { aerial: true, landingLag: 8 }),
  dair: mv("dair", 44, [
    hb([12, 14], 14, 60, 14, tip(12), 270, 30, tipKb(85), { ...T, spike: true }),
    cap([12, 14], 8, -40, 12, 46, 12, 12, 60, 30, 85, S),
  ], [key(0, { a: { ...stanceA, armF: 120, legF: 30, legF2: -40, legB: -20, legB2: 40 } }), key(11, { a: { torso: 10, armF: -18, armF2: 0, weapon: 0, legF: 40, legF2: -60, legB: -30, legB2: 60 } }), key(16, { a: { torso: 10, armF: -18, armF2: 0, legF: 40, legF2: -60, legB: -30, legB2: 60 } }), key(44, { a: stanceA })], { aerial: true, landingLag: 14 }),
  grab: mv("grab", 32, [hb([6, 7], 52, -80, 22, 0, 0, 0, 0, { grab: true })], [key(0, { a: stanceA }), key(5, { a: { ...stanceA, torso: 14, armB: 98, armB2: 0 } }), key(10, { a: { ...stanceA, torso: 14, armB: 98, armB2: 0 } }), key(32, { a: stanceA })], { isGrab: true }),
  dashGrab: mv("dashGrab", 38, [hb([8, 9], 66, -80, 24, 0, 0, 0, 0, { grab: true })], [key(0, { a: stanceA }), key(7, { a: { ...stanceA, torso: 24, armB: 100, armB2: 0 }, dx: 10 }), key(12, { a: { ...stanceA, torso: 24, armB: 100 }, dx: 10 }), key(38, { a: stanceA, dx: 0 })], { isGrab: true, motion: [[1, 5, 0], [8, 0, 0]] }),
  pummel: mv("pummel", 14, [], [key(0, { a: { ...stanceA, armB: 98, armF: 60 } }), key(5, { a: { ...stanceA, armB: 98, armF: 110, armF2: -20 } }), key(14, { a: { ...stanceA, armB: 98, armF: 60 } })]),
  fthrow: throwMove("fthrow", 30, 12, 8, 45, 55, 65, [key(0, { a: { ...stanceA, armB: 98 } }), key(12, { a: { ...stanceA, torso: 20, armB: 130, armF: 100 }, dx: 8 }), key(30, { a: stanceA, dx: 0 })]),
  bthrow: throwMove("bthrow", 34, 14, 9, 40, 60, 75, [key(0, { a: { ...stanceA, armB: 98 } }), key(14, { a: { ...stanceA, torso: -30, armB: -82, armF: -60 } }), key(34, { a: stanceA })]),
  uthrow: throwMove("uthrow", 32, 14, 7, 90, 55, 60, [key(0, { a: { ...stanceA, armB: 98 } }), key(14, { a: { ...stanceA, torso: -10, armB: -172, armF: 172 } }), key(32, { a: stanceA })]),
  dthrow: throwMove("dthrow", 36, 16, 6, 60, 45, 50, [key(0, { a: { ...stanceA, armB: 98 } }), key(16, { a: { ...stanceA, torso: 40, armB: 53, armF: 30, legF: 50, legF2: -70, legB: -40, legB2: 70 }, dy: 20 }), key(36, { a: stanceA, dy: 0 })]),
  // Lunge: chargeable stab; full charge is a screen-length flash-step
  nspecial: mv("nspecial", 46, [
    hb([13, 16], 180, -86, 18, tip(12), 38, 40, tipKb(95), T),
    cap([13, 16], 55, -88, 166, -86, 13, 12, 38, 40, 95, S),
  ], [key(0, { a: { ...stanceA, torso: -16, armF: 0, armF2: -40, weapon: 0 }, dx: -14 }), key(12, { a: { ...lungePose, torso: 36, armF: 62 }, dx: 30 }), key(18, { a: { ...lungePose, torso: 36, armF: 62 }, dx: 30 }), key(46, { a: stanceA, dx: 0 })], { hook: "lunge", fx: "trail" }),
  // Passata: dash-slash, cancel into tilts/aerials on hit
  sspecial: mv("sspecial", 30, [
    cap([8, 13], 20, -90, 140, -84, 15, 9, 40, 35, 75, { fx: "slash" }),
  ], [key(0, { a: { ...stanceA, torso: 20 } }), key(7, { a: { ...lungePose, torso: 40, armF: 62, legF: 80 }, dx: 16 }), key(14, { a: { ...lungePose, torso: 40, armF: 62 }, dx: 16 }), key(30, { a: stanceA, dx: 0 })], { motion: [[1, 14, 0], [8, 8, 0], [13, 2, 0]], hook: "passata", ledgeOk: true, fx: "trail" }),
  // Rising Flourish: spiral up, multi-hit then a launcher
  uspecial: mv("uspecial", 46, [
    cap([6, 8], -60, -100, 60, -100, 18, 3, 80, 30, 40, { group: 1, fx: "slash" }),
    cap([10, 12], -60, -120, 60, -120, 18, 3, 80, 30, 40, { group: 2, fx: "slash" }),
    cap([14, 16], -60, -140, 60, -140, 18, 3, 80, 30, 40, { group: 3, fx: "slash" }),
    hb([18, 20], 10, -200, 26, 8, 80, 30, 95, { group: 4, fx: "tip" }),
  ], [key(0, { a: { ...stanceA, torso: 20, armF: 40, legF: 40, legF2: -60, legB: -30, legB2: 60 }, dy: 10 }), key(6, { a: { torso: -10, armF: 172, armF2: 0, weapon: 30, legF: 30, legF2: -40, legB: -20, legB2: 40 }, dy: 0 }), key(12, { a: { torso: -370, armF: 172, armF2: 0, legF: 30, legF2: -40, legB: -20, legB2: 40 } }), key(20, { a: { torso: -720, armF: 172, armF2: 0, legF: 30, legF2: -40, legB: -20, legB2: 40 } }), key(46, { a: { torso: -720, armF: -120, armB: 120, legF: 20, legF2: 20, legB: -20, legB2: 20 } })], { hook: "flourish", helpless: true, invuln: [4, 8], fx: "trail" }),
  // Riposte: counter stance
  dspecial: mv("dspecial", 50, [], [key(0, { a: { ...stanceA, torso: -10, armF: 96, armF2: 90, weapon: 0, armB: -20 } }), key(3, { a: { ...stanceA, torso: -14, armF: 96, armF2: 90, weapon: 0, armB: -20 } }), key(27, { a: { ...stanceA, torso: -14, armF: 96, armF2: 90, weapon: 0 } }), key(50, { a: stanceA })], { counter: { frames: [3, 27], move: "riposte", mul: 1.5, min: 8 }, fx: "guard" }),
  riposte: mv("riposte", 36, [
    cap([6, 9], 40, -90, 176, -84, 18, 8, 40, 50, 90, { fx: "tip", priority: 0 }),
  ], [key(0, { a: { ...stanceA, torso: -20, armF: 20, armF2: -40 }, dx: -8 }), key(5, { a: { ...lungePose, torso: 38, armF: 62 }, dx: 30 }), key(12, { a: { ...lungePose, torso: 38, armF: 62 }, dx: 30 }), key(36, { a: stanceA, dx: 0 })], { counterStrike: true, invuln: [1, 9], motion: [[5, 6, 0], [9, 0, 0]], fx: "trail" }),
  ledgeAttack: mv("ledgeAttack", 40, [cap([12, 15], 20, -70, 130, -80, 15, 9, 45, 40, 70, { fx: "slash" })], [key(0, { a: { ...stanceA, torso: 40 }, dy: 30 }), key(11, { a: { ...lungePose, torso: 20 }, dy: 0 }), key(17, { a: lungePose }), key(40, { a: stanceA })], { invuln: [1, 14] }),
  getupAttack: mv("getupAttack", 44, [
    cap([12, 14], 20, -50, 130, -60, 15, 7, 45, 40, 60, { group: 0, fx: "slash" }),
    cap([20, 22], -20, -50, -130, -60, 15, 7, 45, 40, 60, { group: 1, fx: "slash" }),
  ], [key(0, { a: { torso: -85, armF: -40, armB: -40 }, dy: 40 }), key(11, { a: { ...lungePose, torso: 40 }, dy: 10 }), key(19, { a: { ...lungePose, torso: -40, armF: -170 }, dy: 10 }), key(44, { a: stanceA, dy: 0 })], { invuln: [1, 22] }),
  taunt: mv("taunt", 60, [], [key(0, { a: { ...stanceA, armF: 120, armF2: 60, weapon: 0 } }), key(20, { a: { ...stanceA, armF: 130, armF2: 70, weapon: 0, torso: -8 } }), key(40, { a: { ...stanceA, armF: 130, armF2: 70, torso: -8 } }), key(60, { a: stanceA })]),
};

export const sable: FighterDef = {
  id: "sable",
  name: "SABLE",
  tagline: "The fencer. Space the tip, punish the greedy.",
  stats,
  moves,
  rig: {
    bones: humanoidBones({
      hipHeight: 62, torso: 44, head: 12, upperArm: 26, foreArm: 26, thigh: 32, shin: 30, thick: 6.5,
      colors: { torso: "coat", head: "skin", arms: "coat", legs: "trousers" },
      weapon: { len: 96, thick: 2.2, color: "blade", shape: "blade" },
      extras: [
        // coat tails hang from the hip, behind the legs; boots cap the shins; a hat brim on the head
        { name: "coatB", parent: "hip", len: 40, thick: 10, rest: 200, at: 1, color: "coatDark", shape: "capsule", z: 0.5 },
        { name: "coatF", parent: "hip", len: 30, thick: 9, rest: 165, at: 1, color: "coat", shape: "capsule", z: 3.5 },
        { name: "collar", parent: "torso", len: 6, thick: 9.5, rest: 0, at: 0.82, color: "coatDark", shape: "capsule", z: 3.6 },
        { name: "bootB", parent: "legB2", len: 10, thick: 6.5, rest: 60, at: 1, color: "boot", shape: "capsule", z: 1.1 },
        { name: "bootF", parent: "legF2", len: 10, thick: 6.5, rest: 60, at: 1, color: "boot", shape: "capsule", z: 4.1 },
        { name: "hat", parent: "head", len: 3, thick: 0, rest: 0, at: 0.92, color: "coatDark", shape: "slab", size: [40, 3], z: 5.5 },
        { name: "hatTop", parent: "head", len: 9, thick: 8, rest: -6, at: 1, color: "coatDark", shape: "capsule", z: 5.6 },
        { name: "guard", parent: "armF2", len: 2, thick: 0, rest: 0, at: 1, color: "gold", shape: "circle", size: 6, z: 7.5 },
      ],
    }),
    anims: { ...humanoidAnims(), idle: [key(0, { a: { ...stanceA, armF: 90, armF2: -10 } }), key(30, { a: { ...stanceA, torso: 10, armF: 94, armF2: -12 }, dy: 2 }), key(60, { a: { ...stanceA, armF: 90, armF2: -10 } })] },
    loops: humanoidLoops,
  },
  palette: {
    colors: { coat: "#8a3ffc", coatDark: "#5b21c9", trousers: "#4a2f8a", boot: "#1c1330", skin: "#f4f0ff", blade: "#e6e6f0", gold: "#ffd166", accent: "#f4f0ff" },
    accent: "skin",
    outline: "#12101a",
  },
  special: () => ({ charge: 0, passataHit: 0 }),
  hooks: {
    lunge: ({ f, input, state }) => {
      // hold to charge on frames 1..12; the pose holds while charging
      if (f.frame <= 12 && f.special.charge < 60 && (input.b & 4)) {
        f.special.charge++;
        if (f.frame === 12) f.frame = 11;
        return;
      }
      if (f.frame === 13) {
        const c = f.special.charge;
        const mul = 1 + c / 60;
        for (const h of f.special.charge >= 60 ? moves.nspecial.hitboxes : []) void h;
        f.chargeMul = mul;
        f.vx = f.moveFacing * (c >= 60 ? 28 : 6 + c * 0.15);
        if (c >= 60) f.invuln = Math.max(f.invuln, 6);
        f.special.charge = 0;
      }
      if (f.frame >= 13 && f.frame <= 16) { /* motion set on 13 */ }
      if (f.frame === 17) f.vx *= 0.3;
      void state;
    },
    passata: ({ f, input, state }) => {
      if (f.hitsThisMove > 0 && f.frame >= 12 && f.frame < 30) {
        // cancel window: any attack or aerial input
        const pressed = input.b & 2;
        if (pressed) {
          if (f.grounded) {
            const d = Math.abs(input.y) > Math.abs(input.x) ? (input.y < -25 ? "utilt" : input.y > 25 ? "dtilt" : "ftilt") : "ftilt";
            f.action = "idle"; f.move = null;
            f.buf |= 2;
            void d;
          } else {
            f.action = "air"; f.move = null;
            f.buf |= 2;
          }
        }
      }
      void state;
    },
    flourish: ({ f, input }) => {
      if (f.frame === 1) { f.vy = -9; f.grounded = false; f.platform = -1; f.usedUpSpecial = true; }
      if (f.frame >= 2 && f.frame <= 20) { f.vy = -7.5 + f.frame * 0.12; f.vx = f.moveFacing * 2.2 + (input.x / 100) * 1.4; }
    },
  },
  onHit: () => { void spawnProjectile; void setAction; },
};
