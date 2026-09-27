// FIRE WIZARD: a pointy blue hat, a spellbook in one hand and a live fireball in the other. "Much fire."
// The second example, a caster: read SWORD GUY first. What's his own here is the fire, drawn rather than
// cut from a cell (the fireball look), and the special fed from the hand (the FEED bar and its effects).
//
// Everything he does comes out of the fireball in his raised hand, except the book, which he swings.
//   NORMALS   a little fireball flicked a short way (jab), a short flame jet (ftilt), a little fireball
//             flicked straight up (utilt), fire bursting out on both sides (dtilt), a running fireball shove
//             (dash attack).
//             Air: a ring of fire (nair), the fireball swept down (fair), a TOME smack behind (bair, the
//             book is his hardest-hitting normal), a flame burst up (uair), a METEOR spike down (dair) that
//             blows up if he lands out of it.
//   SMASHES   BLAST (a fireball explosion in front), PILLAR (a column of fire up), WILDFIRE (fire along
//             the floor, both sides).
//   SPECIAL   FIREBALL: throws the fireball from his hand; hold to feed it into a GREAT FIREBALL. Up to
//             three out at once.
//             Side: FLAMETHROWER, a stream of flame for as long as he holds it and has HEAT (meter).
//             Down: CREEPER, a fireball set down on the floor that rolls after the nearest enemy, slowly at
//             first and faster and faster, burning whoever it touches (one at a time; in the air he drops it).
//   RECOVERY  FLAME JET: he rides a jet of fire whichever way the stick points, throwing eight embers out at the
//             end. Helpless after.
export default function make(api) {
  const { hb, cap, key, mv, throwMove, spawnProjectile, spriteAnims, spriteLoops, B, tripped, fx } = api;

  const stats = {
    weight: 84, walk: 3.0, run: 5.8, dashInit: 6.6, airSpeed: 4.0, airAccel: 0.2,
    fallSpeed: 6.4, fastFall: 10.5, gravity: 0.42, shortHop: 8, fullHop: 13.5, doubleJump: 12.5,
    jumps: 2, wallJump: false, traction: 0.55, height: 118, width: 48, crouchHeight: 78, landLag: 4, ledgeReach: 40,
  };

  const rest = {};
  const strikePoses = (total, hit, lean, extra = {}) => [
    key(0, { rot: -lean * 0.6, sx: 0.95, sy: 1.04, ...extra }),
    key(hit, { rot: lean, sx: 1.1, sy: 0.94, ...extra }),
    key(Math.min(total - 1, hit + 6), { rot: lean * 0.7, sx: 1.04, sy: 0.98, ...extra }),
    key(total, rest),
  ];
  const RED = "#e0301e", ORANGE = "#ff9a2a", YELLOW = "#ffd23a";
  const looks = {
    // the fireball: drawn, not cut from a cell, so it can burn and grow; flames peel off behind it
    fireball: { shape: "fireball", color: RED, ink: "#8a1a0e", size: 36, trail: "flames" },
    bigFireball: { shape: "fireball", color: RED, ink: "#8a1a0e", size: 78, trail: "flames" },
    // the jab's and utilt's: a little one that burns out fast
    ember: { shape: "fireball", color: ORANGE, ink: RED, size: 22, trail: "flames" },
    // the meteor landing, and the dtilt's bursts
    boom: { shape: "star", color: ORANGE, ink: RED, texture: "flame", size: 130, spin: 10, aim: false },
    // flamethrower puffs: little rising blobs of flame
    flame: { shape: "blob", color: ORANGE, ink: RED, texture: "flame", size: 38, spin: 14, aim: false, trail: "none" },
    // the creeper: the fireball again, burning upward as it rolls along the floor
    creeper: { shape: "fireball", color: RED, ink: "#8a1a0e", size: 56, heading: 270, trail: "flames" },
    // tilts and light aerials: a lick of flame
    lick: { shape: "slash", color: YELLOW, ink: RED, texture: "flame" },
    spark: { shape: "star", color: YELLOW, ink: RED, texture: "glow", size: 40, spin: 20, aim: false },
    puff: { shape: "cloud", color: ORANGE, ink: RED, texture: "flame", size: 90, spin: 8, aim: false },
    jet: { shape: "bolt", color: ORANGE, ink: RED, texture: "flame", size: 90 },
    // the flame jet's exhaust, pointing back along the jet
    exhaust: { shape: "bolt", color: ORANGE, ink: RED, texture: "flame", size: 70, trail: "none" },
    ring: { shape: "ring", color: ORANGE, ink: RED, texture: "flame", size: 150, spin: 24, aim: false },
    meteor: { shape: "fireball", color: RED, ink: "#7a1a10", size: 100, heading: 270 },
    // the book: plain paper and ink, nothing like the fire
    tome: { shape: "bar", color: "#f4efe4", ink: "#24221e", texture: "hatch", size: 60 },
    // smashes: big fire
    blast: { shape: "star", color: ORANGE, ink: RED, texture: "flame", size: 200, spin: 6, aim: false },
    pillar: { shape: "bolt", color: YELLOW, ink: RED, texture: "flame", size: 170 },
    wave: { shape: "puddle", color: ORANGE, ink: RED, texture: "flame", size: 150 },
    burst: { shape: "star", color: YELLOW, ink: RED, texture: "glow", size: 170, spin: 12, aim: false },
  };

  const GRAB = { total: 36, hit: 7, damage: 9 };
  const toss = (id, angle, base, growth, pose) => throwMove(id, 32, 14, GRAB.damage, angle, base, growth, [key(0, { rot: 6 }), key(14, pose), key(32, rest)]);

  const moves = {
    // JAB: a little fireball flicked off his hand; it burns out after a short way
    jab1: mv("jab1", 20, [],
      [key(0, { sx: 0.96 }), key(4, { sx: 1.1, sy: 0.96, dx: 4 }, true), key(10, { sx: 1.02 }), key(20, rest)], { hook: "flick", iasa: 16, cell: "atk-fwd" }),
    // FTILT: a short jet of flame straight out of his palm
    ftilt: mv("ftilt", 32, [cap([9, 13], 44, -52, 124, -52, 17, 10, 38, 36, 80, { fx: "jet" })],
      [key(0, { rot: -10, sx: 0.94, dx: -4 }), key(9, { rot: 8, sx: 1.12, sy: 0.95, dx: 8 }, true), key(18, { rot: 4, sx: 1.04 }), key(32, rest)], { cell: "atk-fwd" }),
    // DASH ATTACK: running, he shoves the fireball out in front of him
    dashAttack: mv("dashAttack", 38, [hb([8, 14], 60, -52, 28, 10, 45, 40, 72, { fx: "puff" })],
      [key(0, { rot: -6, sx: 0.92 }), key(8, { rot: 14, sx: 1.2, sy: 0.92, dx: 10 }, true), key(20, { rot: 8, sx: 1.06 }), key(38, rest)],
      { cell: "atk-fwd", motion: [[1, 7.5, 0], [12, 3.5, 0], [22, 0.8, 0]] }),
    // UTILT: the same little fireball, flicked straight up from his raised hand
    utilt: mv("utilt", 26, [],
      [key(0, { rot: 8, sy: 0.96 }), key(7, { rot: -4, sy: 1.1, dy: -6 }, true), key(12, { rot: -8, sy: 1.04, dy: -3 }), key(26, rest)], { hook: "flickUp", cell: "atk-up" }),
    // DTILT: he slaps the floor and two fans of fire sweep out from his feet, low at his feet, rising as they go
    dtilt: mv("dtilt", 32, [
      cap([7, 12], 30, -10, 190, -70, 28, 7, 60, 34, 62, { fx: "lick", group: 0 }),
      cap([7, 12], -30, -10, -190, -70, 28, 7, 120, 34, 62, { fx: "lick", group: 1 }),
    ], [key(0, { sy: 0.92, sx: 1.04, dy: 3 }), key(7, { sy: 0.8, sx: 1.18, dy: 8 }, true), key(16, { sy: 0.88, sx: 1.08, dy: 4 }), key(32, rest)], { hook: "floorBurst", cell: "atk-down" }),
    // NAIR: a ring of fire bursts around him and lingers a moment
    nair: mv("nair", 32, [
      hb([6, 9], 0, -60, 62, 9, 50, 34, 70, { fx: "ring", radial: true }),
      hb([10, 18], 0, -60, 58, 5, 50, 24, 50, { fx: "ring", radial: true }),
    ], [key(0, { sy: 0.94 }), key(6, { sx: 1.12, sy: 1.08, rot: 8 }, true), key(12, { rot: -8 }), key(18, { rot: 4 }), key(32, rest)],
      { aerial: true, landingLag: 10, cell: "jump" }),
    // FAIR: the fireball raised, then swept down and through in front of him
    fair: mv("fair", 34, [
      cap([10, 14], 40, -100, 90, -20, 22, 11, 40, 36, 80, { fx: "lick" }),
    ], [key(0, { rot: -10, sy: 1.06 }), key(8, { rot: -16, sy: 1.1 }), key(10, { rot: 18, sy: 0.94, sx: 1.08, dx: 6 }, true), key(20, { rot: 10 }), key(34, rest)],
      { aerial: true, landingLag: 12, cells: [[0, "atk-up"], [10, "atk-fwd"], [13, "atk-down"]] }),
    // BAIR, TOME: he swings the spellbook behind him. Heavy, his hardest-hitting normal.
    bair: mv("bair", 30, [hb([8, 11], -62, -50, 24, 13, 40, 44, 92, { fx: "tome" })],
      [key(0, { rot: 8, sx: 0.94 }), key(8, { rot: -18, sx: 1.12, sy: 0.96, dx: -8 }, true), key(16, { rot: -8 }), key(30, rest)],
      { aerial: true, landingLag: 12, cell: "atk-fwd" }),
    // UAIR: a burst of flame thrown up from the raised fireball
    uair: mv("uair", 30, [hb([8, 13], 20, -134, 30, 10, 88, 32, 80, { fx: "puff" })],
      [key(0, { sy: 0.94, sx: 1.06 }), key(8, { sy: 1.16, sx: 0.92, dy: -10 }, true), key(16, { sy: 1.06, dy: -4 }), key(30, rest)],
      { aerial: true, landingLag: 11, cell: "atk-up" }),
    // DAIR, METEOR: the fireball driven straight down; the first frames spike, and landing out of it sets it off
    dair: mv("dair", 40, [
      hb([12, 14], 24, 4, 40, 13, 270, 30, 80, { fx: "meteor", spike: true, priority: 0 }),
      hb([15, 22], 24, 0, 36, 8, 60, 30, 60, { fx: "meteor", priority: 1 }),
    ], [key(0, { sy: 1.06, dy: -6 }), key(10, { sy: 1.12, dy: -10 }), key(12, { sy: 0.88, dy: 10, sx: 1.06 }, true), key(22, { sy: 0.96 }), key(40, rest)],
      { aerial: true, landingLag: 15, hook: "meteor", cells: [[0, "atk-up"], [12, "atk-down"]] }),
    // BLAST: the fireball raised overhead, then thrust forward and set off
    fsmash: mv("fsmash", 56, [
      hb([18, 22], 104, -56, 46, 19, 38, 44, 98, { fx: "blast", priority: 0 }),
      cap([18, 20], 40, -54, 80, -54, 20, 13, 40, 38, 80, { fx: "jet", priority: 1 }),
    ], [key(0, { rot: -12, sy: 1.08, dx: -6 }), key(14, { rot: -18, sy: 1.12, dx: -10 }), key(18, { rot: 16, sy: 0.92, sx: 1.14, dx: 12 }, true), key(28, { rot: 10, dx: 6 }), key(56, rest)],
      { smash: true, cells: [[0, "atk-up"], [18, "atk-fwd"]] }),
    // PILLAR: crouch over the flame, then a column of fire straight up
    usmash: mv("usmash", 54, [
      hb([16, 18], 36, -30, 30, 6, 88, 60, 20, { fx: "burst", group: 0 }),
      cap([16, 24], 20, -80, 20, -236, 26, 16, 88, 42, 104, { fx: "pillar", group: 1 }),
    ], [key(0, { sy: 0.86, sx: 1.1, dy: 4 }), key(14, { sy: 0.8, sx: 1.14, dy: 6 }), key(16, { sy: 1.2, sx: 0.9, dy: -14 }, true), key(26, { sy: 1.08, dy: -6 }), key(54, rest)],
      { smash: true, cells: [[0, "atk-down"], [16, "atk-up"]] }),
    // WILDFIRE: slams the fireball into the floor; fire runs out both ways
    dsmash: mv("dsmash", 56, [
      cap([16, 22], 10, -12, 134, -12, 22, 15, 26, 46, 90, { fx: "wave", group: 0 }),
      cap([16, 22], -10, -12, -134, -12, 22, 15, 26, 46, 90, { fx: "wave", group: 0 }),
    ], [key(0, { sy: 1.06, dy: -4 }), key(14, { sy: 1.1, dy: -8 }), key(16, { sy: 0.8, sx: 1.16, dy: 6 }, true), key(30, { sy: 0.9 }), key(56, rest)],
      { smash: true, cells: [[0, "atk-up"], [16, "atk-down"]], fx: "quake" }),
    grab: mv("grab", GRAB.total, [hb([GRAB.hit, GRAB.hit + 2], 44, -62, 24, 0, 0, 0, 0, { grab: true })], strikePoses(GRAB.total, GRAB.hit, 10), { isGrab: true, cell: "atk-fwd" }),
    dashGrab: mv("dashGrab", 42, [hb([9, 11], 58, -62, 26, 0, 0, 0, 0, { grab: true })], strikePoses(42, 9, 16), { isGrab: true, cell: "atk-fwd", motion: [[1, 5, 0], [9, 0, 0]] }),
    pummel: mv("pummel", 16, [], [key(0, { rot: 6 }), key(6, { rot: 12, sx: 1.06 }), key(16, { rot: 6 })], { cell: "atk-fwd" }),
    fthrow: toss("fthrow", 42, 60, 70, { rot: 20, sx: 1.1 }),
    bthrow: toss("bthrow", 40, 64, 80, { rot: -30 }),
    uthrow: toss("uthrow", 90, 70, 88, { dy: -12, sy: 1.12 }),
    dthrow: toss("dthrow", 70, 45, 40, { sy: 0.84, sx: 1.12, dy: 12 }),
    // FIREBALL: raise it, (hold to feed it), throw it
    nspecial: mv("nspecial", 42, [], [
      key(0, { sy: 1.02 }), key(11, { rot: -10, sy: 1.08, dx: -4 }), key(14, { rot: 12, sx: 1.14, sy: 0.94, dx: 8 }, true), key(24, { rot: 6 }), key(42, rest),
    ], { hook: "fireball", cells: [[0, "atk-up"], [14, "atk-fwd"]] }),
    // FLAMETHROWER: a stream of flame for as long as special is held and there is heat left
    sspecial: mv("sspecial", 44, [], [
      key(0, { rot: -6, sx: 0.94 }), key(10, { rot: 6, sx: 1.1, sy: 0.96, dx: 6 }, true), key(17, { rot: 3, sx: 1.06, dx: 4 }), key(24, { rot: 7, sx: 1.1, dx: 6 }), key(44, rest),
    ], { hook: "flamethrower", cell: "atk-fwd" }),
    // CREEPER: sets the fireball down on the floor in front of him and lets it go hunting
    dspecial: mv("dspecial", 40, [], [
      key(0, { sy: 1.06, dy: -4 }), key(12, { sy: 0.84, sx: 1.12, dy: 6 }, true), key(22, { sy: 0.92 }), key(40, rest),
    ], { hook: "creeper", cells: [[0, "atk-up"], [12, "atk-down"]] }),
    // FLAME JET: fire pours out behind him and he rides it the way the stick points; at the end eight embers fly out
    uspecial: mv("uspecial", 89, [],
      [key(0, { sy: 0.84, sx: 1.12, dy: 4 }), key(8, { sy: 1.16, sx: 0.9 }, true), key(35, { sy: 1.1, rot: 4 }), key(62, { sy: 1.12, rot: -4 }), key(63, { sx: 1.16, sy: 1.1 }, true), key(75, { sy: 1.04 }), key(89, { rot: 0 })],
      { hook: "jet", helpless: true, ledgeOk: true, cells: [[0, "atk-down"], [8, "jump"], [63, "atk-up"]] }),
    ledgeAttack: mv("ledgeAttack", 40, [cap([12, 15], 30, -40, 110, -36, 18, 9, 40, 38, 70, { fx: "lick" })], [key(0, { rot: -8 }), key(12, { rot: 12, sx: 1.1 }, true), key(40, rest)], { cell: "atk-fwd" }),
    getupAttack: mv("getupAttack", 44, [
      cap([12, 15], 10, -14, 100, -12, 18, 7, 45, 40, 60, { fx: "wave", group: 0 }),
      cap([20, 23], -10, -14, -100, -12, 18, 7, 45, 40, 60, { fx: "wave", group: 1 }),
    ], [key(0, rest), key(12, { rot: 10 }), key(20, { rot: -10 }), key(44, rest)], { cell: "atk-down" }),
    taunt: mv("taunt", 50, [], [key(0, rest), key(10, { dy: -10, sy: 1.1 }), key(20, rest), key(30, { dy: -10, sy: 1.1 }), key(50, rest)], { cell: "atk-up" }),
  };

  const FIREBALLS_MAX = 3, FEED_MAX = 48, GREAT_AT = 30;
  const HEAT_MAX = 100, HEAT_PER_FRAME = 1.4, HEAT_BACK = 0.5, HEAT_COOL = 40, SPRAY_FROM = 10, SPRAY_LOOP = 24;
  const CREEP_LIFE = 300, CREEP_PULL = 0.028, CREEP_TOP = 3, CREEP_FALL = 2, CREEP_EASE = 0.025;
  const ownLive = (state, f, kinds) => {
    let n = 0;
    for (const p of state.projectiles) if (!p.dead && p.from === f.slot && kinds.includes(p.kind)) n++;
    return n;
  };
  return {
    id: "fire-wizard",
    name: "FIRE WIZARD",
    tagline: "Much fire.",
    stats,
    moves,
    rig: { anims: spriteAnims(), loops: spriteLoops },
    palette: { colors: { marker: "#2a7bd4" }, outline: "#24221e" },
    looks,
    special: () => ({ cool: 0, meteor: 0, jx: 0, jy: -1 }),
    bars: {
      heat: { label: "HEAT", color: "#ff7a1a", max: HEAT_MAX, start: HEAT_MAX, trip: 0, rearm: 30 },
      feed: { label: "FEED", color: ORANGE, max: FEED_MAX, show: (f) => f.move === "nspecial", over: true },
    },
    hooks: {
      flick: ({ f, state }) => {
        if (f.frame === 5) spawnProjectile(state, f, "ember", f.x + f.moveFacing * 48, f.y - 56, f.moveFacing * 10, 0, 14,
          { frames: [0, 999], x: 0, y: 0, r: 12, damage: 3, angle: 40, base: 20, growth: 30 });
      },
      flickUp: ({ f, state }) => {
        if (f.frame === 8) spawnProjectile(state, f, "ember", f.x + f.moveFacing * 20, f.y - 130, 0, -10, 16,
          { frames: [0, 999], x: 0, y: 0, r: 14, damage: 6, angle: 88, base: 30, growth: 70 });
      },
      // the fans: a wave of flame running out along each side, taller the further out it gets
      floorBurst: ({ f, state }) => {
        if (f.frame < 7 || f.frame > 12) return;
        const t = (f.frame - 7) / 5;
        for (const side of [1, -1]) fx(state, f, "flame", f.x + side * (30 + t * 160), f.y - 6 - t * 50, 3, t > 0.5 ? RED : ORANGE, 1 + t * 2.5);
      },
      // armed while he's coming down with it; onFrame sets it off if he lands before the move is over
      meteor: ({ f }) => { f.special.meteor = f.frame >= 12 && !f.grounded ? 1 : 0; },
      fireball: ({ f, input, state }) => {
        if (f.frame === 1) f.bars.feed = 0;
        // frame 12 held: the fireball over his head grows, flames licking up off it faster the more it's fed;
        // a ring when it turns into a GREAT FIREBALL and another when it can't take more
        if (f.frame === 12 && (input.b & B.SPECIAL) && f.bars.feed < FEED_MAX) {
          f.bars.feed++;
          const c = f.bars.feed / FEED_MAX;
          if (f.bars.feed % (c > 0.6 ? 1 : 2) === 0) fx(state, f, "flame", f.x + f.moveFacing * 30, f.y - 88, 1 + Math.round(c * 3), ORANGE);
          if (f.bars.feed === GREAT_AT || f.bars.feed === FEED_MAX) fx(state, f, "ring", f.x + f.moveFacing * 30, f.y - 88, f.bars.feed === FEED_MAX ? 3 : 1, YELLOW);
          f.frame = 11;
          return;
        }
        if (f.frame !== 14 || ownLive(state, f, ["fireball", "bigFireball"]) >= FIREBALLS_MAX) return;
        const feed = f.bars.feed, great = feed >= GREAT_AT;
        const x = f.x + f.moveFacing * 52, y = f.y - 54;
        if (great) {
          spawnProjectile(state, f, "bigFireball", x, y, f.moveFacing * 6.5, 0, 120,
            { frames: [0, 999], x: 0, y: 0, r: 32, damage: 15, angle: 40, base: 50, growth: 92 });
        } else {
          spawnProjectile(state, f, "fireball", x, y, f.moveFacing * 9.5, 0, 75,
            { frames: [0, 999], x: 0, y: 0, r: 17, damage: 6 + feed * 0.1, angle: 40, base: 22, growth: 38 });
        }
      },
      flamethrower: ({ f, input, state }) => {
        if (f.frame < SPRAY_FROM) return;
        if (!f.grounded) f.vy = Math.min(f.vy, 1.4);
        const spraying = f.frame <= SPRAY_LOOP && !tripped(f, "heat");
        if (!spraying) return;
        f.bars.heat -= HEAT_PER_FRAME;
        f.special.cool = HEAT_COOL;
        if ((f.frame - SPRAY_FROM) % 3 === 0) {
          const wobble = ((state.frame % 5) - 2) * 0.35;
          spawnProjectile(state, f, "flame", f.x + f.moveFacing * 58, f.y - 54, f.moveFacing * 8.5, wobble, 22,
            { frames: [0, 999], x: 0, y: 0, r: 16, damage: 1.6, angle: 40, base: 10, growth: 10 }, { g: -0.1 });
        }
        // keep spraying while held and hot
        if (f.frame === SPRAY_LOOP && (input.b & B.SPECIAL) && !tripped(f, "heat")) f.frame = SPRAY_LOOP - 7;
      },
      creeper: ({ f, state }) => {
        if (f.frame !== 12 || ownLive(state, f, ["creeper"])) return;
        const hit = { frames: [0, 999], x: 0, y: 0, r: 28, damage: 3, angle: 80, base: 40, growth: 28, rehit: 30 };
        if (f.grounded) spawnProjectile(state, f, "creeper", f.x + f.moveFacing * 70, f.y - 28, 0, 0, CREEP_LIFE, hit, { landed: 1 });
        else spawnProjectile(state, f, "creeper", f.x + f.moveFacing * 40, f.y - 10, f.moveFacing * 0.8, 0.5, CREEP_LIFE, hit, { g: 0.1, bounce: 1, landed: 0 });
      },
      // the jet points where the stick does (straight up when it's let go), turning toward it rather than snapping
      jet: ({ f, input, state }) => {
        if (f.frame === 8) { f.grounded = false; f.platform = -1; f.usedUpSpecial = true; f.special.jx = 0; f.special.jy = -1; }
        if (f.frame < 8 || f.frame > 62) return;
        const len = Math.sqrt(input.x * input.x + input.y * input.y);
        if (len > 30) {
          const tx = f.special.jx + (input.x / len - f.special.jx) * 0.2, ty = f.special.jy + (input.y / len - f.special.jy) * 0.2;
          const n = Math.sqrt(tx * tx + ty * ty) || 1;
          f.special.jx = tx / n; f.special.jy = ty / n;
        }
        const speed = 8.8 - (f.frame - 8) * 0.02;
        f.vx = f.special.jx * speed;
        f.vy = f.special.jy * speed;
        // the exhaust, streaming out behind him along the jet: it's what burns (every 5 frames, like the old jet),
        // with flames licking off it and a low rumble
        const bx = f.x - f.special.jx * 40, by = f.y - 50 - f.special.jy * 40;
        if (f.frame % 5 === 3) spawnProjectile(state, f, "exhaust", bx, by, -f.special.jx * 7, -f.special.jy * 7, 7,
          { frames: [0, 999], x: 0, y: 0, r: 26, damage: 2, angle: 80, base: 20, growth: 10 });
        fx(state, f, "flame", bx, by, 2, ORANGE, 1.4);
        if (f.frame % 4 === 0) fx(state, f, "shake", f.x, f.y, 0, undefined, 0.3);
        if (f.frame === 62) for (let i = 0; i < 8; i++) {
          const cx = api.cosDeg(i * 45), sy = api.sinDeg(i * 45);
          spawnProjectile(state, f, "ember", f.x + cx * 30, f.y - 60 - sy * 30, cx * 9, -sy * 9, 18,
            { frames: [0, 999], x: 0, y: 0, r: 14, damage: 4, angle: 45, base: 36, growth: 60, radial: true });
        }
      },
    },
    onFrame: ({ f, state }) => {
      if (f.special.meteor && f.grounded) {
        f.special.meteor = 0;
        spawnProjectile(state, f, "boom", f.x, f.y - 30, 0, 0, 10,
          { frames: [0, 999], x: 0, y: 0, r: 70, damage: 10, angle: 70, base: 48, growth: 74 });
        fx(state, f, "flame", f.x, f.y - 6, 10, ORANGE);
        fx(state, f, "ring", f.x, f.y - 30, 4, YELLOW);
      } else if (f.special.meteor && f.move !== "dair") f.special.meteor = 0;
      if (f.special.cool > 0) f.special.cool--;
      else f.bars.heat += HEAT_BACK;
      // the creeper: a dropped one settles where it lands; on the floor it rolls after the nearest enemy, picking up
      // speed from afar and easing off as it closes in
      for (const p of state.projectiles) {
        if (p.dead || p.kind !== "creeper" || p.from !== f.slot) continue;
        if (!p.data.landed) {
          // dropped from the air it drifts down slowly
          if (!p.data.bounces) { p.vy = Math.min(p.vy, CREEP_FALL); continue; }
          p.data.landed = 1; p.data.g = 0; p.vx = 0; p.vy = 0; p.y -= 28;
        }
        let near = null, best = Infinity;
        for (const o of state.fighters) {
          if (o === f || o.stocks <= 0 || o.action === "dead" || o.action === "respawn") continue;
          const d = Math.abs(o.x - p.x);
          if (d < best) { best = d; near = o; }
        }
        if (!near) continue;
        const want = Math.sign(near.x - p.x) * Math.min(CREEP_TOP, 0.6 + best * CREEP_EASE);
        p.vx += Math.max(-CREEP_PULL * 2, Math.min(CREEP_PULL, (want - p.vx) * Math.sign(want || 1))) * Math.sign(want || 1);
      }
    },
    // feeding the fireball: he glows, braces and shakes harder the bigger it gets
    visual: (f) => {
      if (f.move !== "nspecial" || f.frame > 12) return {};
      const c = f.bars.feed / FEED_MAX;
      return { glow: c, scale: 1 + 0.04 * c, shake: 4 * c };
    },
  };
}
