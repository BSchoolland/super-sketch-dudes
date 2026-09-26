// LAMPJACK — a desk lamp that floats on a propeller and fights with its own coiled cord.
// Drawn fighter exemplar: a plain ES module, no imports, everything from `api`.
//
// A drawn fighter has FOUR things to learn, and a player should know all four within seconds:
//   STRIKE   (attack button)        the cord whips out. Aimed forward, up or down; charged for the smash.
//   GIMMICK  (special button)       BULB FLASH: hold to charge, then a blinding burst around the shade.
//   RECOVERY (up + special)         the propeller lifts it back to the stage.
//   GRAB     (grab button)          the plug hooks them; the throw tosses them the way you hold.
// The engine has 22+ move slots; `aim()` fills them all from those four so every button feels like
// the move you already learned (same startup, same damage, just pointed somewhere else).
//
// Fighter space: +x is the facing direction, +y is DOWN, the origin is at the feet. Frames are 1-based.
// Hitboxes: hb([first,last], x, y, r, damage, angle, base, growth, extra); cap(...) is a capsule from
// (x,y) to (x2,y2). Angle 0 launches away from the attacker, 90 up, 270 down (a spike), 180 pulls in.
export default function make(api) {
  const { hb, cap, key, mv, throwMove, spawnProjectile, spriteAnims, spriteLoops, B } = api;

  const stats = {
    weight: 78, walk: 3.2, run: 5.6, dashInit: 6.5, airSpeed: 4.2, airAccel: 0.2,
    fallSpeed: 6.5, fastFall: 10, gravity: 0.4, shortHop: 8, fullHop: 13, doubleJump: 12,
    jumps: 3, wallJump: false, traction: 0.5, height: 120, width: 60, crouchHeight: 84, landLag: 4, ledgeReach: 40,
  };

  // Poses for a drawn fighter are squash/stretch/lean/offset on the whole cell (the cell itself is the drawing).
  const P = (extra) => ({ ...extra });
  const rest = P({});
  const strikePoses = (total, hit, lean, extra = {}) => [
    key(0, P({ rot: -lean * 0.5, sx: 0.96, sy: 1.04, ...extra })),
    key(hit, P({ rot: lean, sx: 1.1, sy: 0.94, ...extra })),
    key(Math.min(total - 1, hit + 6), P({ rot: lean * 0.8, sx: 1.04, sy: 0.98, ...extra })),
    key(total, rest),
  ];
  const CORD = { fx: "energy" };

  // THE STRIKE: the cord whips out from the shade (about 70 units up) to 130 units away, 12 damage.
  // `aim` points it: dir "f" forward, "u" up, "b" behind, "d" low along the floor.
  const STRIKE = { total: 32, hit: 9, active: 4, damage: 12, r: 18 };
  const aim = (id, dir, opts = {}) => {
    const s = { ...STRIKE, ...opts };
    const end = dir === "u" ? [20, -190] : dir === "b" ? [-130, -74] : dir === "d" ? [110, -12] : [130, -70];
    const start = dir === "u" ? [-20, -110] : dir === "b" ? [-30, -70] : dir === "d" ? [10, -18] : [30, -66];
    const angle = dir === "u" ? 88 : dir === "d" ? 34 : 42;
    const lean = dir === "u" ? -6 : dir === "b" ? -18 : dir === "d" ? 6 : 14;
    const extra = dir === "d" ? { sy: 0.86, dy: 10 } : dir === "u" ? { dy: -6 } : {};
    const cell = dir === "u" ? "atk-up" : dir === "d" ? "atk-down" : "atk-fwd";
    return mv(id, s.total, [cap([s.hit, s.hit + s.active - 1], start[0], start[1], end[0], end[1], s.r, s.damage, angle, s.base ?? 40, s.growth ?? 85, { ...CORD, ...(s.hb ?? {}) })],
      strikePoses(s.total, s.hit, lean, extra), { cell, cellFlip: dir === "b", ...(s.mv ?? {}) });
  };
  // GRAB and the throw, tossed the way you hold
  const GRAB = { total: 36, hit: 7, damage: 9 };
  const toss = (id, angle, base, growth, pose) => throwMove(id, 32, 14, GRAB.damage, angle, base, growth, [key(0, P({ rot: 6 })), key(14, P(pose)), key(32, rest)]);

  const moves = {
    // strike, forward: the quick versions on the ground and in the air
    jab1: aim("jab1", "f", { total: 24, hit: 6, damage: 7, mv: { iasa: 18 } }),
    ftilt: aim("ftilt", "f"),
    dashAttack: aim("dashAttack", "f", { total: 38, hit: 9, damage: 11, mv: { motion: [[1, 7, 0], [12, 4, 0], [20, 1, 0]] } }),
    nair: aim("nair", "f", { total: 30, hit: 7, damage: 9, mv: { aerial: true, landingLag: 10 } }),
    fair: aim("fair", "f", { mv: { aerial: true, landingLag: 12 } }),
    bair: aim("bair", "b", { damage: 13, mv: { aerial: true, landingLag: 12 } }),
    // strike, up
    utilt: aim("utilt", "u", { damage: 10 }),
    uair: aim("uair", "u", { damage: 10, mv: { aerial: true, landingLag: 10 } }),
    // strike, down: dair spikes
    dtilt: aim("dtilt", "d", { damage: 9 }),
    dair: aim("dair", "d", { total: 40, hit: 14, damage: 13, hb: { spike: true }, mv: { aerial: true, landingLag: 16, hover: [8, 13] } }),
    // the charged strike: bigger, slower, a sweetspot at the tip
    fsmash: mv("fsmash", 52, [
      cap([16, 19], 40, -70, 160, -60, 18, 19, 38, 45, 98, { fx: "tip", priority: 0 }),
      cap([16, 21], 20, -70, 100, -66, 22, 14, 40, 40, 82, { ...CORD, priority: 1 }),
    ], strikePoses(52, 16, 22), { smash: true }),
    usmash: aim("usmash", "u", { total: 50, hit: 15, active: 6, damage: 17, base: 42, growth: 100, mv: { smash: true } }),
    dsmash: mv("dsmash", 54, [
      cap([16, 19], 10, -20, 120, -20, 22, 16, 30, 45, 88, { ...CORD, group: 0 }),
      cap([22, 25], -10, -20, -120, -20, 22, 16, 30, 45, 88, { ...CORD, group: 1 }),
    ], [key(0, P({ sy: 0.9 })), key(16, P({ rot: 20, sx: 1.15, sy: 0.8 })), key(22, P({ rot: -20, sx: 1.15, sy: 0.8 })), key(54, rest)], { smash: true, cell: "atk-down" }),
    // grab: the plug hooks them
    grab: mv("grab", GRAB.total, [hb([GRAB.hit, GRAB.hit + 2], 60, -70, 26, 0, 0, 0, 0, { grab: true })], strikePoses(GRAB.total, GRAB.hit, 12), { isGrab: true }),
    dashGrab: mv("dashGrab", 42, [hb([9, 11], 74, -70, 28, 0, 0, 0, 0, { grab: true })], strikePoses(42, 9, 20), { isGrab: true, motion: [[1, 5, 0], [9, 0, 0]] }),
    pummel: mv("pummel", 16, [], [key(0, P({ rot: 6 })), key(6, P({ rot: 14, sx: 1.06 })), key(16, P({ rot: 6 }))]),
    fthrow: toss("fthrow", 45, 60, 72, { rot: 26, sx: 1.1 }),
    bthrow: toss("bthrow", 40, 65, 80, { rot: -40 }),
    uthrow: toss("uthrow", 90, 70, 92, { dy: -14, sy: 1.14 }),
    dthrow: toss("dthrow", 68, 45, 42, { sy: 0.8, sx: 1.15, dy: 16 }),
    // GIMMICK, BULB FLASH: hold to charge, then a blinding multi-hit burst around the shade
    nspecial: mv("nspecial", 64, [hb([26, 38], 0, -90, 62, 3, 80, 20, 40, { ...CORD, rehit: 4 }), hb([39, 41], 0, -90, 76, 8, 60, 45, 95, { fx: "heavy", group: 1 })], [key(0, P({ sy: 0.94 })), key(25, P({ sy: 0.88, sx: 1.08 })), key(26, P({ sy: 1.16, sx: 1.12 })), key(42, P({ sy: 1.02 })), key(64, rest)], { hook: "flash", cell: "atk-up", fx: "quake" }),
    // the gimmick with a direction held: the plug is thrown as a hook that pulls them in
    sspecial: mv("sspecial", 44, [], strikePoses(44, 12, 18), { hook: "cast" }),
    // the gimmick held down: the shade is a counter
    dspecial: mv("dspecial", 40, [], [key(0, rest), key(4, P({ sy: 0.9, sx: 1.05 })), key(24, P({ sy: 0.9, sx: 1.05 })), key(40, rest)], { counter: { frames: [4, 24], move: "blackoutStrike", mul: 1.5, min: 8 }, cell: "block", fx: "guard" }),
    blackoutStrike: aim("blackoutStrike", "f", { total: 36, hit: 8, damage: 14, base: 50, growth: 95, hb: { fx: "heavy" } }),
    // RECOVERY, PROPELLER LIFT: the propeller spins up and carries it, steerable
    uspecial: mv("uspecial", 58, [cap([4, 10], -30, -100, 30, -100, 36, 7, 80, 40, 60, CORD)], [key(0, P({ sy: 0.88, sx: 1.1 })), key(4, P({ sy: 1.14, sx: 0.92 })), key(30, P({ rot: 6 })), key(58, P({ rot: -10 }))], { hook: "lift", helpless: true, ledgeOk: true, cell: "jump" }),
    ledgeAttack: aim("ledgeAttack", "f", { total: 40, hit: 12, damage: 9 }),
    getupAttack: mv("getupAttack", 44, [cap([12, 15], 10, -40, 100, -40, 20, 7, 45, 40, 60, { ...CORD, group: 0 }), cap([20, 23], -10, -40, -100, -40, 20, 7, 45, 40, 60, { ...CORD, group: 1 })], [key(0, rest), key(12, P({ rot: 16 })), key(20, P({ rot: -16 })), key(44, rest)]),
    taunt: mv("taunt", 50, [], [key(0, rest), key(12, P({ rot: -14, sy: 1.1 })), key(26, P({ rot: 14, sy: 1.1 })), key(50, rest)]),
  };

  return {
    id: "lampjack", // replaced by the forge with the player's fighter id
    name: "LAMPJACK",
    tagline: "A desk lamp with a grudge and a very long cord.",
    stats,
    moves,
    rig: { anims: spriteAnims(), loops: spriteLoops },
    palette: { colors: { marker: "#c94a3c" }, outline: "#292722" },
    // every key must exist from the start: the state hash walks these
    special: () => ({ charge: 0, heat: 0 }),
    hooks: {
      flash: ({ f, input }) => {
        // hold special on frames 1..24 to charge (up to 60 frames); the burst scales with it
        if (f.frame <= 24 && f.special.charge < 60 && (input.b & B.SPECIAL)) {
          f.special.charge++;
          if (f.frame === 24) f.frame = 23;
          return;
        }
        if (f.frame === 25) {
          f.chargeMul = 1 + (f.special.charge / 60) * 0.8;
          f.special.heat = Math.min(100, f.special.heat + 30 + f.special.charge / 2);
          f.special.charge = 0;
        }
      },
      cast: ({ f, state }) => {
        if (f.frame === 12) {
          // angle 180: the hit pulls the victim back toward the lamp
          spawnProjectile(state, f, "hook", f.x + f.moveFacing * 40, f.y - 70, f.moveFacing * 11, -1.5, 40,
            { frames: [0, 999], x: 0, y: 0, r: 16, damage: 6, angle: 180, base: 30, growth: 20, fx: "energy" }, { g: 0.18 });
        }
      },
      lift: ({ f, input }) => {
        if (f.frame === 4) { f.grounded = false; f.platform = -1; f.usedUpSpecial = true; }
        if (f.frame >= 4 && f.frame <= 34) {
          f.vy = -7 + (f.frame - 4) * 0.18;
          f.vx = (input.x / 100) * 3.2;
        }
      },
    },
    onFrame: ({ f }) => { if (f.special.heat > 0) f.special.heat -= 0.15; },
    meters: [{ label: "HEAT", color: "#ffb920", get: (f) => f.special.heat / 100 }],
    visual: (f) => ({ glow: f.special.heat / 100 }),
  };
}
