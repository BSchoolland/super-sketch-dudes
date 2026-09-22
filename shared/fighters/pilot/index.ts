import type { FighterDef, Move, Stats } from "../../types";
import { cap, hb, key, mv, throwMove } from "../helpers";
import { humanoidAnims, humanoidBones, humanoidLoops } from "../humanoid";
import { spawnProjectile } from "../../hits";
import { setAction } from "../../fighter";
import { STICK_DEAD } from "../../input";
import { sign } from "../../fixed";

const stats: Stats = {
  weight: 95, walk: 3.9, run: 7.2, dashInit: 8.0, airSpeed: 4.6, airAccel: 0.2,
  fallSpeed: 8.0, fastFall: 12.5, gravity: 0.46, shortHop: 8.5, fullHop: 14, doubleJump: 13,
  jumps: 2, wallJump: false, traction: 0.6, height: 118, width: 56, crouchHeight: 72, landLag: 4, ledgeReach: 38,
};

const E = { fx: "energy" as const };
const stance = { torso: 6, legF: 18, legF2: -14, legB: -18, legB2: 16, armF: 60, armF2: -30, armB: -30, armB2: -50, weapon: 0 };
const S = (a: Record<string, number>, extra: { dx?: number; dy?: number; sx?: number; sy?: number } = {}) => ({ a: { ...stance, ...a }, ...extra });

const moves: Record<string, Move> = {
  jab1: mv("jab1", 20, [cap([5, 6], 40, -84, 100, -84, 14, 3, 60, 20, 40, E)], [key(0, S({})), key(4, S({ armF: 100, armF2: 0, torso: 12 }, { dx: 4 })), key(8, S({ armF: 100, armF2: 0, torso: 12 }, { dx: 4 })), key(20, S({}))], { iasa: 14, next: "jab2", nextFrom: 6 }),
  jab2: mv("jab2", 24, [cap([6, 7], 40, -80, 104, -80, 14, 3, 60, 20, 40, E)], [key(0, S({ armF: 80 })), key(5, S({ armF: 60, armB: -110, armB2: 0, torso: 14 }, { dx: 6 })), key(10, S({ armF: 60, armB: -110, armB2: 0, torso: 14 }, { dx: 6 })), key(24, S({}))], { iasa: 16, next: "jab3", nextFrom: 7 }),
  jab3: mv("jab3", 34, [cap([8, 10], 40, -84, 116, -84, 18, 6, 45, 40, 90, E)], [key(0, S({ armF: 40 })), key(7, S({ armF: 110, armF2: 0, torso: 24, legF: 50 }, { dx: 12 })), key(14, S({ armF: 110, armF2: 0, torso: 24 }, { dx: 12 })), key(34, S({}))]),
  ftilt: mv("ftilt", 30, [cap([9, 11], 40, -86, 126, -86, 18, 10, 40, 35, 80, E)], [key(0, S({ armF: 20, armF2: -60 })), key(8, S({ armF: 104, armF2: 0, torso: 24, legF: 60, legF2: -30 }, { dx: 14 })), key(12, S({ armF: 104, armF2: 0, torso: 24 }, { dx: 14 })), key(30, S({}))], { iasa: 26 }),
  utilt: mv("utilt", 28, [cap([7, 11], -30, -170, 40, -190, 22, 8, 90, 30, 85, E)], [key(0, S({ armF: 40 })), key(6, S({ armF: 200, armF2: 20, torso: -6 })), key(12, S({ armF: 200, armF2: 20, torso: -6 })), key(28, S({}))], { iasa: 24 }),
  dtilt: mv("dtilt", 24, [cap([6, 8], 30, -26, 110, -22, 16, 7, 30, 30, 65, E)], [key(0, S({ legF: 60, legF2: -90, legB: -50, legB2: 90, torso: 26 }, { dy: 24 })), key(5, S({ legF: 60, legF2: -90, legB: -50, legB2: 90, torso: 44, armF: 130, armF2: 10 }, { dy: 26 })), key(10, S({ legF: 60, legF2: -90, legB: -50, legB2: 90, torso: 44, armF: 130 }, { dy: 26 })), key(24, S({}))], { iasa: 20 }),
  dashAttack: mv("dashAttack", 38, [cap([10, 15], 20, -70, 100, -60, 22, 11, 50, 50, 65, E)], [key(0, S({ torso: 30 })), key(9, S({ torso: 50, armF: 120, armF2: 0, legF: 80, legF2: -30 }, { dx: 18 })), key(16, S({ torso: 50, armF: 120 }, { dx: 18 })), key(38, S({}))], { motion: [[1, 10, 0], [10, 6, 0], [16, 1, 0]], fx: "trail" }),
  fsmash: mv("fsmash", 50, [cap([16, 19], 40, -90, 146, -84, 24, 17, 40, 45, 95, E)], [key(0, S({ armF: 0, armF2: -90, torso: -10 }, { dx: -10 })), key(15, S({ armF: 110, armF2: 0, torso: 34, legF: 70, legF2: -30, legB: -40 }, { dx: 24 })), key(22, S({ armF: 110, armF2: 0, torso: 34 }, { dx: 24 })), key(50, S({}))], { smash: true }),
  usmash: mv("usmash", 46, [cap([12, 17], -30, -140, 30, -210, 26, 15, 92, 40, 100, E)], [key(0, S({ armF: 30, torso: 16 }, { dy: 10 })), key(11, S({ armF: 210, armF2: 10, torso: -8 }, { dy: -8, sy: 1.08 })), key(18, S({ armF: 210, armF2: 10, torso: -8 })), key(46, S({}))], { smash: true, fx: "thrust" }),
  dsmash: mv("dsmash", 48, [
    cap([14, 16], 30, -26, 120, -22, 18, 14, 30, 40, 90, { ...E, group: 0 }),
    cap([20, 22], -30, -26, -120, -22, 18, 14, 30, 40, 90, { ...E, group: 1 }),
  ], [key(0, S({ legF: 60, legF2: -90, legB: -50, legB2: 90, torso: 30 }, { dy: 24 })), key(13, S({ legF: 60, legF2: -90, legB: -50, legB2: 90, torso: 50, armF: 130, armF2: 10 }, { dy: 26 })), key(19, S({ legF: 60, legF2: -90, legB: -50, legB2: 90, torso: -40, armF: -130, armF2: -10 }, { dy: 26 })), key(48, S({}))], { smash: true }),
  nair: mv("nair", 34, [cap([6, 12], -70, -76, 70, -76, 20, 9, 50, 30, 70, { ...E, group: 0 }), cap([13, 18], -70, -76, 70, -76, 20, 6, 50, 25, 60, { ...E, group: 1, priority: 2 })], [key(0, S({})), key(6, S({ torso: 0, armF: 90, armF2: 0, legF: 30, legF2: -40, legB: -20, legB2: 40 })), key(18, S({ torso: 0, armF: 450, armF2: 0, legF: 30, legF2: -40, legB: -20, legB2: 40 })), key(34, S({}))], { aerial: true, landingLag: 8 }),
  fair: mv("fair", 42, [cap([11, 14], 30, -100, 120, -70, 22, 13, 45, 40, 90, E)], [key(0, S({ armF: 160, armF2: -40, torso: -10 })), key(10, S({ armF: 90, armF2: 20, torso: 30, legF: 40, legF2: -30 })), key(16, S({ armF: 90, armF2: 20, torso: 30 })), key(42, S({}))], { aerial: true, landingLag: 14 }),
  bair: mv("bair", 36, [cap([9, 11], -40, -70, -120, -60, 20, 12, 35, 40, 95, E)], [key(0, S({ legB: -10 })), key(8, S({ torso: -30, legB: -120, legB2: 10, armF: 40, armB: 60 })), key(14, S({ torso: -30, legB: -120, legB2: 10 })), key(36, S({}))], { aerial: true, landingLag: 12, fx: "thrust" }),
  uair: mv("uair", 32, [cap([8, 11], -20, -170, 30, -200, 22, 10, 85, 30, 85, E)], [key(0, S({ armF: 60 })), key(7, S({ armF: 210, armF2: 10, torso: -6, legF: 30, legF2: -40, legB: -20, legB2: 40 })), key(13, S({ armF: 210, armF2: 10, torso: -6 })), key(32, S({}))], { aerial: true, landingLag: 8 }),
  dair: mv("dair", 46, [hb([13, 15], 6, 30, 22, 12, 270, 25, 85, { ...E, spike: true })], [key(0, S({ legF: 30, legF2: -40 })), key(12, S({ legF: 10, legF2: 0, legB: 0, legB2: 0, torso: 10, armF: 200, armB: -200 }, { sy: 1.1 })), key(18, S({ legF: 10, legF2: 0, legB: 0, legB2: 0, torso: 10, armF: 200, armB: -200 })), key(46, S({}))], { aerial: true, landingLag: 16, hover: [8, 12], fx: "thrust" }),
  grab: mv("grab", 34, [hb([7, 8], 50, -78, 22, 0, 0, 0, 0, { grab: true })], [key(0, S({})), key(6, S({ armB: -110, armB2: 0, torso: 14 })), key(11, S({ armB: -110, armB2: 0, torso: 14 })), key(34, S({}))], { isGrab: true }),
  dashGrab: mv("dashGrab", 40, [hb([9, 10], 64, -78, 24, 0, 0, 0, 0, { grab: true })], [key(0, S({ torso: 20 })), key(8, S({ armB: -120, armB2: 0, torso: 26 }, { dx: 10 })), key(13, S({ armB: -120, torso: 26 }, { dx: 10 })), key(40, S({}))], { isGrab: true, motion: [[1, 5, 0], [9, 0, 0]] }),
  pummel: mv("pummel", 14, [], [key(0, S({ armB: -100, armF: 60 })), key(5, S({ armB: -100, armF: 110, armF2: -10 })), key(14, S({ armB: -100, armF: 60 }))]),
  fthrow: throwMove("fthrow", 30, 12, 8, 45, 55, 65, [key(0, S({ armB: -100 })), key(12, S({ torso: 20, armB: -160, armF: 140 }, { dx: 8 })), key(30, S({}))]),
  bthrow: throwMove("bthrow", 34, 14, 9, 40, 60, 75, [key(0, S({ armB: -100 })), key(14, S({ torso: -30, armB: 160, armF: -100 })), key(34, S({}))]),
  uthrow: throwMove("uthrow", 32, 14, 7, 90, 60, 60, [key(0, S({ armB: -100 })), key(14, S({ torso: -10, armB: -190, armF: 190 })), key(32, S({}))]),
  dthrow: throwMove("dthrow", 36, 16, 6, 65, 45, 50, [key(0, S({ armB: -100 })), key(16, S({ torso: 40, armB: -30, armF: 60, legF: 50, legF2: -70, legB: -40, legB2: 70 }, { dy: 20 })), key(36, S({}))]),
  // Slug: one round, a heavy homing slug. Reloads on the ground.
  nspecial: mv("nspecial", 32, [], [key(0, S({ armB: -60, armB2: -40, torso: -6 })), key(10, S({ armB: -100, armB2: 0, torso: 8 }, { dx: -6 })), key(14, S({ armB: -100, armB2: 0, torso: 8 }, { dx: -6 })), key(32, S({}))], { hook: "slug", ledgeOk: true }),
  // Crescent Wave: a wall of light along the ground
  sspecial: mv("sspecial", 44, [], [key(0, S({ armF: 20, armF2: -60, torso: -10 }, { dx: -8 })), key(9, S({ armF: 110, armF2: 0, torso: 30, legF: 60, legF2: -30 }, { dx: 16 })), key(18, S({ armF: 110, armF2: 0, torso: 30 }, { dx: 16 })), key(44, S({}))], { hook: "wave", ledgeOk: true }),
  // Launch: rocket burn with a fuel tank, steerable, not helpless
  uspecial: mv("uspecial", 140, [hb([4, 7], 0, -40, 40, 6, 70, 40, 50, E)], [key(0, S({ legF: 30, legF2: -40, legB: -30, legB2: 40, torso: 12 }, { dy: 8 })), key(4, S({ legF: 10, legF2: 10, legB: -10, legB2: 10, torso: -6, armF: -140, armB: 140 }, { sy: 1.1, sx: 0.92 })), key(140, S({ legF: 10, legF2: 10, legB: -10, legB2: 10, torso: -6, armF: -140, armB: 140 }))], { hook: "launch", invuln: [4, 7], ledgeOk: true, fx: "thrust" }),
  // Debris: drop a chunk that bounces and lingers; hit it to send it flying
  dspecial: mv("dspecial", 40, [], [key(0, S({ armB: -40, armB2: -80 })), key(12, S({ armB: -150, armB2: -20, torso: 10 })), key(18, S({ armB: -150, armB2: -20, torso: 10 })), key(40, S({}))], { hook: "debris", ledgeOk: true }),
  ledgeAttack: mv("ledgeAttack", 40, [cap([12, 15], 20, -70, 120, -80, 18, 9, 45, 40, 70, E)], [key(0, S({ torso: 40 }, { dy: 30 })), key(11, S({ armF: 110, armF2: 0, torso: 20 })), key(17, S({ armF: 110, armF2: 0 })), key(40, S({}))], { invuln: [1, 14] }),
  getupAttack: mv("getupAttack", 44, [cap([12, 14], 20, -50, 120, -60, 18, 7, 45, 40, 60, { ...E, group: 0 }), cap([20, 22], -20, -50, -120, -60, 18, 7, 45, 40, 60, { ...E, group: 1 })], [key(0, S({ torso: -85, armF: -40, armB: -40 }, { dy: 40 })), key(11, S({ armF: 110, torso: 40 }, { dy: 10 })), key(19, S({ armF: -110, torso: -40 }, { dy: 10 })), key(44, S({}))], { invuln: [1, 22] }),
  taunt: mv("taunt", 60, [], [key(0, S({})), key(20, S({ torso: -8, armF: 30, armF2: -80, legF: 10 }, { dy: -4 })), key(40, S({ torso: -8, armF: 30, armF2: -80 }, { dy: -4 })), key(60, S({}))]),
};

const ROUNDS = 6, RELOAD = 90, FUEL_MAX = 100;

export const pilot: FighterDef = {
  id: "pilot",
  name: "PILOT",
  tagline: "The Kessler homage. Own the space between you.",
  stats,
  moves,
  rig: {
    bones: humanoidBones({
      hipHeight: 58, torso: 42, head: 13, upperArm: 24, foreArm: 24, thigh: 30, shin: 28, thick: 7,
      colors: { torso: "hull", head: "hull", arms: "hull", legs: "hullDark" },
      weapon: { len: 44, thick: 7, color: "crescent", shape: "blade" },
      extras: [
        { name: "nacelleB", parent: "torso", len: 30, thick: 8, rest: 150, at: 0.85, color: "hullDark", z: 2.5 },
        { name: "nacelleF", parent: "torso", len: 30, thick: 8, rest: 210, at: 0.85, color: "hullDark", z: 2.6 },
        { name: "chest", parent: "torso", len: 22, thick: 12, rest: 0, at: 0.35, color: "cyan", z: 3.2 },
        { name: "nose", parent: "head", len: 22, thick: 6, rest: 100, at: 0.7, color: "hull", z: 5.2 },
        { name: "visor", parent: "head", len: 16, thick: 5, rest: 90, at: 0.55, color: "visor", z: 5.3 },
        { name: "gun", parent: "armB2", len: 26, thick: 5.5, rest: 0, at: 1, color: "hullDark", z: 2.2 },
        { name: "gunTip", parent: "gun", len: 3, thick: 0, rest: 0, at: 1, color: "hazard", shape: "circle", size: 4, z: 2.3 },
        { name: "bootB", parent: "legB2", len: 12, thick: 7, rest: 60, at: 1, color: "hazard", z: 1.1 },
        { name: "bootF", parent: "legF2", len: 12, thick: 7, rest: 60, at: 1, color: "hazard", z: 4.1 },
      ],
    }),
    anims: { ...humanoidAnims(), idle: [key(0, S({})), key(30, S({ torso: 9, armF: 64, armB: -34 }, { dy: 2 })), key(60, S({}))] },
    loops: humanoidLoops,
  },
  palette: {
    colors: { hull: "#eef7ff", hullDark: "#7fa6c7", cyan: "#35e0ff", hazard: "#ff8c1a", visor: "#0b1c2a", crescent: "#9cf3ff", accent: "#35e0ff" },
    accent: "cyan",
    outline: "#0b1c2a",
  },
  special: () => ({ rounds: ROUNDS, reload: 0, fuel: FUEL_MAX, chunk: 0, burn: 0 }),
  hooks: {
    slug: ({ f, state }) => {
      if (f.frame === 12) {
        if (f.special.rounds <= 0) { state.events.push({ t: "sfx", frame: state.frame, slot: f.slot, name: "click", x: f.x, y: f.y - 80 }); return; }
        f.special.rounds--;
        spawnProjectile(state, f, "slug", f.x + f.moveFacing * 40, f.y - 84, f.moveFacing * 9, -0.5, 110, { frames: [0, 999], x: 0, y: 0, r: 11, damage: 8, angle: 40, base: 35, growth: 60, fx: "energy" }, { homing: 0.08, homeFrames: 60, g: 0.05 });
      }
    },
    wave: ({ f, state }) => {
      if (f.frame === 10) {
        const air = !f.grounded;
        spawnProjectile(state, f, "wave", f.x + f.moveFacing * 50, f.y - (air ? 60 : 70), f.moveFacing * 8, air ? 2.5 : 0, air ? 14 : 24, { frames: [0, 999], x: 0, y: 0, r: air ? 40 : 70, damage: 10, angle: 30, base: 50, growth: 55, fx: "energy" }, { reflector: 1, g: air ? 0.4 : 0 });
      }
    },
    launch: ({ f, input, state }) => {
      if (f.frame === 1) {
        if (f.special.fuel <= 5) { setAction(f, f.grounded ? "idle" : "air"); return; }
        f.usedUpSpecial = true;
        f.special.burn = 1;
        f.grounded = false; f.platform = -1;
        f.vy = Math.min(f.vy, -3);
      }
      if (f.frame >= 4) {
        const held = (input.b & 4) !== 0;
        const burning = f.special.fuel > 0 && (held || f.frame < 10);
        if (burning) {
          const sx = Math.abs(input.x) >= STICK_DEAD ? input.x / 100 : 0;
          const sy = input.y <= -30 ? -1 : input.y >= 60 ? 0.2 : -0.75;
          f.vy += sy * 1.6;
          f.vy = Math.max(f.vy, -13);
          f.vx += sx * 0.55;
          if (Math.abs(f.vx) > 7) f.vx = sign(f.vx) * 7;
          if (sx !== 0) { f.facing = sign(sx) as 1 | -1; f.moveFacing = f.facing; }
          f.special.fuel = Math.max(0, f.special.fuel - 2);
          if (state.frame % 3 === 0) state.events.push({ t: "sfx", frame: state.frame, slot: f.slot, name: "thrust", x: f.x, y: f.y });
        } else {
          f.special.burn = 0;
          setAction(f, "air");
        }
      }
    },
    debris: ({ f, state }) => {
      if (f.frame === 12) {
        if (state.projectiles.some((p) => p.owner === f.slot && p.kind === "chunk")) return;
        spawnProjectile(state, f, "chunk", f.x + f.moveFacing * 30, f.y - 90, f.moveFacing * 3, -4, 150, { frames: [0, 999], x: 0, y: 0, r: 18, damage: 7, angle: 60, base: 30, growth: 60, fx: "heavy" }, { g: 0.45, bounce: 2, hittable: 1 });
      }
    },
  },
  onFrame: ({ f }) => {
    if (f.grounded) {
      f.special.fuel = Math.min(FUEL_MAX, f.special.fuel + 1);
      if (f.special.rounds < ROUNDS) { f.special.reload++; if (f.special.reload >= RELOAD) { f.special.reload = 0; f.special.rounds++; } }
    }
    if (f.action !== "attack" || f.move !== "uspecial") f.special.burn = 0;
  },
  meters: [
    { label: "FUEL", color: "#ff8c1a", get: (f) => f.special.fuel / FUEL_MAX },
    { label: "ROUNDS", color: "#35e0ff", get: (f) => f.special.rounds / ROUNDS },
  ],
};
