// GEARSHIFT — a hatchback that folds into a mech and back. Down-special transforms.
// MECH: heavy, slow, big fists, a rocket punch and a jump jet. CAR: fast, low, slippery, rams
// and wheelies, drives on NITRO it builds by going fast. Nitro carries across forms: the car
// earns it, either form can spend it.
// Fighter space: +x is the facing direction, +y is DOWN, the origin is at the feet. Frames are 1-based.
export default function make(api) {
  const { hb, cap, key, mv, throwMove, spawnProjectile, spriteAnims, spriteLoops, B, sign } = api;

  const stats = {
    weight: 118, walk: 3.0, run: 5.0, dashInit: 5.5, airSpeed: 3.6, airAccel: 0.18,
    fallSpeed: 7, fastFall: 11, gravity: 0.46, shortHop: 8, fullHop: 14, doubleJump: 13,
    jumps: 2, wallJump: false, traction: 0.55, height: 130, width: 64, crouchHeight: 90, landLag: 5, ledgeReach: 40,
  };
  // the car is 2/3 the height, twice the width, and slides: low traction is the whole handling model
  const carStats = {
    walk: 5.5, run: 9.5, dashInit: 9, airSpeed: 6, airAccel: 0.12, fallSpeed: 8, fastFall: 12, gravity: 0.5,
    shortHop: 6, fullHop: 10, doubleJump: 8, traction: 0.12, height: 86, width: 130, crouchHeight: 70, landLag: 3, ledgeReach: 20,
  };

  const P = (extra) => ({ a: {}, ...extra });
  const rest = P({});
  const strike = (total, hit, lean, extra = {}) => [
    key(0, P({ rot: -lean * 0.5, sx: 0.96, sy: 1.04, ...extra })),
    key(hit, P({ rot: lean, sx: 1.1, sy: 0.94, ...extra })),
    key(Math.min(total - 1, hit + 6), P({ rot: lean * 0.8, sx: 1.04, sy: 0.98, ...extra })),
    key(total, rest),
  ];
  // the car doesn't lean from the feet like a biped: it dips its nose (dy/sy) and stretches along the ground
  const lunge = (total, hit, stretch, extra = {}) => [
    key(0, P({ sx: 0.94, sy: 1.06, ...extra })),
    key(hit, P({ sx: stretch, sy: 2 - stretch, ...extra })),
    key(Math.min(total - 1, hit + 6), P({ sx: 1 + (stretch - 1) * 0.5, sy: 1, ...extra })),
    key(total, rest),
  ];
  const HEAVY = { fx: "heavy" };
  const TIRE = { fx: "energy" };
  const TF_FRAMES = 27;
  const tfCells = (dir) => Array.from({ length: 9 }, (_, i) => [i * 3 + 1, `tf${dir > 0 ? i + 1 : 9 - i}`]);

  const mech = {
    jab1: mv("jab1", 22, [hb([5, 7], 78, -92, 26, 4, 60, 25, 55, HEAVY)], strike(22, 5, 8), { iasa: 16, next: "jab2", nextFrom: 8 }),
    jab2: mv("jab2", 26, [hb([6, 8], 88, -96, 28, 6, 45, 35, 75, HEAVY)], strike(26, 6, 12), { iasa: 20 }),
    ftilt: mv("ftilt", 34, [cap([10, 13], 30, -100, 120, -84, 26, 11, 40, 40, 85, HEAVY)], strike(34, 10, 16)),
    utilt: mv("utilt", 32, [cap([8, 12], 10, -110, 30, -190, 26, 9, 88, 40, 90, HEAVY)], strike(32, 8, -8, { dy: -6, sy: 1.08 }), { cell: "atk-up" }),
    dtilt: mv("dtilt", 28, [cap([7, 10], 20, -20, 100, -14, 22, 8, 30, 30, 70, HEAVY)], strike(28, 7, 10, { sy: 0.86, dy: 8 }), { cell: "atk-down" }),
    dashAttack: mv("dashAttack", 42, [hb([9, 16], 50, -90, 40, 11, 55, 55, 65, HEAVY)], strike(42, 9, 26, { sx: 1.08 }), { motion: [[1, 6, 0], [12, 3, 0], [20, 1, 0]] }),
    fsmash: mv("fsmash", 54, [
      hb([17, 20], 118, -96, 30, 19, 38, 45, 98, { ...HEAVY, fx: "tip", priority: 0 }),
      cap([17, 22], 40, -96, 100, -96, 28, 14, 40, 40, 82, { ...HEAVY, priority: 1 }),
    ], strike(54, 17, 24, { sx: 1.12 }), { smash: true }),
    usmash: mv("usmash", 52, [cap([16, 21], -10, -120, 20, -215, 34, 17, 88, 42, 102, HEAVY)], strike(52, 16, -10, { dy: -14, sy: 1.14 }), { smash: true, cell: "atk-up" }),
    dsmash: mv("dsmash", 56, [
      cap([17, 20], 10, -20, 120, -16, 26, 16, 30, 45, 90, { ...HEAVY, group: 0 }),
      cap([23, 26], -10, -20, -120, -16, 26, 16, 30, 45, 90, { ...HEAVY, group: 1 }),
    ], [key(0, P({ sy: 0.9 })), key(17, P({ rot: 16, sx: 1.15, sy: 0.8, dy: 8 })), key(23, P({ rot: -16, sx: 1.15, sy: 0.8, dy: 8 })), key(56, rest)], { smash: true, cell: "atk-down" }),
    nair: mv("nair", 38, [hb([6, 22], 0, -80, 62, 9, 55, 30, 68, { ...HEAVY, group: 0 })], [key(0, rest), key(6, P({ rot: 90 })), key(24, P({ rot: 420 })), key(38, P({ rot: 720 }))], { aerial: true, landingLag: 12, cell: "jump" }),
    fair: mv("fair", 40, [cap([11, 15], 30, -80, 110, -60, 28, 13, 40, 40, 88, HEAVY)], strike(40, 11, 18), { aerial: true, landingLag: 14 }),
    bair: mv("bair", 36, [cap([9, 12], -30, -96, -120, -100, 28, 14, 35, 45, 92, HEAVY)], strike(36, 9, -18), { aerial: true, landingLag: 13, cell: "atk-fwd", cellFlip: true }),
    uair: mv("uair", 34, [cap([8, 12], -30, -160, 30, -200, 30, 11, 85, 35, 86, HEAVY)], strike(34, 8, -4, { dy: -8 }), { aerial: true, landingLag: 10, cell: "atk-up" }),
    dair: mv("dair", 48, [
      cap([16, 19], -16, 4, 16, 4, 30, 15, 270, 25, 92, { ...HEAVY, spike: true, priority: 0 }),
      cap([20, 26], -16, 4, 16, 4, 26, 10, 60, 30, 75, { ...HEAVY, priority: 1 }),
    ], [key(0, P({ sy: 1.08 })), key(15, P({ sy: 0.86, sx: 1.12, dy: 6 })), key(28, P({ sy: 0.94 })), key(48, rest)], { aerial: true, landingLag: 22, hover: [10, 15], cell: "atk-down" }),
    grab: mv("grab", 36, [hb([7, 9], 64, -90, 30, 0, 0, 0, 0, { grab: true })], strike(36, 7, 12), { isGrab: true }),
    dashGrab: mv("dashGrab", 42, [hb([9, 11], 80, -90, 32, 0, 0, 0, 0, { grab: true })], strike(42, 9, 20), { isGrab: true, motion: [[1, 5, 0], [9, 0, 0]] }),
    pummel: mv("pummel", 16, [], [key(0, P({ rot: 6 })), key(6, P({ rot: 14, sx: 1.06 })), key(16, P({ rot: 6 }))]),
    fthrow: throwMove("fthrow", 32, 14, 10, 45, 60, 72, [key(0, P({ rot: 6 })), key(14, P({ rot: 26, sx: 1.1 })), key(32, rest)]),
    bthrow: throwMove("bthrow", 40, 18, 12, 40, 65, 80, [key(0, P({ rot: 6 })), key(18, P({ rot: -40 })), key(40, rest)]),
    uthrow: throwMove("uthrow", 36, 16, 9, 90, 70, 92, [key(0, P({ rot: 6 })), key(16, P({ dy: -14, sy: 1.14 })), key(36, rest)]),
    dthrow: throwMove("dthrow", 40, 20, 8, 68, 45, 42, [key(0, P({ rot: 6 })), key(20, P({ sy: 0.8, sx: 1.15, dy: 16 })), key(40, rest)]),
    // ROCKET PUNCH: the fist flies. With 40+ nitro it's a bigger, faster fist.
    nspecial: mv("nspecial", 44, [], [key(0, P({ rot: -8 })), key(14, P({ rot: 18, sx: 1.14, sy: 0.92 })), key(30, P({ rot: 6 })), key(44, rest)], { hook: "rocketPunch" }),
    // SHOULDER CHARGE: a wheel-first tackle with armour on the way in
    sspecial: mv("sspecial", 46, [hb([8, 22], 40, -100, 44, 12, 40, 50, 78, HEAVY)], strike(46, 8, 28, { sx: 1.1, sy: 0.94 }), { motion: [[6, 9, 0], [14, 5, 0], [22, 1, 0]], armour: { frames: [6, 22], threshold: 9 } }),
    // JUMP JET: the exhausts fire
    uspecial: mv("uspecial", 56, [cap([4, 10], -30, -90, 30, -90, 34, 7, 80, 40, 60, TIRE)], [key(0, P({ sy: 0.88, sx: 1.1 })), key(4, P({ sy: 1.14, sx: 0.92 })), key(30, P({ rot: 6 })), key(56, P({ rot: -10 }))], { hook: "jumpJet", helpless: true, ledgeOk: true, cell: "jump" }),
    // TRANSFORM to car: 9 frames of the strip, 3 sim frames each. Armoured, so a jab doesn't undo it.
    dspecial: mv("dspecial", TF_FRAMES, [], [key(0, rest), key(TF_FRAMES, rest)], { hook: "toCar", cells: tfCells(1), armour: { frames: [1, TF_FRAMES], threshold: 10 }, fx: "quake" }),
    ledgeAttack: mv("ledgeAttack", 40, [cap([12, 16], 10, -60, 100, -70, 24, 9, 45, 40, 65, HEAVY)], strike(40, 12, 14)),
    getupAttack: mv("getupAttack", 44, [cap([12, 15], 10, -40, 100, -40, 22, 7, 45, 40, 60, { ...HEAVY, group: 0 }), cap([20, 23], -10, -40, -100, -40, 22, 7, 45, 40, 60, { ...HEAVY, group: 1 })], [key(0, rest), key(12, P({ rot: 16 })), key(20, P({ rot: -16 })), key(44, rest)]),
    taunt: mv("taunt", 50, [], [key(0, rest), key(12, P({ rot: -10, sy: 1.08 })), key(26, P({ rot: 10, sy: 1.08 })), key(50, rest)]),
  };

  // Car space: nose at +66, roof at -86, bumper height about -34.
  const car = {
    jab1: mv("jab1", 18, [hb([4, 6], 74, -34, 26, 4, 50, 25, 50, TIRE)], lunge(18, 4, 1.08), { iasa: 13, cell: "car-atk-fwd" }),
    ftilt: mv("ftilt", 30, [cap([7, 12], 30, -36, 96, -34, 26, 10, 38, 40, 82, TIRE)], lunge(30, 7, 1.18), { motion: [[5, 5, 0], [12, 1, 0]], cell: "car-atk-fwd" }),
    utilt: mv("utilt", 30, [cap([8, 12], 20, -70, 50, -140, 30, 9, 85, 40, 88, TIRE)], [key(0, P({ sy: 0.94 })), key(8, P({ rot: -22, sy: 1.08 })), key(16, P({ rot: -18 })), key(30, rest)], { cell: "car-atk-up" }),
    dtilt: mv("dtilt", 26, [cap([6, 10], -20, -16, 90, -12, 24, 8, 28, 30, 70, TIRE)], [key(0, rest), key(6, P({ sy: 0.72, sx: 1.2, dy: 6 })), key(16, P({ sy: 0.88, sx: 1.08 })), key(26, rest)], { cell: "car-atk-down" }),
    // FULL RAM: the car keeps its speed and adds more; the hit is the whole front end
    dashAttack: mv("dashAttack", 40, [cap([6, 18], 20, -40, 90, -36, 34, 12, 45, 60, 70, HEAVY)], lunge(40, 6, 1.24), { motion: [[1, 9, 0], [12, 5, 0], [20, 2, 0]], cell: "car-atk-fwd" }),
    // BURNOUT: charge the smash, then launch off the line
    fsmash: mv("fsmash", 50, [
      hb([14, 17], 100, -36, 32, 18, 36, 45, 96, { ...HEAVY, fx: "tip", priority: 0 }),
      cap([14, 20], 30, -38, 90, -36, 30, 13, 40, 40, 80, { ...HEAVY, priority: 1 }),
    ], lunge(50, 14, 1.3), { smash: true, motion: [[12, 8, 0], [18, 4, 0], [24, 1, 0]], cell: "car-atk-fwd" }),
    // HOOD POP: the hood flings open, launching straight up
    usmash: mv("usmash", 50, [cap([15, 20], 10, -70, 40, -180, 36, 16, 88, 42, 100, HEAVY)], [key(0, P({ sy: 0.9 })), key(15, P({ rot: -28, sy: 1.16, dy: -6 })), key(26, P({ rot: -20 })), key(50, rest)], { smash: true, cell: "car-atk-up" }),
    // DONUT: a full spin, both bumpers
    dsmash: mv("dsmash", 54, [
      cap([15, 18], 10, -34, 110, -30, 28, 15, 30, 45, 88, { ...HEAVY, group: 0 }),
      cap([21, 24], -10, -34, -110, -30, 28, 15, 30, 45, 88, { ...HEAVY, group: 1 }),
    ], [key(0, P({ sy: 0.9 })), key(15, P({ rot: 20, sx: 1.2, sy: 0.82 })), key(21, P({ rot: -20, sx: 1.2, sy: 0.82 })), key(54, rest)], { smash: true, cell: "car-atk-down" }),
    // BARREL ROLL
    nair: mv("nair", 36, [hb([5, 22], 0, -46, 64, 9, 55, 30, 66, { ...TIRE, group: 0 })], [key(0, rest), key(5, P({ rot: 90 })), key(22, P({ rot: 420 })), key(36, P({ rot: 720 }))], { aerial: true, landingLag: 10, cell: "car-jump" }),
    fair: mv("fair", 36, [cap([9, 13], 30, -50, 100, -30, 30, 12, 40, 40, 86, TIRE)], [key(0, rest), key(9, P({ rot: 24, sx: 1.16 })), key(20, P({ rot: 10 })), key(36, rest)], { aerial: true, landingLag: 12, cell: "car-atk-fwd" }),
    bair: mv("bair", 34, [cap([8, 11], -30, -44, -110, -40, 30, 14, 35, 45, 90, TIRE)], [key(0, rest), key(8, P({ rot: -22, sx: 1.14 })), key(20, P({ rot: -8 })), key(34, rest)], { aerial: true, landingLag: 12, cell: "car-atk-fwd", cellFlip: true }),
    uair: mv("uair", 34, [cap([8, 12], -30, -100, 30, -150, 32, 11, 85, 35, 84, TIRE)], [key(0, rest), key(8, P({ rot: -60, dy: -8 })), key(20, P({ rot: -30 })), key(34, rest)], { aerial: true, landingLag: 10, cell: "car-launched" }),
    // SLAM: stall, then drop on them
    dair: mv("dair", 46, [
      cap([16, 19], -30, 4, 30, 4, 32, 14, 270, 25, 90, { ...HEAVY, spike: true, priority: 0 }),
      cap([20, 26], -30, 4, 30, 4, 28, 10, 60, 30, 75, { ...HEAVY, priority: 1 }),
    ], [key(0, P({ sy: 1.08 })), key(15, P({ sy: 0.8, sx: 1.18, dy: 6 })), key(28, P({ sy: 0.94 })), key(46, rest)], { aerial: true, landingLag: 20, hover: [10, 15], cell: "car-atk-down" }),
    // TOW HOOK
    grab: mv("grab", 34, [hb([7, 9], 76, -34, 30, 0, 0, 0, 0, { grab: true })], lunge(34, 7, 1.1), { isGrab: true, cell: "car-atk-fwd" }),
    dashGrab: mv("dashGrab", 40, [hb([9, 11], 92, -34, 32, 0, 0, 0, 0, { grab: true })], lunge(40, 9, 1.16), { isGrab: true, motion: [[1, 6, 0], [9, 0, 0]], cell: "car-atk-fwd" }),
    pummel: mv("pummel", 14, [], [key(0, rest), key(5, P({ sx: 1.06, sy: 0.96 })), key(14, rest)], { cell: "car-atk-fwd" }),
    fthrow: throwMove("fthrow", 30, 12, 9, 40, 60, 70, [key(0, rest), key(12, P({ sx: 1.16, sy: 0.9 })), key(30, rest)]),
    bthrow: throwMove("bthrow", 36, 16, 11, 45, 62, 78, [key(0, rest), key(16, P({ rot: -30 })), key(36, rest)]),
    uthrow: throwMove("uthrow", 34, 14, 8, 90, 68, 90, [key(0, rest), key(14, P({ rot: -20, sy: 1.12 })), key(34, rest)]),
    dthrow: throwMove("dthrow", 38, 18, 7, 60, 45, 45, [key(0, rest), key(18, P({ sy: 0.8, sx: 1.16, dy: 8 })), key(38, rest)]),
    // NITRO BOOST: spends nitro for a long, armoured burst forward. Empty tank: a sad little puff.
    nspecial: mv("nspecial", 44, [cap([8, 26], 20, -40, 96, -36, 32, 6, 45, 40, 70, { ...HEAVY, rehit: 8 })], lunge(44, 8, 1.3), { hook: "nitro", armour: { frames: [8, 26], threshold: 7 }, cell: "car-atk-fwd", fx: "quake" }),
    // DRIFT: swing the tail around and come out facing the other way, still rolling
    sspecial: mv("sspecial", 34, [cap([8, 14], -20, -34, -110, -30, 30, 9, 120, 40, 75, TIRE)], [key(0, rest), key(8, P({ rot: 24, sx: 1.16, sy: 0.9 })), key(16, P({ rot: -12 })), key(34, rest)], { hook: "drift", motion: [[1, 6, 0]], cell: "car-atk-down" }),
    // RAMP JUMP: the suspension fires the car upward
    uspecial: mv("uspecial", 54, [cap([4, 10], -40, -50, 40, -50, 36, 6, 80, 40, 60, TIRE)], [key(0, P({ sy: 0.8, sx: 1.12 })), key(4, P({ sy: 1.16, sx: 0.9 })), key(28, P({ rot: -8 })), key(54, P({ rot: 10 }))], { hook: "rampJump", helpless: true, ledgeOk: true, cell: "car-jump" }),
    // TRANSFORM back to mech: the strip in reverse
    dspecial: mv("dspecial", TF_FRAMES, [], [key(0, rest), key(TF_FRAMES, rest)], { hook: "toMech", cells: tfCells(-1), armour: { frames: [1, TF_FRAMES], threshold: 10 }, fx: "quake" }),
    ledgeAttack: mv("ledgeAttack", 38, [cap([12, 16], 10, -40, 96, -40, 26, 9, 45, 40, 65, TIRE)], lunge(38, 12, 1.12), { cell: "car-atk-fwd" }),
    getupAttack: mv("getupAttack", 42, [cap([12, 15], 10, -30, 100, -30, 24, 7, 45, 40, 60, { ...TIRE, group: 0 }), cap([20, 23], -10, -30, -100, -30, 24, 7, 45, 40, 60, { ...TIRE, group: 1 })], [key(0, rest), key(12, P({ rot: 16 })), key(20, P({ rot: -16 })), key(42, rest)], { cell: "car-atk-down" }),
    taunt: mv("taunt", 50, [], [key(0, rest), key(12, P({ rot: -14, sy: 1.08 })), key(26, P({ rot: -14 })), key(50, rest)], { cell: "car-atk-up" }),
  };

  const carAnims = {
    idle: "car-idle", walk: "car-walk", run: "car-walk", dash: "car-walk", skid: "car-atk-down", crouch: "car-block", jumpSquat: "car-idle",
    jump: "car-jump", fall: "car-jump", land: "car-idle", helpless: "car-launched", shield: "car-block", hitstun: "car-hit", tumble: "car-launched",
    knockdown: "car-hit", ledgeHang: "car-jump", grabHold: "car-atk-fwd", grabbed: "car-hit", dead: "car-idle", taunt: "car-atk-up",
    respawn: "car-idle", spotDodge: "car-block", roll: "car-launched", airDodge: "car-jump",
  };
  // a car bounces on its suspension instead of leaning from its feet
  const carPoses = {
    idle: [key(0, rest), key(30, P({ sy: 0.97 })), key(60, rest)],
    walk: [key(0, P({ sy: 0.98 })), key(8, P({ sy: 1.03, dy: -3 })), key(16, P({ sy: 0.98 }))],
    run: [key(0, P({ rot: 4, sx: 1.06, sy: 0.96 })), key(5, P({ rot: 5, sx: 1.04, sy: 1.0, dy: -4 })), key(10, P({ rot: 4, sx: 1.06, sy: 0.96 }))],
    dash: [key(0, P({ rot: 8, sx: 1.12, sy: 0.9 })), key(8, P({ rot: 4, sx: 1.04 }))],
    skid: [key(0, P({ rot: -8, sx: 1.06, sy: 0.94 }))],
    crouch: [key(0, P({ sy: 0.82, sx: 1.06 }))],
    jumpSquat: [key(0, P({ sy: 0.84, sx: 1.08 }))],
    land: [key(0, P({ sy: 0.8, sx: 1.12 })), key(6, rest)],
    hitstun: [key(0, P({ rot: -10, sx: 1.04, sy: 0.94 }))],
  };

  return {
    id: "gearshift",
    name: "GEARSHIFT",
    tagline: "Half hatchback, half haymaker.",
    stats,
    moves: mech,
    forms: { car: { stats: carStats, moves: car, anims: carAnims, poses: carPoses } },
    form: (f) => (f.special.form ? "car" : null),
    rig: { bones: [], anims: spriteAnims(), loops: spriteLoops },
    palette: { colors: { marker: "#e8792a" }, accent: "marker", outline: "#292722" },
    special: () => ({ form: 0, nitro: 0 }),
    hooks: {
      toCar: ({ f }) => { if (f.frame === TF_FRAMES) f.special.form = 1; },
      toMech: ({ f }) => { if (f.frame === TF_FRAMES) f.special.form = 0; },
      rocketPunch: ({ f, state }) => {
        if (f.frame !== 14) return;
        const boosted = f.special.nitro >= 40;
        if (boosted) f.special.nitro -= 40;
        spawnProjectile(state, f, boosted ? "shock" : "chunk", f.x + f.moveFacing * 70, f.y - 92, f.moveFacing * (boosted ? 16 : 11), 0, boosted ? 34 : 26,
          { frames: [0, 999], x: 0, y: 0, r: boosted ? 26 : 20, damage: boosted ? 13 : 8, angle: 40, base: boosted ? 55 : 35, growth: boosted ? 90 : 60, fx: "heavy" });
      },
      jumpJet: ({ f, input }) => {
        if (f.frame === 4) { f.grounded = false; f.platform = -1; f.usedUpSpecial = true; }
        if (f.frame >= 4 && f.frame <= 30) { f.vy = -8 + (f.frame - 4) * 0.22; f.vx = (input.x / 100) * 3.4; }
      },
      nitro: ({ f }) => {
        if (f.frame === 1) { f.chargeMul = f.special.nitro >= 30 ? 1.6 : 0.6; }
        if (f.frame === 8) {
          const fuel = Math.min(60, f.special.nitro);
          f.special.nitro -= fuel;
          f.vx = f.moveFacing * (6 + fuel * 0.16);
        }
        if (f.frame > 8 && f.frame <= 26 && f.grounded) f.vx = f.moveFacing * Math.max(4, Math.abs(f.vx) * 0.985);
      },
      drift: ({ f }) => {
        if (f.frame === 8) { f.facing = -f.moveFacing; f.vx = f.facing * 7; }
      },
      rampJump: ({ f, input }) => {
        if (f.frame === 4) { f.grounded = false; f.platform = -1; f.usedUpSpecial = true; f.vy = -15; }
        if (f.frame > 4 && f.frame <= 28) f.vx = (input.x / 100) * 5.5;
      },
    },
    // the car earns nitro by going fast on the ground; the tank holds 100
    onFrame: ({ f }) => {
      if (f.special.form && f.grounded && Math.abs(f.vx) >= 5 && f.special.nitro < 100) f.special.nitro = Math.min(100, f.special.nitro + 0.5);
    },
    meters: [{ label: "NITRO", color: "#00bfdc", get: (f) => f.special.nitro / 100 }],
    visual: (f) => ({ glow: f.special.nitro >= 100 ? 0.6 : 0 }),
  };
}
