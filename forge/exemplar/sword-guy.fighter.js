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
//   Every strike is drawn (see `draws` at the bottom). Cuts are a steel crescent swept through the hitbox,
//   arriving as it comes out and thinning away after; level swings are an oval round him; stabs shoot out
//   along the blade; smashes are heavier hatched steel; the drive is fire pouring off the blade, nothing like
//   the sword. A player should be able to tell the moves apart from the shape alone.
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
  const { hb, cap, key, mv, throwMove, spawnProjectile, spriteAnims, spriteLoops, clamp, sign, fx, B, sinDeg, cosDeg, atan2Deg } = api;

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
  // draws (at the bottom) draw every move; a look only names a hitbox's `fx` and colours its hit sparks
  const looks = {
    blade: { color: "#3f6fb5" },
    cut: { color: "#dce6f2" }, point: { color: "#3f6fb5" }, chop: { color: "#7fa3d9" }, skewer: { color: "#3f6fb5" },
    sweep: { color: "#7fa3d9" }, drive: { color: "#ff8a2a" }, tornado: { color: "#e8eef8" }, tornadoBurst: { color: "#bcd0ee" },
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
      // set knockback (growth 0): the same shove at any percent, angled just past straight up so they ride up with him
      hb([5, 22], 0, -70, 66, 2, 95, 66, 0, { fx: "tornado", rehit: 4 }),
      hb([23, 26], 0, -200, 22, 7, 88, 50, 90, { fx: "point", group: 1 }),
      cap([23, 27], 0, -80, 0, -186, 15, 5, 86, 40, 60, { fx: "skewer", group: 1, priority: 1 }),
    ], [key(0, { sy: 0.86, sx: 1.1 }), key(5, { sy: 1.14, sx: 0.92 }, true), key(9, { sx: 0.3 }), key(13, { sx: 1.0, rot: -8 }), key(17, { sx: 0.3 }), key(21, { sx: 1.0, rot: 8 }), key(23, { sy: 1.2, sx: 0.9, dy: -12 }, true), key(36, { sy: 1.06 }), key(56, { rot: 0 })],
      { hook: "rise", helpless: true, ledgeOk: true, cells: [[0, "jump"], [5, "atk-fwd"], [9, "block"], [13, "atk-fwd"], [17, "block"], [21, "atk-fwd"], [23, "atk-up"]] }),
    ledgeAttack: mv("ledgeAttack", 40, [cap([12, 15], 10, -50, 110, -46, 18, 9, 40, 38, 70, { fx: "cut" })], [key(0, { rot: -8 }), key(12, { rot: 14, sx: 1.1 }, true), key(40, rest)], { cell: "atk-fwd" }),
    getupAttack: mv("getupAttack", 44, [cap([12, 15], 10, -30, 100, -20, 18, 7, 45, 40, 60, { fx: "cut", group: 0 }), cap([20, 23], -10, -30, -100, -20, 18, 7, 45, 40, 60, { fx: "cut", group: 1 })], [key(0, rest), key(12, { rot: 12 }), key(20, { rot: -12 }), key(44, rest)], { cell: "atk-down" }),
  };

  const BLADE_OUT = 16, BLADE_BACK = 0.6;
  const DRIVE_CHARGE_MAX = 45, DRIVE_FRAMES = 18;

  // HOW HIS MOVES ARE DRAWN. Each draw runs every frame of the move named the same, with g (see DrawKit):
  // the move's hitboxes in world space, pose() for a pixel of the cell on screen, and a pencil-and-marker brush.
  // The sword's arcs are swept through the hitbox they cut with, so what you see is what hits.
  const STEEL = "#dce6f2", BLUE = "#3f6fb5", INKC = "#24221e", FIRE = "#ff8a2a", EMBER = "#c93a1c", CORE = "#fff2a8";
  const ease = (t) => 1 - (1 - t) * (1 - t);
  const angTo = (g, p, q) => atan2Deg(-(q[1] - p[1]), (q[0] - p[0]) * g.facing);
  const dist = (p, q) => Math.sqrt((q[0] - p[0]) * (q[0] - p[0]) + (q[1] - p[1]) * (q[1] - p[1]));
  const bump = (t) => sinDeg(180 * clamp(t, 0, 1));
  const far = (h) => [h.x2, h.y2];
  // a blade swept along a path from angle a to b: the head sweeps in over the frames before s and reaches b as the
  // hitbox goes live; the cut hangs there while it's live, then thins and fades as the tail draws in.
  // `path(deg, off)` is a point on the path, `off` units outward from it.
  const sweep = (g, path, a, b, s, e, o = {}) => {
    const w = o.width ?? 26, lag = o.lag ?? 8, lead = o.lead ?? 4;
    const head = ease(g.span(s - lead, s)), fade = g.span(e, e + lag);
    if (head <= 0 || fade >= 1) return;
    const tail = Math.max(head - (o.len ?? 1), fade * 0.6);
    const ha = a + (b - a) * head, ta = a + (b - a) * tail;
    const along = (from, to, off, n) => { const pts = []; for (let k = 0; k <= n; k++) pts.push(path(from + (to - from) * k / n, off)); return pts; };
    const thin = (1 - fade) * (1 - fade);
    g.ribbon(along(ta, ha, -w * 0.35, 30), { width: (t) => w * thin * bump(t * Math.sqrt(t)), color: o.color ?? STEEL, ink: o.ink ?? BLUE, hatch: o.hatch, core: o.core ?? "#ffffff", alpha: 1 - fade });
    const span = ha - ta;
    for (const k of [-1, 1]) g.line(along(ta + span * 0.3, ha - span * 0.1, -w * 0.35 + k * w * 0.8, 18), { color: o.ink ?? BLUE, width: 1.6, alpha: 0.8 * thin });
  };
  const swing = (g, pivot, r, a, b, s, e, o) => sweep(g, (deg, off) => g.toward(pivot, deg, r + off), a, b, s, e, o);
  // a level swing seen from the side: an oval round (cx, cy) in fighter space, behind him to in front
  const level = (g, cx, cy, rx, ry, a, b, s, e, o) => sweep(g, (deg, off) => g.at(cx + cosDeg(deg) * (rx + off), cy - sinDeg(deg) * (ry + off * ry / rx)), a, b, s, e, o);
  // a straight thrust along hitbox i: shoots out from its near end, then pulls in from behind
  const thrust = (g, i, o = {}) => {
    const h = g.hit(i), [s, e] = h.frames, lag = o.lag ?? 6;
    if (g.frame < s - 2) return;
    const fade = g.span(e, e + lag);
    if (fade >= 1) return;
    const a = [h.x1, h.y1], b = [h.x2, h.y2], len = dist(a, b) || 1;
    const d = [(b[0] - a[0]) / len, (b[1] - a[1]) / len], n = [-d[1], d[0]];
    const tip = [b[0] + d[0] * h.r * 0.9, b[1] + d[1] * h.r * 0.9];
    const head = g.lerp(a, tip, ease(g.span(s - 2, s))), base = g.lerp(a, head, fade);
    const pts = []; for (let k = 0; k <= 8; k++) pts.push(g.lerp(base, head, k / 8));
    const w = o.width ?? h.r * 1.1;
    g.ribbon(pts, { width: (t) => w * (1 - fade * 0.6) * (t < 0.8 ? 0.35 + t * 0.8 : (1 - t) * 5), color: o.color ?? STEEL, ink: o.ink ?? BLUE, core: o.core ?? "#ffffff", hatch: o.hatch });
    for (let k = -2; k <= 2; k++) {
      if (!k) continue;
      const off = k * w * 0.42, back = len * (0.25 + g.noise(k * 7 + s) * 0.35);
      const p0 = [base[0] + n[0] * off - d[0] * back, base[1] + n[1] * off - d[1] * back];
      const p1 = g.lerp(p0, [head[0] + n[0] * off * 0.6, head[1] + n[1] * off * 0.6], 0.55);
      g.line([p0, p1], { color: o.ink ?? BLUE, width: 1.5, alpha: 0.75 * (1 - fade) });
    }
  };
  // the point landing: a pop of ink dashes where hitbox i's far end is
  const pop = (g, i, o = {}) => {
    const h = g.hit(i), s = h.frames[0];
    g.flecks(far(h), { t: g.span(s, s + (o.frames ?? 10)), n: o.n ?? 9, dist: o.dist ?? 46, len: o.len ?? 16, color: o.color ?? BLUE, width: 2.4, seed: s * 13 });
    if (g.frame >= s && g.frame <= s + 2) g.blob(far(h), h.r * (0.6 + 0.25 * (g.frame - s)), { color: o.flash ?? "#ffffff", ink: o.color ?? BLUE, alpha: 0.9 });
  };
  // a cut swept round pivot through hitbox i's far end, `sweep` degrees long (sign = direction)
  const cutThrough = (g, i, pivot, sweep, o = {}) => {
    const h = g.hit(i), end = angTo(g, pivot, far(h)), r = dist(pivot, far(h)) + h.r * 0.6;
    swing(g, pivot, r, end + sweep, end - (o.over ?? 12) * Math.sign(sweep), h.frames[0], h.frames[1], { width: h.r * 1.5, ...o });
  };
  // ground dust: pale puffs that swell and fade along the floor
  const dust = (g, x0, x1, s, n = 4) => {
    const t = g.span(s, s + 16);
    if (t <= 0 || t >= 1) return;
    for (let k = 0; k < n; k++) g.blob(g.at(x0 + (x1 - x0) * k / (n - 1), -6 - t * 8), 5 + t * 9 + g.noise(k * 5) * 4, { color: "#efe9dc", ink: "#b3ab9a", alpha: 0.6 * (1 - t), seed: k * 31 + s });
  };
  // a whirl of rings round c, spinning: the far half of each ring passes behind him, the near half in front
  const whirl = (g, c, rx, height, alpha, o = {}) => {
    const rings = o.rings ?? 4;
    for (let k = 0; k < rings; k++) {
      const y = c[1] - height / 2 + height * k / (rings - 1), r = rx * (0.75 + 0.35 * k / rings);
      const a0 = g.frame * (o.spin ?? 38) + k * 83;
      const at = (a) => [c[0] + cosDeg(a) * r, y + sinDeg(a) * r * 0.28];
      // split the 220-degree stroke where it crosses from the far side (sin < 0) to the near side
      let run = [], far = sinDeg(a0) < 0;
      const flush = (n) => {
        if (run.length < 2) return;
        const pts = run, mark = () => g.ribbon(pts, { width: (t) => (o.width ?? 12) * bump(t), color: o.color ?? "#eef3fa", ink: o.ink ?? BLUE, alpha: alpha * (far ? 0.7 : 1) });
        far ? g.under(mark) : mark();
      };
      for (let j = 0; j <= 20; j++) {
        const a = a0 + j * 11, side = sinDeg(a) < 0;
        if (side !== far) { run.push(at(a)); flush(); run = [at(a)]; far = side; } else run.push(at(a));
      }
      flush();
    }
  };
  // fire pouring back from `tip` to `tail`: tongues that lick and flicker, a hot core, each boiling on its own
  const flame = (g, tail, tip, w, alpha, seed) => {
    const len = dist(tail, tip) || 1, d = [(tip[0] - tail[0]) / len, (tip[1] - tail[1]) / len], n = [-d[1], d[0]];
    const tongue = (k, scale, color, ink) => {
      const pts = [], wob = w * 0.5 * scale, start = 0.12 * k;
      for (let j = 0; j <= 12; j++) {
        const t = start + (1 - start) * j / 12;
        const side = (g.noise(seed + k * 71 + j * 13 + g.frame * 29) - 0.5) * wob * (1 - t) * 2 + (k - 1.5) * w * 0.18 * (1 - t);
        const p = g.lerp(tail, tip, t);
        pts.push([p[0] + n[0] * side, p[1] + n[1] * side]);
      }
      g.ribbon(pts, { width: (t) => w * scale * Math.sqrt(t) * (t > 0.85 ? (1 - t) / 0.15 : 1), color, ink, alpha });
    };
    for (let k = 0; k < 4; k++) tongue(k, 0.55 - k * 0.06, FIRE, EMBER);
    tongue(1, 0.42, "#ffb43a", "#ff8a2a");
    tongue(2, 0.26, CORE, "#ffb43a");
  };

  const draws = {
    // the thrown sword (a projectile: frame is its age, at() measures from it): the blade cut out of the lunge
    // cell, spinning end over end inside a whirl of its own swipes
    blade: (g) => {
      const c = g.at(0, 0), spin = -26 * g.frame;
      for (let k = 1; k <= 2; k++) g.line(g.arc(c, 46 + k * 4, spin + 40 * k, spin + 40 * k + 120, 14), { color: BLUE, width: 2.2 - k * 0.6, alpha: 0.7 / k });
      g.cell("atk-fwd", c, { crop: [298, 290, 132, 50], size: 100, deg: spin });
    },
    jab1: (g) => { thrust(g, 0, { width: 16 }); pop(g, 0, { n: 5, dist: 26 }); },
    jab2: (g) => { const h = g.hit(0); level(g, 50, -60, 66, 34, 160, 330, h.frames[0], h.frames[1], { width: 24 }); },
    ftilt: (g) => { if (g.hit(0).live) g.smear({ count: 2 }); const h = g.hit(0); level(g, 40, -58, 92, 30, 230, 345, h.frames[0], h.frames[1], { width: 30, lead: 5 }); },
    dashAttack: (g) => { g.smear({ count: 4, alpha: 0.5 }); thrust(g, 1, { width: 22 }); pop(g, 0, { dist: 60 }); dust(g, -60, 0, 9, 3); },
    utilt: (g) => {
      // one arc over his head, front to back, cut through both hitboxes
      const p = g.at(0, -70), a = g.hit(0), b = g.hit(1);
      const r = dist(p, [b.x1, b.y1]) + 10;
      swing(g, p, r, angTo(g, p, [a.x1, a.y1]) - 10, angTo(g, p, [b.x2, b.y2]) + 10, b.frames[0], b.frames[1], { width: 30, lead: b.frames[0] - a.frames[0] + 3 });
    },
    dtilt: (g) => { const h = g.hit(0); level(g, 56, -16, 66, 12, 215, 350, h.frames[0], h.frames[1], { width: 22 }); dust(g, 40, 120, 8); },
    nair: (g) => {
      // a full turn: the cut starts in front, comes over the top and finishes behind
      const p = g.at(0, -62), a = g.hit(0), b = g.hit(1);
      if (a.live || b.live) g.smear({ count: 3 });
      swing(g, p, 108, -10, 190, b.frames[0], b.frames[1], { width: 28, len: 0.6, lead: b.frames[0] - a.frames[0] + 3 });
    },
    fair: (g) => {
      const hand = g.frame >= 11 ? g.pose(312, 317) : g.at(10, -90);
      cutThrough(g, 0, hand, 130, { width: 40, color: "#b9cdee", hatch: true, ink: INKC });
      if (g.hit(0).live) g.smear({ count: 3 });
      pop(g, 0, { color: INKC });
    },
    bair: (g) => { thrust(g, 1, { width: 22 }); pop(g, 0, { dist: 56, color: INKC }); },
    uair: (g) => { thrust(g, 1, { width: 24 }); pop(g, 0, { dist: 56 }); },
    dair: (g) => { for (let i = 0; i < 3; i++) thrust(g, i, { width: i === 2 ? 30 : 18, lag: 4, color: i === 2 ? "#b9cdee" : STEEL, ink: i === 2 ? INKC : BLUE }); pop(g, 2, { color: INKC, dist: 60 }); },
    fsmash: (g) => {
      // CHOP: overhead to forward through the tip; the pivot is the hand as drawn, so the arc rides his lunge
      const hand = g.frame >= 18 ? g.pose(312, 317) : g.pose(317, 210);
      if (g.frame >= 17 && g.frame <= 24) g.smear({ count: 4, alpha: 0.55 });
      cutThrough(g, 0, hand, 150, { width: 52, color: "#b9cdee", hatch: true, ink: INKC, lag: 10 });
      pop(g, 0, { n: 12, dist: 80, len: 22, color: INKC });
      dust(g, 60, 160, 20, 3);
    },
    usmash: (g) => {
      thrust(g, 1, { width: 36, color: "#b9cdee", ink: INKC, hatch: true, lag: 8 });
      pop(g, 0, { n: 12, dist: 70, len: 20, color: INKC });
      if (g.frame >= 15 && g.frame <= 20) g.smear({ count: 3 });
      dust(g, -50, 50, 15, 3);
    },
    dsmash: (g) => {
      // a low ring round his feet: the near side forward, then the far side back
      const a = g.hit(0), b = g.hit(1), heavy = { width: 30, color: "#b9cdee", hatch: true, ink: INKC, lead: 5 };
      level(g, 0, -18, 128, 20, 200, 355, a.frames[0], a.frames[1], heavy);
      level(g, 0, -18, 128, 20, 20, 175, b.frames[0], b.frames[1], heavy);
      dust(g, 30, 150, 16); dust(g, -30, -150, 24);
    },
    sspecial: (g) => {
      const c = (g.bars.drive ?? 0) / DRIVE_CHARGE_MAX, tip = g.pose(420, 303), hilt = g.pose(312, 317);
      if (g.frame <= 14) {
        // charging: the blade catches, burning brighter the longer it's held
        if (c > 0) flame(g, g.lerp(hilt, tip, 0.2), g.lerp(hilt, tip, 1.1), 10 + c * 16, 0.6 + c * 0.4, 3);
        return;
      }
      const h = g.hit(0), fade = g.span(h.frames[1], h.frames[1] + 10);
      if (fade >= 1) return;
      g.smear({ count: 4, alpha: 0.5 });
      // the blade is the flame's tip; it streams back past him, and he's drawn over it
      g.under(() => flame(g, g.at(-110 - c * 60, -50), [h.x2 + h.r * 0.6 * g.facing, h.y2], h.r * 1.6 * (1 - fade * 0.8), 1 - fade, 11));
      g.flecks(g.at(-20, -60), { t: (g.frame % 8) / 8, n: 5, dist: 70, deg: 170, spread: 60, len: 10, color: EMBER, seed: Math.floor(g.frame / 8) });
    },
    dspecial: (g) => {
      const spin = g.hit(0), burst = g.hit(1), c = g.at(0, -66);
      if (g.frame >= 5 && g.frame <= 36) whirl(g, c, spin.r * 1.05, 120, Math.min(1, g.span(5, 9)) * (1 - g.span(34, 37)), { spin: 34 });
      if (g.frame >= 5 && g.frame <= 34) g.smear({ count: 2, alpha: 0.35 });
      const t = g.span(burst.frames[0], burst.frames[0] + 14);
      if (t > 0 && t < 1) {
        g.ribbon(g.arc(c, burst.r * (0.6 + 0.5 * ease(t)), 0, 360, 36), { width: 18 * (1 - t), color: STEEL, ink: BLUE, alpha: 1 - t });
        g.flecks(c, { t, n: 14, dist: burst.r * 1.4, len: 24, color: BLUE, seed: 5 });
        dust(g, -110, 110, burst.frames[0], 5);
      }
    },
    uspecial: (g) => {
      const c = g.at(0, -66), spin = g.hit(0);
      if (g.frame >= 5 && g.frame <= 23) { whirl(g, c, spin.r, 140, g.span(5, 8) * (1 - g.span(21, 24)), { spin: -40, rings: 3 }); g.smear({ count: 3, alpha: 0.35 }); }
      thrust(g, 2, { width: 26 }); pop(g, 1, { dist: 60 });
    },
    ledgeAttack: (g) => { cutThrough(g, 0, g.at(0, -60), 80); },
    getupAttack: (g) => { cutThrough(g, 0, g.at(0, -40), -50); cutThrough(g, 1, g.at(0, -40), 50); },
  };
  // a draw named after a move draws that move; the rest (blade) are projectile kinds
  for (const id of Object.keys(draws)) if (moves[id]) moves[id].draw = id;
  return {
    id: "sword-guy",
    name: "SWORD GUY",
    tagline: "Has a sword. That's the whole plan.",
    stats,
    moves,
    rig: { anims: spriteAnims(), loops: spriteLoops },
    palette: { colors: { marker: "#3f6fb5" }, outline: "#24221e" },
    looks,
    draws,
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
          // fire along the blade, more and faster as it fills; a ring the moment it's full
          const c = f.bars.drive / DRIVE_CHARGE_MAX;
          if (f.bars.drive % (c > 0.66 ? 1 : 2) === 0) fx(state, f, "flame", f.x + f.moveFacing * (24 + (f.bars.drive % 3) * 14), f.y - 56, 1 + Math.round(c * 2), "#ff8a2a");
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
      rise: ({ f, input, state }) => {
        if (f.frame === 5) { f.grounded = false; f.platform = -1; f.usedUpSpecial = true; }
        if (f.frame >= 5 && f.frame <= 24) {
          f.vy = -11 + (f.frame - 5) * 0.3;
          f.vx = (input.x / 100) * 2.6;
          // whoever the spin has caught is steered over him, in line for the thrust at the top
          for (const v of state.fighters) {
            if (v === f || v.lastHitBy !== f.slot || state.frame - v.lastHitFrame > 30 || v.hitstun <= 0 || v.pending) continue;
            v.vx += clamp(f.x - v.x, -20, 20) * 0.12;
            v.vy = Math.min(v.vy, f.vy - 5);
          }
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
