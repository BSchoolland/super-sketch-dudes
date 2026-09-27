// SWORD GUY — a stick figure with a very big sword. The example fighter: read it for how a character is
// put together and why, not for numbers to copy. His numbers are his; a tank's or a ghost's will differ.
//
// WHAT MAKES A CHARACTER FEEL LIKE SOMEONE
//   Every button is its own move. A jab, a tilt, an aerial and a smash on the same part are different
//   ideas (a poke, a sweep, a chop, a thrust), with their own reach, timing, angle and picture. Nothing
//   here is one swing pointed in four directions; that reads as one move and plays like one.
//   The drawing's part does the work. The sword is long, so his reach is long and his tip matters: the
//   point is a sweet spot on the moves where a real sword would have one (fsmash, usmash, fair, bair,
//   dash attack) and the shaft is sour. A short part gets short moves; a heavy part gets slow ones.
//   Every strike has a look. Tilts are a thin steel crescent (cut), stabs are a glowing line along the
//   blade (skewer), smashes are heavier hatched steel (chop, sweep), the fire special is a bolt that is
//   nothing like the sword. A player should be able to tell the moves apart from the shape alone.
//   Poses sell it. Each move has its own keys (wind-up, snap into the hit, settle), and the smashes
//   and specials switch cells mid-move (`cells`) so a chop winds up overhead and comes down forward.
//
// THE MOVES
//   NORMALS  (attack)        poke-then-cut jab, wide ftilt, an overhead utilt arc, a floor-level dtilt,
//                            a running thrust. In the air: a spinning nair, the chop as fair, a backwards
//                            thrust as bair, one thrust straight up as uair, three stabs down as dair.
//   SMASHES                  CHOP (overhead to forward, tipper), SKEWER (straight up, point on top),
//                            SWEEP (low, both sides).
//   GIMMICK  (special)       BOOMERANG BLADE: he throws the sword spinning; it flies out and comes back.
//                            Sideways: the DRIVE, a charged flaming lunge (hold to charge, further and
//                            harder the longer it was held). Down: the TORNADO, a spin that churns in
//                            place on the ground and drills straight down in the air.
//   RECOVERY (up + special)  CORKSCREW: the tornado rising, capped with a thrust at the top. Helpless after.
//   GRAB                     grabs with the free hand; throws with a sword-pommel shove.
//
// THE RULES OF THE BOX
//   Fighter space: +x is the facing direction, +y is DOWN, the origin is at the feet. Frames are 1-based.
//   Hitboxes: hb([first,last], x, y, r, damage, angle, base, growth, extra); cap(...) is a capsule from
//   (x,y) to (x2,y2). Angle 0 launches away from the attacker, 90 up, 270 down (a spike), 180 pulls in.
//   Hooks run every frame of their move and may move the fighter (f.vx, f.vy), hold a frame to charge
//   (f.frame = n - 1), or jump ahead. All mutable state lives in `special()`, every key present from
//   the start, numbers only: the rollback hash walks it. A number the player should see is a bar
//   instead: declared in `bars`, read and written as f.bars.x, clamped to 0..max after each frame and
//   drawn under the percent. `trip`/`rearm` give it a latch (heat that locks at 100 and frees at 75,
//   ammo that runs dry at 0 and is back at 9), read with `tripped(f, "x")`; `show` draws it only
//   while a condition holds and `over` draws it above the fighter too (the DRIVE charge below).
//   Looks that touch nothing: `visual(f)` returns render-only tweaks ({ glow, scale, shake }) and
//   `fx(state, f, kind, x, y, n, color)` bursts particles (sparks, smoke, ring). The DRIVE charge
//   below is built from both.
export default function make(api) {
  const { hb, cap, key, mv, throwMove, spawnProjectile, spriteAnims, spriteLoops, clamp, sign, fx, B } = api;

  const stats = {
    weight: 92, walk: 3.4, run: 6.2, dashInit: 7, airSpeed: 4.4, airAccel: 0.22,
    fallSpeed: 7, fastFall: 11, gravity: 0.46, shortHop: 8, fullHop: 13.5, doubleJump: 12.5,
    jumps: 2, wallJump: false, traction: 0.55, height: 120, width: 50, crouchHeight: 80, landLag: 4, ledgeReach: 40,
  };

  const rest = {};
  const strikePoses = (total, hit, lean, extra = {}) => [
    key(0, { rot: -lean * 0.6, sx: 0.95, sy: 1.04, ...extra }),
    key(hit, { rot: lean, sx: 1.1, sy: 0.94, ...extra }),
    key(Math.min(total - 1, hit + 6), { rot: lean * 0.7, sx: 1.04, sy: 0.98, ...extra }),
    key(total, rest),
  ];
  const looks = {
    // the sword itself, cut out of the lunge drawing, spinning end over end
    blade: { cell: "atk-fwd", crop: [298, 290, 132, 50], size: 100, spin: -26, trail: "ghost" },
    // every tilt and aerial: a thin crescent of steel with a blue edge
    cut: { shape: "slash", color: "#dce6f2", ink: "#3f6fb5", texture: "solid" },
    // the point: full blue, for the sweet spots
    point: { shape: "slash", color: "#3f6fb5", ink: "#24221e", texture: "solid" },
    // smashes: heavy hatched steel, twice the size of a tilt's cut; skewer is also the line of every straight stab
    chop: { shape: "slash", color: "#7fa3d9", ink: "#24221e", texture: "hatch", size: 190 },
    skewer: { shape: "bolt", color: "#3f6fb5", ink: "#24221e", texture: "glow", size: 34 },
    sweep: { shape: "slash", color: "#7fa3d9", ink: "#24221e", texture: "hatch", size: 150 },
    // the DRIVE: a bolt of fire, nothing like the sword
    drive: { shape: "bolt", color: "#ff8a2a", ink: "#c93a1c", texture: "flame", size: 90 },
    // the TORNADO: a scribbled whirl around him, spinning
    tornado: { shape: "cloud", color: "#e8eef8", ink: "#3f6fb5", texture: "scribble", size: 190, spin: 32, aim: false },
    tornadoBurst: { shape: "star", color: "#bcd0ee", ink: "#3f6fb5", texture: "glow", size: 220, spin: 12, aim: false },
  };

  const GRAB = { total: 36, hit: 7, damage: 9 };
  const toss = (id, angle, base, growth, pose) => throwMove(id, 32, 14, GRAB.damage, angle, base, growth, [key(0, { rot: 6 }), key(14, pose), key(32, rest)]);

  // a stab straight down from his centre, through the feet: a line, not a poke beside him
  const stab = (frames, damage, extra) => cap(frames, 0, -62, 0, 44, 15, damage, 270, 20, 30, { fx: "skewer", ...extra });

  const moves = {
    // JAB: a quick poke with the point, then (tap again) a short cut across
    jab1: mv("jab1", 20, [cap([5, 7], 30, -62, 96, -60, 13, 5, 40, 20, 40, { fx: "skewer" })],
      [key(0, { sx: 0.96 }), key(5, { sx: 1.12, sy: 0.96, dx: 6 }, true), key(12, { sx: 1.02 }), key(20, rest)], { iasa: 15, next: "jab2", nextFrom: 8, cell: "atk-fwd" }),
    jab2: mv("jab2", 28, [cap([6, 9], 20, -40, 100, -80, 18, 7, 48, 40, 70, { fx: "cut" })],
      [key(0, { rot: -8, sx: 0.96 }), key(6, { rot: 14, sx: 1.1, sy: 0.94 }, true), key(14, { rot: 8 }), key(28, rest)], { cell: "atk-fwd" }),
    // FTILT: a wide horizontal cut with a half step in, the biggest crescent among the tilts
    ftilt: mv("ftilt", 32, [cap([9, 12], 20, -58, 118, -56, 22, 11, 40, 38, 84, { fx: "cut" })],
      [key(0, { rot: -12, sx: 0.94, dx: -6 }), key(9, { rot: 14, sx: 1.12, sy: 0.94, dx: 10 }, true), key(16, { rot: 8, sx: 1.04 }), key(32, rest)], { cell: "atk-fwd", motion: [[8, 2.5, 0]] }),
    // DASH ATTACK: a running thrust, the point leading, carried by the run
    dashAttack: mv("dashAttack", 38, [
      hb([9, 13], 130, -58, 18, 12, 42, 40, 84, { fx: "point", priority: 0 }),
      cap([9, 14], 20, -60, 118, -58, 15, 9, 40, 36, 70, { fx: "skewer", priority: 1 }),
    ], [key(0, { rot: -6, sx: 0.92 }), key(9, { rot: 16, sx: 1.24, sy: 0.9, dx: 12 }, true), key(20, { rot: 10, sx: 1.08 }), key(38, rest)], { cell: "atk-fwd", motion: [[1, 8, 0], [12, 4.5, 0], [22, 1, 0]] }),
    // UTILT: an arc over his head, front to back. Anti-air, sends up.
    utilt: mv("utilt", 32, [
      cap([8, 10], 70, -110, 30, -176, 20, 9, 86, 34, 80, { fx: "cut", group: 0 }),
      cap([11, 13], 30, -176, -50, -150, 20, 9, 100, 34, 80, { fx: "cut", group: 1 }),
    ], [key(0, { rot: 10, sy: 0.96 }), key(8, { rot: -6, sy: 1.12, dy: -8 }, true), key(13, { rot: -18, sy: 1.08, dy: -6 }), key(32, rest)], { cell: "atk-up" }),
    // DTILT: a low cut along the floor, trips them up and out
    dtilt: mv("dtilt", 28, [cap([7, 10], 6, -16, 116, -12, 18, 8, 22, 30, 70, { fx: "cut" })],
      [key(0, { sy: 0.9, sx: 1.06, dy: 4 }), key(7, { sy: 0.8, sx: 1.16, rot: 18, dy: 8 }, true), key(14, { sy: 0.86, sx: 1.1, rot: 10 }), key(28, rest)], { cell: "atk-down" }),
    // NAIR: a full turn in the air, the sword out: hits in front, then behind (the tornado's little brother)
    nair: mv("nair", 30, [
      cap([6, 8], 10, -60, 100, -58, 18, 8, 45, 32, 70, { fx: "cut", group: 0 }),
      cap([13, 15], -10, -60, -100, -58, 18, 8, 135, 32, 70, { fx: "cut", group: 1, radial: true }),
    ], [key(0, { sx: 1.0 }), key(6, { sx: 1.08, rot: 10 }, true), key(10, { sx: 0.3 }), key(13, { sx: 1.08, rot: -10 }, true), key(20, { sx: 1.0 }), key(30, rest)],
      { aerial: true, landingLag: 10, cells: [[0, "atk-fwd"], [10, "block"], [13, "atk-fwd"]] }),
    // FAIR: the chop, in the air: overhead wind-up, then down and through. Tip is the sweet spot.
    fair: mv("fair", 34, [
      cap([11, 13], 90, -66, 130, -30, 18, 13, 42, 40, 86, { fx: "point", priority: 0 }),
      cap([11, 14], 10, -116, 96, -50, 22, 10, 40, 34, 74, { fx: "chop", priority: 1 }),
    ], [key(0, { rot: -12, sy: 1.06 }), key(8, { rot: -20, sy: 1.12 }), key(11, { rot: 22, sy: 0.92, sx: 1.1, dx: 8 }, true), key(20, { rot: 12 }), key(34, rest)],
      { aerial: true, landingLag: 12, cells: [[0, "atk-up"], [11, "atk-fwd"]] }),
    // BAIR: a fast thrust straight behind him, the point leading. His quickest kill move.
    bair: mv("bair", 28, [
      hb([7, 9], -128, -62, 17, 13, 40, 44, 90, { fx: "point", priority: 0 }),
      cap([7, 10], -20, -62, -114, -62, 14, 9, 40, 34, 70, { fx: "skewer", priority: 1 }),
    ], [key(0, { rot: 6, sx: 0.94 }), key(7, { rot: -16, sx: 1.18, sy: 0.94, dx: -10 }, true), key(16, { rot: -8, sx: 1.04 }), key(28, rest)],
      { aerial: true, landingLag: 12, cell: "atk-fwd", cellFlip: true }),
    // UAIR, THE SPIRE: the sword thrust straight up from his centre, a line to well above his head. The point is the sweet spot.
    uair: mv("uair", 32, [
      hb([10, 13], 0, -214, 22, 12, 88, 34, 84, { fx: "point", priority: 0 }),
      cap([10, 14], 0, -66, 0, -198, 17, 9, 86, 30, 72, { fx: "skewer", priority: 1 }),
    ], [key(0, { sy: 0.94, sx: 1.06 }), key(8, { sy: 0.9, sx: 1.08, dy: 4 }), key(10, { sy: 1.18, sx: 0.92, dy: -14 }, true), key(18, { sy: 1.08, dy: -6 }), key(32, rest)],
      { aerial: true, landingLag: 12, cell: "atk-up" }),
    // DAIR, THREE STABS DOWN: three quick pokes below him, drifting down slowly through them; the last one spikes.
    dair: mv("dair", 44, [
      stab([8, 9], 4, { group: 0 }),
      stab([16, 17], 4, { group: 1 }),
      stab([25, 28], 9, { group: 2, spike: true, base: 40, growth: 80 }),
    ], [key(0, { sy: 1.06, dy: -4 }), key(7, { sy: 1.1, dy: -8 }), key(8, { sy: 0.92, dy: 8 }), key(12, { sy: 1.08, dy: -8 }), key(16, { sy: 0.92, dy: 8 }), key(20, { sy: 1.12, dy: -12 }), key(25, { sy: 0.86, dy: 14, sx: 1.06 }), key(32, { sy: 1.0, dy: 0 }), key(44, rest)],
      { aerial: true, landingLag: 14, cell: "atk-down", hook: "stabFall" }),
    // CHOP: raised overhead, then brought down and through. The tip is the sweet spot.
    fsmash: mv("fsmash", 56, [
      cap([18, 21], 96, -70, 146, -30, 20, 21, 40, 46, 102, { fx: "point", priority: 0 }),
      cap([18, 22], 10, -120, 100, -50, 26, 15, 42, 40, 84, { fx: "chop", priority: 1 }),
    ], [key(0, { rot: -14, sy: 1.08, dx: -6 }), key(14, { rot: -22, sy: 1.14, dx: -10 }), key(18, { rot: 26, sy: 0.9, sx: 1.12, dx: 12 }, true), key(26, { rot: 18, sy: 0.96, dx: 8 }), key(56, rest)],
      { smash: true, cells: [[0, "atk-up"], [18, "atk-fwd"]] }),
    // SKEWER: crouch, then thrust the sword straight up. Only the point at the top really hurts.
    usmash: mv("usmash", 52, [
      hb([16, 19], 6, -214, 22, 19, 90, 44, 100, { fx: "point", priority: 0 }),
      cap([16, 21], 6, -90, 6, -196, 18, 12, 88, 36, 80, { fx: "skewer", priority: 1 }),
    ], [key(0, { sy: 0.86, sx: 1.1, dy: 4 }), key(14, { sy: 0.78, sx: 1.16, dy: 8 }), key(16, { sy: 1.24, sx: 0.9, dy: -18 }, true), key(24, { sy: 1.12, dy: -8 }), key(52, rest)],
      { smash: true, cells: [[0, "block"], [16, "atk-up"]] }),
    // SWEEP: a low cut forward, then back, along the floor. Both sides, low knockback, sends them out.
    dsmash: mv("dsmash", 56, [
      cap([16, 19], 10, -16, 130, -10, 22, 16, 24, 48, 90, { fx: "sweep", group: 0 }),
      cap([24, 27], -10, -16, -130, -10, 22, 16, 24, 48, 90, { fx: "sweep", group: 1 }),
    ], [key(0, { sy: 0.9, sx: 1.06 }), key(14, { rot: -20, sy: 0.8, sx: 1.16 }), key(16, { rot: 22, sy: 0.82, sx: 1.14 }, true), key(24, { rot: -22, sy: 0.82, sx: 1.14 }, true), key(34, { rot: 0, sy: 0.9 }), key(56, rest)],
      { smash: true, cell: "atk-down", fx: "quake" }),
    grab: mv("grab", GRAB.total, [hb([GRAB.hit, GRAB.hit + 2], 46, -64, 24, 0, 0, 0, 0, { grab: true })], strikePoses(GRAB.total, GRAB.hit, 10), { isGrab: true }),
    dashGrab: mv("dashGrab", 42, [hb([9, 11], 60, -64, 26, 0, 0, 0, 0, { grab: true })], strikePoses(42, 9, 18), { isGrab: true, motion: [[1, 5, 0], [9, 0, 0]] }),
    pummel: mv("pummel", 16, [], [key(0, { rot: 6 }), key(6, { rot: 14, sx: 1.06 }), key(16, { rot: 6 })]),
    fthrow: toss("fthrow", 42, 62, 72, { rot: 24, sx: 1.1 }),
    bthrow: toss("bthrow", 40, 66, 82, { rot: -36 }),
    uthrow: toss("uthrow", 90, 70, 90, { dy: -12, sy: 1.12 }),
    dthrow: toss("dthrow", 70, 45, 40, { sy: 0.82, sx: 1.14, dy: 14 }),
    // GIMMICK, BOOMERANG BLADE: the sword spins out and comes back to his hand (one at a time)
    nspecial: mv("nspecial", 46, [], strikePoses(46, 14, 16), { hook: "fling", cell: "atk-fwd" }),
    // DRIVE: hold to charge, then a flaming lunge that goes further and hits harder the longer it was held
    sspecial: mv("sspecial", 58, [
      cap([15, 32], 10, -64, 150, -56, 30, 13, 38, 46, 88, { fx: "drive", rehit: 40 }),
    ], [key(0, { rot: -10, sx: 0.92, dx: -6 }), key(14, { rot: -14, sx: 0.86, dx: -12 }), key(15, { rot: 12, sx: 1.26, sy: 0.9, dx: 14 }, true), key(32, { rot: 8, sx: 1.16, sy: 0.94, dx: 10 }), key(58, rest)],
      { hook: "drive", cell: "atk-fwd" }),
    // TORNADO: a spin with the sword out. On the ground it churns in place; in the air it drills straight down.
    dspecial: mv("dspecial", 58, [
      hb([6, 34], 0, -70, 78, 2, 80, 12, 20, { fx: "tornado", rehit: 5, radial: true }),
      hb([36, 39], 0, -70, 96, 9, 78, 50, 92, { fx: "tornadoBurst", group: 1, radial: true }),
    ], [key(0, { sx: 1.0 }), key(6, { sx: 0.3, rot: 6 }), key(10, { sx: 1.0, rot: -6 }), key(14, { sx: 0.3, rot: 6 }), key(18, { sx: 1.0, rot: -6 }), key(22, { sx: 0.3, rot: 6 }), key(26, { sx: 1.0, rot: -6 }), key(30, { sx: 0.3, rot: 6 }), key(34, { sx: 1.0 }), key(36, { sx: 1.18, sy: 1.1, dy: -8 }), key(58, rest)],
      { hook: "tornado", cells: [[0, "atk-fwd"], [6, "block"], [10, "atk-fwd"], [14, "block"], [18, "atk-fwd"], [22, "block"], [26, "atk-fwd"], [30, "block"], [34, "atk-up"]] }),
    // RECOVERY, CORKSCREW: the tornado, but rising: he spins up with the sword out, and finishes with a thrust at the top
    uspecial: mv("uspecial", 56, [
      hb([5, 22], 0, -70, 66, 2, 80, 12, 16, { fx: "tornado", rehit: 4, radial: true }),
      hb([23, 26], 0, -200, 22, 7, 88, 50, 90, { fx: "point", group: 1 }),
      cap([23, 27], 0, -80, 0, -186, 15, 5, 86, 40, 60, { fx: "skewer", group: 1, priority: 1 }),
    ], [key(0, { sy: 0.86, sx: 1.1 }), key(5, { sy: 1.14, sx: 0.92 }, true), key(9, { sx: 0.3 }), key(13, { sx: 1.0, rot: -8 }), key(17, { sx: 0.3 }), key(21, { sx: 1.0, rot: 8 }), key(23, { sy: 1.2, sx: 0.9, dy: -12 }, true), key(36, { sy: 1.06 }), key(56, { rot: 0 })],
      { hook: "rise", helpless: true, ledgeOk: true, cells: [[0, "jump"], [5, "atk-fwd"], [9, "block"], [13, "atk-fwd"], [17, "block"], [21, "atk-fwd"], [23, "atk-up"]] }),
    ledgeAttack: mv("ledgeAttack", 40, [cap([12, 15], 10, -50, 110, -46, 18, 9, 40, 38, 70, { fx: "cut" })], [key(0, { rot: -8 }), key(12, { rot: 14, sx: 1.1 }, true), key(40, rest)], { cell: "atk-fwd" }),
    getupAttack: mv("getupAttack", 44, [cap([12, 15], 10, -30, 100, -20, 18, 7, 45, 40, 60, { fx: "cut", group: 0 }), cap([20, 23], -10, -30, -100, -20, 18, 7, 45, 40, 60, { fx: "cut", group: 1 })], [key(0, rest), key(12, { rot: 12 }), key(20, { rot: -12 }), key(44, rest)], { cell: "atk-down" }),
    taunt: mv("taunt", 50, [], [key(0, rest), key(10, { dy: -10, sy: 1.1 }), key(20, rest), key(30, { dy: -10, sy: 1.1 }), key(50, rest)], { cell: "atk-up" }),
  };

  const BLADE_OUT = 16, BLADE_BACK = 0.6;
  const DRIVE_CHARGE_MAX = 45, DRIVE_FRAMES = 18;
  return {
    id: "sword-guy",
    name: "SWORD GUY",
    tagline: "Has a sword. That's the whole plan.",
    stats,
    moves,
    rig: { anims: spriteAnims(), loops: spriteLoops },
    palette: { colors: { marker: "#3f6fb5" }, outline: "#24221e" },
    looks,
    special: () => ({ drop: 0 }),
    bars: {
      sword: { label: "SWORD", color: "#3f6fb5", max: 1, start: 1 },
      drive: { label: "DRIVE", color: "#3f6fb5", max: DRIVE_CHARGE_MAX, show: (f) => f.move === "sspecial", over: true },
    },
    hooks: {
      fling: ({ f, state }) => {
        if (f.frame !== 14 || !f.bars.sword) return;
        f.bars.sword = 0;
        spawnProjectile(state, f, "blade", f.x + f.moveFacing * 40, f.y - 58, f.moveFacing * BLADE_OUT, 0, 90,
          { frames: [0, 999], x: 0, y: 0, r: 22, damage: 7, angle: 45, base: 34, growth: 62, rehit: 20 }, { back: BLADE_BACK });
      },
      drive: ({ f, input, state }) => {
        // frames 1..14 wind up; holding special on frame 14 keeps him there, charging, up to DRIVE_CHARGE_MAX
        if (f.frame === 1) f.bars.drive = 0;
        if (f.frame === 14 && (input.b & B.SPECIAL) && f.bars.drive < DRIVE_CHARGE_MAX) {
          f.bars.drive++;
          // sparks off the blade, more and faster as it fills; a ring the moment it's full
          const c = f.bars.drive / DRIVE_CHARGE_MAX;
          if (f.bars.drive % (c > 0.66 ? 2 : 4) === 0) fx(state, f, "sparks", f.x + f.moveFacing * 36, f.y - 70, 1 + Math.round(c * 4), "#ff8a2a");
          if (f.bars.drive === DRIVE_CHARGE_MAX) fx(state, f, "ring", f.x, f.y - 60, 2, "#ff8a2a");
          f.frame = 13;
          return;
        }
        const c = f.bars.drive / DRIVE_CHARGE_MAX;
        if (f.frame === 15) f.chargeMul = 1 + c * 0.7;
        // the lunge: flat and fast, further the longer it was held; in the air it flies level
        if (f.frame >= 15 && f.frame < 15 + DRIVE_FRAMES) {
          f.vx = f.moveFacing * (9 + c * 7);
          if (!f.grounded) f.vy = Math.min(f.vy, 0);
        }
      },
      tornado: ({ f, input }) => {
        if (f.frame === 1) f.special.drop = f.grounded ? 0 : 1;
        if (!f.special.drop) return;
        // airborne: drill straight down at fast-fall speed until the ground, then the burst
        if (f.grounded) { f.special.drop = 0; if (f.frame < 35) f.frame = 35; return; }
        if (f.frame >= 4 && f.frame < 35) {
          f.fastFalling = true;
          f.vy = stats.fastFall;
          f.vx = (input.x / 100) * 2.4;
          if (f.frame === 34) f.frame = 33;
        }
      },
      stabFall: ({ f }) => {
        // a slow drift down through the stabs (about a third of fall speed), no fast fall
        if (f.frame >= 3 && f.frame <= 30) { f.fastFalling = false; f.vy = Math.min(f.vy, 2.2); }
      },
      rise: ({ f, input }) => {
        if (f.frame === 5) { f.grounded = false; f.platform = -1; f.usedUpSpecial = true; }
        if (f.frame >= 5 && f.frame <= 24) {
          f.vy = -11 + (f.frame - 5) * 0.3;
          f.vx = (input.x / 100) * 2.6;
        }
      },
    },
    // the thrown sword decelerates, turns around and homes back to its owner; catching it ends it
    onFrame: ({ f, state }) => {
      let live = 0;
      for (const p of state.projectiles) {
        if (p.dead || p.kind !== "blade" || p.from !== f.slot) continue;
        live++;
        const dx = f.x - p.x, dy = (f.y - 60) - p.y;
        if (p.age > 12) {
          p.vx += sign(dx) * p.data.back;
          p.vy = dy * 0.08;
          p.vx = clamp(p.vx, -BLADE_OUT, BLADE_OUT);
          if (Math.abs(dx) < 30 && Math.abs(dy) < 60) p.dead = true;
        }
      }
      if (!live) f.bars.sword = 1;
    },
    // the drive winding up: glow, coil and shake grow with the charge
    visual: (f) => {
      if (f.move !== "sspecial" || f.frame > 14) return {};
      const c = f.bars.drive / DRIVE_CHARGE_MAX;
      return { glow: c, scale: 1 - 0.05 * c, shake: 5 * c };
    },
  };
}
