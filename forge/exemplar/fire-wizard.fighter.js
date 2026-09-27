// FIRE WIZARD: a pointy blue hat, a spellbook in one hand and a live fireball in the other. "Much fire."
// The second example, a caster: read SWORD GUY first. What's his own here is the fire, drawn rather than
// cut from a cell (the fireball look), and the special fed from the hand (the FEED bar and its effects).
//
// Everything he does comes out of the fireball in his raised hand, except the book, which he swings.
//   NORMALS   a flick of sparks then a puff (jab), a short flame jet (ftilt), the fireball swept overhead
//             (utilt), flames licking along the floor (dtilt), a running fireball shove (dash attack).
//             Air: a ring of fire (nair), the fireball swept down (fair), a TOME smack behind (bair, the
//             book is his hardest-hitting normal), a flame burst up (uair), a METEOR spike down (dair).
//   SMASHES   BLAST (a fireball explosion in front), PILLAR (a column of fire up), WILDFIRE (fire along
//             the floor, both sides).
//   SPECIAL   FIREBALL: throws the fireball from his hand; hold to feed it into a GREAT FIREBALL. Up to
//             three out at once.
//             Side: FLAMETHROWER, a stream of flame for as long as he holds it and has HEAT (meter).
//             Down: FIRE WALL, a patch of fire on the floor that burns anyone standing in it (one at a
//             time; in the air it drops as an ember and catches where it lands).
//   RECOVERY  FLAME JET: he rides a jet of fire straight up, steerable, bursting at the top. Helpless after.
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
    // flamethrower puffs: little rising blobs of flame
    flame: { shape: "blob", color: ORANGE, ink: RED, texture: "flame", size: 38, spin: 14, aim: false, trail: "none" },
    // the fire wall: a standing blaze
    firewall: { shape: "cloud", color: ORANGE, ink: RED, texture: "flame", size: 96, spin: 3, aim: false, trail: "none" },
    // tilts and light aerials: a lick of flame
    lick: { shape: "slash", color: YELLOW, ink: RED, texture: "flame" },
    spark: { shape: "star", color: YELLOW, ink: RED, texture: "glow", size: 40, spin: 20, aim: false },
    puff: { shape: "cloud", color: ORANGE, ink: RED, texture: "flame", size: 90, spin: 8, aim: false },
    jet: { shape: "bolt", color: ORANGE, ink: RED, texture: "flame", size: 90 },
    ring: { shape: "ring", color: ORANGE, ink: RED, texture: "flame", size: 150, spin: 24, aim: false },
    meteor: { shape: "ball", color: RED, ink: "#7a1a10", texture: "flame", size: 70 },
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
    // JAB: a flick of sparks off the fireball, then (tap again) a puff of flame
    jab1: mv("jab1", 18, [hb([4, 6], 54, -54, 18, 3, 50, 18, 30, { fx: "spark" })],
      [key(0, { sx: 0.96 }), key(4, { sx: 1.1, sy: 0.96, dx: 4 }, true), key(10, { sx: 1.02 }), key(18, rest)], { iasa: 14, next: "jab2", nextFrom: 7, cell: "atk-fwd" }),
    jab2: mv("jab2", 28, [hb([6, 9], 66, -54, 24, 6, 42, 36, 60, { fx: "puff" })],
      [key(0, { rot: -6, sx: 0.94 }), key(6, { rot: 10, sx: 1.12, sy: 0.94, dx: 6 }, true), key(14, { rot: 6 }), key(28, rest)], { cell: "atk-fwd" }),
    // FTILT: a short jet of flame straight out of his palm
    ftilt: mv("ftilt", 32, [cap([9, 13], 44, -52, 124, -52, 17, 10, 38, 36, 80, { fx: "jet" })],
      [key(0, { rot: -10, sx: 0.94, dx: -4 }), key(9, { rot: 8, sx: 1.12, sy: 0.95, dx: 8 }, true), key(18, { rot: 4, sx: 1.04 }), key(32, rest)], { cell: "atk-fwd" }),
    // DASH ATTACK: running, he shoves the fireball out in front of him
    dashAttack: mv("dashAttack", 38, [hb([8, 14], 60, -52, 28, 10, 45, 40, 72, { fx: "puff" })],
      [key(0, { rot: -6, sx: 0.92 }), key(8, { rot: 14, sx: 1.2, sy: 0.92, dx: 10 }, true), key(20, { rot: 8, sx: 1.06 }), key(38, rest)],
      { cell: "atk-fwd", motion: [[1, 7.5, 0], [12, 3.5, 0], [22, 0.8, 0]] }),
    // UTILT: the fireball swept over his head, front to back
    utilt: mv("utilt", 30, [
      cap([7, 9], 50, -90, 20, -128, 22, 8, 86, 32, 78, { fx: "lick", group: 0 }),
      cap([10, 12], 20, -128, -40, -110, 22, 8, 100, 32, 78, { fx: "lick", group: 1 }),
    ], [key(0, { rot: 8, sy: 0.96 }), key(7, { rot: -4, sy: 1.1, dy: -6 }, true), key(12, { rot: -14, sy: 1.06, dy: -4 }), key(30, rest)], { cell: "atk-up" }),
    // DTILT: flames licking along the floor from his low hand
    dtilt: mv("dtilt", 26, [cap([6, 10], 24, -14, 104, -10, 15, 7, 24, 30, 62, { fx: "lick" })],
      [key(0, { sy: 0.92, sx: 1.04, dy: 3 }), key(6, { sy: 0.84, sx: 1.14, rot: 12, dy: 6 }, true), key(14, { sy: 0.88, sx: 1.08, rot: 6 }), key(26, rest)], { cell: "atk-down" }),
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
    // DAIR, METEOR: the fireball driven straight down; the first frames spike
    dair: mv("dair", 40, [
      hb([12, 14], 24, 4, 26, 13, 270, 30, 80, { fx: "meteor", spike: true, priority: 0 }),
      hb([15, 20], 24, 0, 24, 8, 60, 30, 60, { fx: "meteor", priority: 1 }),
    ], [key(0, { sy: 1.06, dy: -6 }), key(10, { sy: 1.12, dy: -10 }), key(12, { sy: 0.88, dy: 10, sx: 1.06 }, true), key(22, { sy: 0.96 }), key(40, rest)],
      { aerial: true, landingLag: 15, cells: [[0, "atk-up"], [12, "atk-down"]] }),
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
    // FIRE WALL: slaps the fireball onto the floor in front of him, where it keeps burning
    dspecial: mv("dspecial", 40, [], [
      key(0, { sy: 1.06, dy: -4 }), key(12, { sy: 0.84, sx: 1.12, dy: 6 }, true), key(22, { sy: 0.92 }), key(40, rest),
    ], { hook: "firewall", cells: [[0, "atk-up"], [12, "atk-down"]] }),
    // FLAME JET: fire pours out beneath him and he rides it up; a burst at the top
    uspecial: mv("uspecial", 54, [
      cap([8, 28], 0, 0, 0, 60, 26, 2, 80, 20, 10, { fx: "jet", rehit: 5 }),
      hb([29, 32], 0, -60, 56, 7, 85, 52, 84, { fx: "burst", group: 1, radial: true }),
    ], [key(0, { sy: 0.84, sx: 1.12, dy: 4 }), key(8, { sy: 1.16, sx: 0.9 }, true), key(18, { sy: 1.1, rot: 4 }), key(28, { sy: 1.12, rot: -4 }), key(29, { sx: 1.16, sy: 1.1 }, true), key(40, { sy: 1.04 }), key(54, { rot: 0 })],
      { hook: "jet", helpless: true, ledgeOk: true, cells: [[0, "atk-down"], [8, "jump"], [29, "atk-up"]] }),
    ledgeAttack: mv("ledgeAttack", 40, [cap([12, 15], 30, -40, 110, -36, 18, 9, 40, 38, 70, { fx: "lick" })], [key(0, { rot: -8 }), key(12, { rot: 12, sx: 1.1 }, true), key(40, rest)], { cell: "atk-fwd" }),
    getupAttack: mv("getupAttack", 44, [
      cap([12, 15], 10, -14, 100, -12, 18, 7, 45, 40, 60, { fx: "wave", group: 0 }),
      cap([20, 23], -10, -14, -100, -12, 18, 7, 45, 40, 60, { fx: "wave", group: 1 }),
    ], [key(0, rest), key(12, { rot: 10 }), key(20, { rot: -10 }), key(44, rest)], { cell: "atk-down" }),
    taunt: mv("taunt", 50, [], [key(0, rest), key(10, { dy: -10, sy: 1.1 }), key(20, rest), key(30, { dy: -10, sy: 1.1 }), key(50, rest)], { cell: "atk-up" }),
  };

  const FIREBALLS_MAX = 3, FEED_MAX = 48, GREAT_AT = 30;
  const HEAT_MAX = 100, HEAT_PER_FRAME = 1.4, HEAT_BACK = 0.5, HEAT_COOL = 40, SPRAY_FROM = 10, SPRAY_LOOP = 24;
  const WALL_LIFE = 240;
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
    special: () => ({ cool: 0 }),
    bars: {
      heat: { label: "HEAT", color: "#ff7a1a", max: HEAT_MAX, start: HEAT_MAX, trip: 0, rearm: 30 },
      feed: { label: "FEED", color: ORANGE, max: FEED_MAX, show: (f) => f.move === "nspecial", over: true },
    },
    hooks: {
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
      firewall: ({ f, state }) => {
        if (f.frame !== 12 || ownLive(state, f, ["firewall"])) return;
        const hit = { frames: [0, 999], x: 0, y: 0, r: 36, damage: 3, angle: 80, base: 40, growth: 28, rehit: 30 };
        if (f.grounded) spawnProjectile(state, f, "firewall", f.x + f.moveFacing * 70, f.y - 36, 0, 0, WALL_LIFE, hit);
        else spawnProjectile(state, f, "firewall", f.x + f.moveFacing * 40, f.y - 10, f.moveFacing * 1.5, 3, WALL_LIFE, hit, { g: 0.5, bounce: 1, landed: 0 });
      },
      jet: ({ f, input }) => {
        if (f.frame === 8) { f.grounded = false; f.platform = -1; f.usedUpSpecial = true; }
        if (f.frame >= 8 && f.frame <= 28) {
          f.vy = -12.5 + (f.frame - 8) * 0.28;
          f.vx = (input.x / 100) * 3;
        }
      },
    },
    onFrame: ({ f, state }) => {
      if (f.special.cool > 0) f.special.cool--;
      else f.bars.heat += HEAT_BACK;
      // a dropped ember catches where it lands and becomes a wall
      for (const p of state.projectiles) {
        if (p.dead || p.kind !== "firewall" || p.from !== f.slot || p.data.landed !== 0 || !p.data.bounces) continue;
        p.data.landed = 1;
        p.data.g = 0;
        p.vx = 0; p.vy = 0;
        p.y -= 36;
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
