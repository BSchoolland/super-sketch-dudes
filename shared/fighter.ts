import { C } from "./config";
import { B, STICK_DEAD, STICK_RUN, STICK_WALK, type InputFrame } from "./input";
import { approach, clamp, sign } from "./fixed";
import type { Action, Fighter, FighterDef, Move, Stage, State } from "./types";
import { roster } from "./fighters/index";
import { hitOf } from "./hits";

const formDefs = new WeakMap<FighterDef, Map<string, FighterDef>>();
/** The def as seen in the given form: the base def with the form's overlay merged in, built once per (def, form). */
export function formDef(base: FighterDef, form: string): FighterDef {
  let byForm = formDefs.get(base);
  if (!byForm) { byForm = new Map(); formDefs.set(base, byForm); }
  let def = byForm.get(form);
  if (!def) {
    const o = base.forms?.[form];
    if (!o) throw new Error(`${base.id} has no form ${form}`);
    def = {
      ...base,
      stats: { ...base.stats, ...o.stats },
      moves: { ...base.moves, ...o.moves },
      rig: { ...base.rig, anims: { ...base.rig.anims, ...o.poses }, loops: { ...base.rig.loops, ...o.loops } },
      sprite: { ...base.sprite, anims: { ...base.sprite.anims, ...o.anims } },
    };
    byForm.set(form, def);
  }
  return def;
}
export const defOf = (f: Fighter): FighterDef => {
  const base = roster[f.id];
  const form = base.form?.(f);
  return form ? formDef(base, form) : base;
};

export interface Edges {
  pressed: number;
  released: number;
  held: number;
}
export function edges(input: InputFrame, prev: InputFrame): Edges {
  return { pressed: input.b & ~prev.b, released: prev.b & ~input.b, held: input.b };
}

const ACTIONABLE_GROUND: ReadonlySet<Action> = new Set<Action>(["idle", "walk", "dash", "run", "skid", "crouch", "crouchStart", "runTurn"]);
const ACTIONABLE_AIR: ReadonlySet<Action> = new Set<Action>(["air"]);

export function isActionable(f: Fighter): boolean {
  return f.grounded ? ACTIONABLE_GROUND.has(f.action) : ACTIONABLE_AIR.has(f.action);
}

export function setAction(f: Fighter, a: Action): void {
  f.action = a;
  f.frame = 0;
  f.move = null;
}

export function currentMove(f: Fighter): Move | null {
  if (!f.move) return null;
  return defOf(f).moves[f.move] ?? null;
}

export function startMove(state: State, f: Fighter, id: string, opts: { facing?: 1 | -1; keepVel?: boolean } = {}): void {
  const def = defOf(f);
  const mv = def.moves[id];
  if (!mv) throw new Error(`${f.id} has no move ${id}`);
  if (opts.facing) f.facing = opts.facing;
  f.action = "attack";
  f.frame = 0;
  f.move = id;
  f.moveInstance++;
  f.moveFacing = f.facing;
  f.hitsThisMove = 0;
  f.buf = 0;
  if (!opts.keepVel && f.grounded) f.vx = 0;
  state.events.push({ t: "move", frame: state.frame, slot: f.slot, move: id, x: f.x, y: f.y });
}

/** Read the stick as a coarse direction in the fighter's facing frame. */
function stickDir(f: Fighter, input: InputFrame): "f" | "b" | "u" | "d" | "n" {
  const ax = Math.abs(input.x), ay = Math.abs(input.y);
  if (ax < STICK_DEAD && ay < STICK_DEAD) return "n";
  if (ay > ax) return input.y < 0 ? "u" : "d";
  return sign(input.x) === f.facing ? "f" : "b";
}
function cstickDir(f: Fighter, input: InputFrame): "f" | "b" | "u" | "d" | "n" {
  const ax = Math.abs(input.cx), ay = Math.abs(input.cy);
  if (ax < STICK_RUN && ay < STICK_RUN) return "n";
  if (ay > ax) return input.cy < 0 ? "u" : "d";
  return sign(input.cx) === f.facing ? "f" : "b";
}

function updateFlicks(f: Fighter, input: InputFrame, prev: InputFrame): void {
  if (f.flickT > 0) f.flickT--;
  const fx = Math.abs(input.x) >= STICK_RUN && Math.abs(prev.x) < STICK_WALK + 15 ? sign(input.x) : 0;
  const fy = Math.abs(input.y) >= STICK_RUN && Math.abs(prev.y) < STICK_WALK + 15 ? sign(input.y) : 0;
  if (fx || fy) {
    f.flickX = fx;
    f.flickY = fy;
    f.flickT = C.FLICK_WINDOW;
  }
  if (f.flickT === 0) { f.flickX = 0; f.flickY = 0; }
}

function buffered(f: Fighter, e: Edges, bit: number): boolean {
  return (e.pressed & bit) !== 0 || (f.buf & bit) !== 0;
}
function consume(f: Fighter, bit: number): void {
  f.buf &= ~bit;
}

function smashFromAttack(f: Fighter, input: InputFrame, e: Edges): string | null {
  const c = cstickDir(f, input);
  const cFlick = c !== "n" && (Math.abs(input.cx) >= STICK_RUN || Math.abs(input.cy) >= STICK_RUN) &&
    Math.abs(f.slot >= 0 ? 0 : 0) === 0; // c-stick counts every frame it's flicked; the client sends it as a pulse
  if (cFlick) {
    if (c === "u") return "usmash";
    if (c === "d") return "dsmash";
    f.facing = c === "b" ? (-f.facing as 1 | -1) : f.facing;
    return "fsmash";
  }
  if (!buffered(f, e, B.ATTACK)) return null;
  const mod = (e.held & B.SMASH) !== 0;
  const flick = f.flickT > 0 && !(input.b & B.DIGITAL);
  const d = stickDir(f, input);
  if (flick || mod) {
    if ((flick && f.flickY < 0) || (mod && d === "u")) return "usmash";
    if ((flick && f.flickY > 0) || (mod && d === "d")) return "dsmash";
    if ((flick && f.flickX !== 0) || mod) {
      const dir = flick && f.flickX !== 0 ? f.flickX : sign(input.x);
      if (dir !== 0) f.facing = dir as 1 | -1;
      return "fsmash";
    }
  }
  return null;
}

function groundAttackFromInput(f: Fighter, input: InputFrame, e: Edges): string | null {
  const smash = smashFromAttack(f, input, e);
  if (smash) return smash;
  if (!buffered(f, e, B.ATTACK)) return null;
  const d = stickDir(f, input);
  if (d === "u") return "utilt";
  if (d === "d") return "dtilt";
  if (d === "f" || d === "b") {
    if (d === "b") f.facing = -f.facing as 1 | -1;
    return "ftilt";
  }
  return "jab1";
}

function aerialFromInput(f: Fighter, input: InputFrame, e: Edges): string | null {
  const c = cstickDir(f, input);
  if (c !== "n") {
    if (c === "u") return "uair";
    if (c === "d") return "dair";
    return c === "f" ? "fair" : "bair";
  }
  if (!buffered(f, e, B.ATTACK)) return null;
  const d = stickDir(f, input);
  if (d === "u") return "uair";
  if (d === "d") return "dair";
  if (d === "f") return "fair";
  if (d === "b") return "bair";
  return "nair";
}

function specialFromInput(f: Fighter, input: InputFrame, e: Edges): string | null {
  if (!buffered(f, e, B.SPECIAL)) return null;
  const d = stickDir(f, input);
  if (d === "u") return "uspecial";
  if (d === "d") return "dspecial";
  if (d === "f" || d === "b") {
    if (d === "b") f.facing = -f.facing as 1 | -1;
    return "sspecial";
  }
  return "nspecial";
}

function jump(state: State, f: Fighter, def: FighterDef, full: boolean, double: boolean): void {
  const s = def.stats;
  f.vy = -(double ? s.doubleJump : full ? s.fullHop : s.shortHop);
  f.grounded = false;
  f.platform = -1;
  f.fastFalling = false;
  if (double) {
    f.jumpsLeft--;
    // a double jump lets you reverse momentum
    const ax = Math.abs(f.vx);
    f.vx = clamp(f.vx, -s.airSpeed, s.airSpeed);
    if (ax > s.airSpeed) f.vx = sign(f.vx) * s.airSpeed;
  }
  setAction(f, "air");
  state.events.push({ t: "jump", frame: state.frame, slot: f.slot, x: f.x, y: f.y, double });
}

function tryGroundActions(state: State, f: Fighter, def: FighterDef, input: InputFrame, e: Edges, allowMoves: boolean): boolean {
  if (buffered(f, e, B.JUMP)) {
    consume(f, B.JUMP);
    setAction(f, "jumpSquat");
    return true;
  }
  if (allowMoves) {
    const sp = specialFromInput(f, input, e);
    if (sp) {
      consume(f, B.SPECIAL);
      startMove(state, f, sp);
      return true;
    }
  }
  if ((e.held & B.SHIELD) && f.action !== "dash") {
    setAction(f, "shield");
    f.shieldFrames = 0;
    return true;
  }
  if (allowMoves) {
    const running = f.action === "run" || f.action === "dash";
    if (running) {
      const c = cstickDir(f, input);
      const upSmash = (e.held & B.SMASH) !== 0 ? stickDir(f, input) === "u" : f.flickT > 0 && f.flickY < 0 && !(input.b & B.DIGITAL);
      if (c === "u" || (upSmash && buffered(f, e, B.ATTACK))) {
        consume(f, B.ATTACK);
        startMove(state, f, "usmash", { keepVel: true });
        return true;
      }
      if (c === "f" || c === "b" || c === "d" || buffered(f, e, B.ATTACK)) {
        consume(f, B.ATTACK);
        startMove(state, f, "dashAttack", { keepVel: true });
        return true;
      }
    } else {
      const mv = groundAttackFromInput(f, input, e);
      if (mv) {
        consume(f, B.ATTACK);
        if (def.moves[mv]?.smash) {
          setAction(f, "smashCharge");
          f.move = mv;
          f.charge = 0;
          return true;
        }
        startMove(state, f, mv);
        return true;
      }
    }
    if (buffered(f, e, B.TAUNT) && f.tauntCooldown === 0) {
      consume(f, B.TAUNT);
      setAction(f, "taunt");
      return true;
    }
  }
  return false;
}

function tryAirActions(state: State, f: Fighter, def: FighterDef, input: InputFrame, e: Edges): boolean {
  if (buffered(f, e, B.JUMP) && f.jumpsLeft > 0) {
    consume(f, B.JUMP);
    jump(state, f, def, true, true);
    return true;
  }
  if (buffered(f, e, B.SHIELD) && !f.airDodged) {
    consume(f, B.SHIELD);
    f.airDodged = true;
    setAction(f, "airDodge");
    const len = Math.sqrt(input.x * input.x + input.y * input.y);
    if (len >= STICK_DEAD) {
      f.vx = (input.x / len) * C.AIR_DODGE.speed;
      f.vy = (input.y / len) * C.AIR_DODGE.speed;
    } else {
      f.vx *= 0.5;
      f.vy = 0;
    }
    return true;
  }
  const sp = specialFromInput(f, input, e);
  if (sp) {
    if (sp === "uspecial" && f.usedUpSpecial) return false;
    consume(f, B.SPECIAL);
    startMove(state, f, sp);
    return true;
  }
  const ae = aerialFromInput(f, input, e);
  if (ae) {
    consume(f, B.ATTACK);
    startMove(state, f, ae, { keepVel: true });
    return true;
  }
  return false;
}

export function airControl(f: Fighter, def: FighterDef, input: InputFrame, mul = 1): void {
  const s = def.stats;
  const target = (input.x / 100) * s.airSpeed * mul;
  if (Math.abs(input.x) >= STICK_DEAD) {
    if (sign(target) !== sign(f.vx) || Math.abs(f.vx) < Math.abs(target)) f.vx = approach(f.vx, target, s.airAccel * (Math.abs(input.x) / 100) * 2);
    else f.vx = approach(f.vx, target, s.airAccel * 0.5);
  } else {
    f.vx = approach(f.vx, 0, s.airAccel * 0.6);
  }
}

export function applyGravity(f: Fighter, def: FighterDef, input: InputFrame, allowFastFall = true): void {
  const s = def.stats;
  if (allowFastFall && !f.fastFalling && f.vy >= -0.5 && (input.y >= STICK_RUN && (f.flickY > 0 || input.y >= 90))) f.fastFalling = true;
  const cap = f.fastFalling ? s.fastFall : s.fallSpeed;
  f.vy += s.gravity;
  if (f.fastFalling && f.vy < cap) f.vy = Math.max(f.vy, Math.min(cap, f.vy + s.gravity * 3));
  if (f.vy > cap) f.vy = cap;
}

function groundFriction(f: Fighter, def: FighterDef, mul = 1): void {
  f.vx = approach(f.vx, 0, def.stats.traction * mul);
}

export function land(state: State, f: Fighter, platform: number): void {
  const def = defOf(f);
  f.grounded = true;
  f.platform = platform;
  f.vy = 0;
  f.jumpsLeft = def.stats.jumps - 1;
  f.airDodged = false;
  f.usedUpSpecial = false;
  f.wallJumped = false;
  f.fastFalling = false;
  const hard = f.action === "tumble" || f.action === "helpless";
  state.events.push({ t: "land", frame: state.frame, slot: f.slot, x: f.x, y: f.y, hard });
  switch (f.action) {
    case "attack": {
      const mv = currentMove(f);
      if (mv?.aerial) {
        setAction(f, "land");
        f.frame = -(mv.landingLag ?? C.LAND_LAG) + C.LAND_LAG; // land action counts up to LAND_LAG
        return;
      }
      // grounded moves that went airborne just keep going
      return;
    }
    case "airDodge":
      setAction(f, "land");
      f.frame = -C.AIR_DODGE.land + C.LAND_LAG;
      return;
    case "helpless":
      setAction(f, "land");
      f.frame = -C.HELPLESS_LAND_LAG + C.LAND_LAG;
      return;
    case "tumble":
      if (f.techWindow > 0) {
        setAction(f, "tech");
        f.invuln = Math.max(f.invuln, C.TECH_FRAMES);
        state.events.push({ t: "tech", frame: state.frame, slot: f.slot, x: f.x, y: f.y });
      } else {
        setAction(f, "knockdown");
        f.vx *= 0.5;
      }
      return;
    case "hitstun":
      // low knockback landings just stop
      setAction(f, "idle");
      f.vx *= 0.6;
      return;
    case "thrown":
    case "grabbed":
      setAction(f, "idle");
      return;
    default:
      setAction(f, "land");
      return;
  }
}

/** Called by physics when an airborne fighter runs into a wall. */
export function hitWall(state: State, f: Fighter, def: FighterDef, wallSide: 1 | -1, input: InputFrame): void {
  if (f.action === "tumble" && f.techWindow > 0) {
    setAction(f, "tech");
    f.vx = -wallSide * 4;
    f.vy = -6;
    f.invuln = Math.max(f.invuln, C.TECH_FRAMES);
    f.action = "wallTech";
    state.events.push({ t: "tech", frame: state.frame, slot: f.slot, x: f.x, y: f.y });
    return;
  }
  if (def.stats.wallJump && !f.wallJumped && (f.action === "air" || f.action === "helpless") && sign(input.x) === -wallSide && Math.abs(input.x) >= STICK_RUN) {
    f.wallJumped = true;
    f.vx = -wallSide * C.WALL_JUMP_VX;
    f.vy = -C.WALL_JUMP_VY;
    f.facing = -wallSide as 1 | -1;
    setAction(f, "air");
    state.events.push({ t: "jump", frame: state.frame, slot: f.slot, x: f.x, y: f.y, double: true });
    return;
  }
  f.vx = 0;
}

export function grabLedge(state: State, f: Fighter, ledgeIndex: number, stage: Stage): void {
  const L = stage.ledges[ledgeIndex];
  const def = defOf(f);
  f.ledge = ledgeIndex;
  f.x = L.x + L.side * (def.stats.width * 0.5 + 4);
  f.y = L.y + def.stats.height * 0.75;
  f.vx = 0;
  f.vy = 0;
  f.facing = (-L.side) as 1 | -1;
  f.invuln = Math.max(f.invuln, C.LEDGE_INVULN);
  f.jumpsLeft = def.stats.jumps - 1;
  f.airDodged = false;
  f.usedUpSpecial = false;
  f.wallJumped = false;
  f.fastFalling = false;
  f.ledgeTime = 0;
  setAction(f, "ledgeGrab");
  state.events.push({ t: "ledge", frame: state.frame, slot: f.slot, x: f.x, y: f.y });
}

function releaseLedge(f: Fighter): void {
  f.ledge = -1;
  f.ledgeCooldown = C.LEDGE_COOLDOWN;
}

export function stepFighter(state: State, f: Fighter, input: InputFrame, prev: InputFrame, stage: Stage): void {
  const def = defOf(f);
  const s = def.stats;
  const e = edges(input, prev);

  // buffers and timers run even in hitlag so a press during freeze comes out on the first free frame
  if (e.pressed) { f.buf |= e.pressed & (B.JUMP | B.ATTACK | B.SPECIAL | B.SHIELD | B.TAUNT); f.bufAge = 0; }
  else if (f.buf) { f.bufAge++; if (f.bufAge > C.BUFFER) f.buf = 0; }
  updateFlicks(f, input, prev);
  if (f.invuln > 0) f.invuln--;
  if (f.ledgeCooldown > 0) f.ledgeCooldown--;
  if (f.tauntCooldown > 0) f.tauntCooldown--;
  if (f.dropTimer > 0) f.dropTimer--;
  if (f.techWindow > 0) f.techWindow--;
  if ((e.pressed & B.SHIELD) && !f.grounded) f.techWindow = C.TECH_WINDOW;
  if (e.pressed & B.SHIELD && (f.action === "tumble" || f.action === "hitstun")) f.techWindow = C.TECH_WINDOW;
  if (e.pressed || (sign(input.x) !== sign(prev.x)) || (sign(input.y) !== sign(prev.y))) f.mash++;

  if (f.action === "dead") {
    f.frame++;
    return;
  }

  if (f.hitlag > 0) {
    f.hitlag--;
    if (f.hitlag === 0 && f.pending) applyPending(f, input);
    return;
  }

  f.frame++;
  def.onFrame?.({ state, f, input, prev });

  switch (f.action) {
    case "respawn": {
      f.invuln = Math.max(f.invuln, 2);
      const any = (e.pressed & (B.JUMP | B.ATTACK | B.SPECIAL | B.SHIELD)) || Math.abs(input.x) >= STICK_RUN || input.y >= STICK_RUN;
      if (f.frame >= C.RESPAWN_PLATFORM || (f.frame > 10 && any)) {
        setAction(f, "air");
        f.grounded = false;
        f.jumpsLeft = s.jumps - 1;
      }
      return;
    }
    case "idle":
    case "walk": {
      if (tryGroundActions(state, f, def, input, e, true)) break;
      if (Math.abs(input.x) >= STICK_RUN && (f.flickT > 0 || f.action === "idle")) {
        f.facing = sign(input.x) as 1 | -1;
        setAction(f, "dash");
        f.vx = s.dashInit * f.facing;
        state.events.push({ t: "dash", frame: state.frame, slot: f.slot, x: f.x, y: f.y, facing: f.facing });
        break;
      }
      if (input.y >= STICK_RUN && Math.abs(input.x) < STICK_RUN) { setAction(f, "crouch"); f.vx *= 0.5; break; }
      if (Math.abs(input.x) >= STICK_WALK) {
        f.facing = sign(input.x) as 1 | -1;
        if (f.action !== "walk") setAction(f, "walk");
        f.vx = approach(f.vx, (input.x / 100) * s.walk, s.traction * 2);
      } else {
        if (f.action !== "idle") setAction(f, "idle");
        groundFriction(f, def);
      }
      break;
    }
    case "dash": {
      if (Math.abs(input.x) >= STICK_RUN && sign(input.x) !== f.facing) {
        // dash-dance
        f.facing = sign(input.x) as 1 | -1;
        f.frame = 0;
        f.vx = s.dashInit * f.facing;
        state.events.push({ t: "dash", frame: state.frame, slot: f.slot, x: f.x, y: f.y, facing: f.facing });
        break;
      }
      if (tryGroundActions(state, f, def, input, e, true)) break;
      if (f.frame >= C.DASH_FRAMES) {
        if (Math.abs(input.x) >= STICK_RUN) setAction(f, "run");
        else setAction(f, "skid");
        break;
      }
      f.vx = s.dashInit * f.facing;
      break;
    }
    case "run": {
      if (tryGroundActions(state, f, def, input, e, true)) break;
      if (Math.abs(input.x) >= STICK_RUN && sign(input.x) !== f.facing) { setAction(f, "runTurn"); break; }
      if (Math.abs(input.x) < STICK_WALK) { setAction(f, "skid"); break; }
      if (input.y >= STICK_RUN + 10 && Math.abs(input.x) < STICK_RUN) { setAction(f, "skid"); break; }
      f.vx = approach(f.vx, s.run * f.facing, s.traction * 1.5);
      break;
    }
    case "runTurn": {
      if (tryGroundActions(state, f, def, input, e, false)) break;
      groundFriction(f, def, 2);
      if (f.frame >= C.RUN_TURN_FRAMES) {
        f.facing = -f.facing as 1 | -1;
        if (Math.abs(input.x) >= STICK_RUN && sign(input.x) === f.facing) { setAction(f, "run"); f.vx = s.run * f.facing * 0.6; }
        else setAction(f, "idle");
      }
      break;
    }
    case "skid": {
      if (tryGroundActions(state, f, def, input, e, true)) break;
      groundFriction(f, def, 1.5);
      if (f.frame >= C.SKID_FRAMES) setAction(f, "idle");
      break;
    }
    case "crouch": {
      if (tryGroundActions(state, f, def, input, e, true)) break;
      groundFriction(f, def, 2);
      if (input.y < STICK_RUN) { setAction(f, "idle"); break; }
      // drop through a soft platform
      if (f.platform >= 0 && !stage.platforms[f.platform].solid && (f.flickY > 0 && f.flickT > 0 && f.frame > 1)) {
        f.grounded = false;
        f.platform = -1;
        f.dropTimer = 10;
        setAction(f, "air");
      }
      break;
    }
    case "jumpSquat": {
      groundFriction(f, def, 0.5);
      if (f.frame >= C.JUMP_SQUAT) {
        const full = (e.held & B.JUMP) !== 0;
        jump(state, f, def, full, false);
        // carry ground speed, plus a little stick control
        if (Math.abs(input.x) >= STICK_DEAD) f.vx = clamp(f.vx + (input.x / 100) * 1.5, -Math.max(Math.abs(f.vx), s.airSpeed), Math.max(Math.abs(f.vx), s.airSpeed));
      }
      break;
    }
    case "air": {
      if (tryAirActions(state, f, def, input, e)) break;
      airControl(f, def, input);
      applyGravity(f, def, input);
      if (Math.abs(input.x) >= STICK_DEAD && f.frame > 2) f.facing = f.facing; // facing locks in the air
      break;
    }
    case "helpless": {
      airControl(f, def, input, 0.6);
      applyGravity(f, def, input);
      break;
    }
    case "land": {
      groundFriction(f, def, 1.5);
      if (f.frame >= C.LAND_LAG) setAction(f, "idle");
      break;
    }
    case "smashCharge": {
      groundFriction(f, def, 2);
      f.charge++;
      const c = cstickDir(f, input);
      const release = !(e.held & B.ATTACK) || f.charge >= C.SMASH_CHARGE_MAX;
      const cHeld = c !== "n";
      if ((release && !cHeld) || f.charge >= C.SMASH_CHARGE_MAX) {
        f.chargeMul = 1 + C.SMASH_CHARGE_MUL * (f.charge / C.SMASH_CHARGE_MAX);
        startMove(state, f, f.move!);
      }
      break;
    }
    case "attack": {
      stepMove(state, f, def, input, prev, e, stage);
      break;
    }
    case "shield": {
      f.shieldFrames++;
      f.shieldHeld = true;
      groundFriction(f, def, 2);
      f.shield = Math.max(0, f.shield - C.SHIELD_DRAIN);
      if (f.shield <= 0) { shieldBreak(state, f); break; }
      if (buffered(f, e, B.JUMP)) { consume(f, B.JUMP); f.shieldHeld = false; setAction(f, "jumpSquat"); break; }
      if (f.flickT > 0 && f.flickX !== 0) {
        f.shieldHeld = false;
        f.facing = f.flickX as 1 | -1;
        setAction(f, "roll");
        f.invuln = 0;
        break;
      }
      if (f.flickT > 0 && f.flickY > 0) { f.shieldHeld = false; setAction(f, "spotDodge"); break; }
      if (!(e.held & B.SHIELD)) { f.shieldHeld = false; setAction(f, "shieldDrop"); break; }
      break;
    }
    case "shieldDrop": {
      groundFriction(f, def, 2);
      if (f.frame >= C.SHIELD_DROP) setAction(f, "idle");
      else if (buffered(f, e, B.JUMP)) { consume(f, B.JUMP); setAction(f, "jumpSquat"); }
      break;
    }
    case "shieldStun": {
      groundFriction(f, def, 1);
      if (f.frame >= f.hitstun) {
        f.hitstun = 0;
        if (e.held & B.SHIELD) { setAction(f, "shield"); f.shieldFrames = 10; }
        else setAction(f, "shieldDrop");
      }
      break;
    }
    case "parry": {
      groundFriction(f, def, 2);
      if (f.frame >= C.PARRY_FRAMES) setAction(f, "idle");
      break;
    }
    case "shieldBreak": {
      if (!f.grounded) { applyGravity(f, def, input, false); f.vx = approach(f.vx, 0, 0.1); }
      else groundFriction(f, def, 1);
      if (f.mash > 0 && f.frame > 30) { f.frame += f.mash * 2; f.mash = 0; }
      if (f.frame >= C.SHIELD_BREAK_STUN) { setAction(f, "idle"); f.shield = C.SHIELD_MAX * 0.6; }
      break;
    }
    case "spotDodge": {
      groundFriction(f, def, 3);
      const d = C.SPOT_DODGE;
      if (f.frame === d.start) f.invuln = Math.max(f.invuln, d.invuln - d.start);
      if (f.frame >= d.total) setAction(f, "idle");
      break;
    }
    case "roll": {
      const d = C.ROLL;
      if (f.frame === d.start) f.invuln = Math.max(f.invuln, d.invuln - d.start);
      if (f.frame >= d.start && f.frame < d.invuln) f.vx = (d.dist / (d.invuln - d.start)) * f.facing;
      else groundFriction(f, def, 2);
      if (f.frame >= d.total) setAction(f, "idle");
      break;
    }
    case "airDodge": {
      const d = C.AIR_DODGE;
      if (f.frame === d.start) f.invuln = Math.max(f.invuln, d.invuln - d.start);
      if (f.frame < d.invuln) {
        f.vx *= 0.94;
        f.vy *= 0.94;
      } else {
        airControl(f, def, input, 0.5);
        applyGravity(f, def, input, false);
      }
      if (f.frame >= d.total) setAction(f, "air");
      break;
    }
    case "hitstun": {
      if (f.grounded) groundFriction(f, def, 0.6);
      else { applyGravity(f, def, input, false); f.vx = approach(f.vx, 0, C.LAUNCH_DECAY); airControl(f, def, input, 0.25); }
      if (f.frame >= f.hitstun) { f.hitstun = 0; setAction(f, f.grounded ? "idle" : "air"); }
      break;
    }
    case "tumble": {
      applyGravity(f, def, input, false);
      f.vx = approach(f.vx, 0, C.LAUNCH_DECAY);
      if (f.frame >= f.hitstun) {
        // out of hitstun: can act, still tumbling until then
        if (tryAirActions(state, f, def, input, e)) break;
        airControl(f, def, input, 0.7);
        if (f.frame >= f.hitstun + 60 || (Math.abs(input.x) >= STICK_RUN && f.flickT > 0)) setAction(f, "air");
      } else airControl(f, def, input, 0.2);
      break;
    }
    case "knockdown": {
      groundFriction(f, def, 1.5);
      if (f.frame < 8) break;
      if (buffered(f, e, B.ATTACK)) { consume(f, B.ATTACK); f.invuln = Math.max(f.invuln, 10); startMove(state, f, "getupAttack"); break; }
      if (Math.abs(input.x) >= STICK_RUN || buffered(f, e, B.SHIELD)) {
        consume(f, B.SHIELD);
        f.facing = (Math.abs(input.x) >= STICK_RUN ? sign(input.x) : f.facing) as 1 | -1;
        setAction(f, "getupRoll");
        f.invuln = Math.max(f.invuln, 20);
        break;
      }
      if (buffered(f, e, B.JUMP) || input.y <= -STICK_RUN || f.frame >= C.KNOCKDOWN_MAX) {
        consume(f, B.JUMP);
        setAction(f, "getup");
        f.invuln = Math.max(f.invuln, 16);
      }
      break;
    }
    case "getup": {
      groundFriction(f, def, 2);
      if (f.frame >= C.GETUP) setAction(f, "idle");
      break;
    }
    case "getupRoll":
    case "techRoll": {
      const total = f.action === "getupRoll" ? C.GETUP_ROLL : C.TECH_ROLL;
      if (f.frame < total * 0.7) f.vx = (110 / (total * 0.7)) * f.facing;
      else groundFriction(f, def, 2);
      if (f.frame >= total) setAction(f, "idle");
      break;
    }
    case "tech": {
      groundFriction(f, def, 3);
      if (f.frame === 1 && Math.abs(input.x) >= STICK_RUN) { f.facing = sign(input.x) as 1 | -1; setAction(f, "techRoll"); f.invuln = Math.max(f.invuln, 20); break; }
      if (f.frame >= C.TECH_FRAMES) setAction(f, "idle");
      break;
    }
    case "wallTech": {
      applyGravity(f, def, input, false);
      if (f.frame >= 10) setAction(f, "air");
      break;
    }
    case "ledgeGrab": {
      f.vx = 0; f.vy = 0;
      if (f.frame >= 6) setAction(f, "ledgeHang");
      break;
    }
    case "ledgeHang": {
      f.vx = 0; f.vy = 0;
      f.ledgeTime++;
      const L = stage.ledges[f.ledge];
      const toward = sign(input.x) === -L.side && Math.abs(input.x) >= STICK_WALK;
      const away = sign(input.x) === L.side && Math.abs(input.x) >= STICK_RUN;
      if (buffered(f, e, B.JUMP) || input.y <= -STICK_RUN) { consume(f, B.JUMP); setAction(f, "ledgeJump"); break; }
      if (buffered(f, e, B.ATTACK)) { consume(f, B.ATTACK); f.invuln = Math.max(f.invuln, 18); const mv = "ledgeAttack"; releaseLedge(f); climbTo(f, stage, L); startMove(state, f, mv); break; }
      if (buffered(f, e, B.SHIELD)) { consume(f, B.SHIELD); setAction(f, "ledgeRoll"); f.invuln = Math.max(f.invuln, C.LEDGE_ROLL - 4); break; }
      if (toward) { setAction(f, "ledgeClimb"); f.invuln = Math.max(f.invuln, C.LEDGE_CLIMB - 2); break; }
      if (away || input.y >= STICK_RUN || f.ledgeTime >= C.LEDGE_HANG_MAX) {
        releaseLedge(f);
        setAction(f, "air");
        f.vy = 1;
        f.invuln = 0;
        break;
      }
      break;
    }
    case "ledgeClimb": {
      f.vx = 0; f.vy = 0;
      if (f.frame >= C.LEDGE_CLIMB) { const L = stage.ledges[f.ledge]; releaseLedge(f); climbTo(f, stage, L); setAction(f, "idle"); }
      break;
    }
    case "ledgeRoll": {
      f.vx = 0; f.vy = 0;
      if (f.frame >= C.LEDGE_ROLL) { const L = stage.ledges[f.ledge]; releaseLedge(f); climbTo(f, stage, L, 120); setAction(f, "idle"); }
      break;
    }
    case "ledgeJump": {
      f.vx = 0; f.vy = 0;
      if (f.frame >= C.LEDGE_JUMP) {
        const L = stage.ledges[f.ledge];
        releaseLedge(f);
        f.grounded = false;
        f.vy = -s.fullHop * 1.05;
        f.vx = -L.side * 3;
        f.x = L.x - L.side * 6;
        f.y = L.y - 4;
        f.invuln = Math.max(f.invuln, 8);
        setAction(f, "air");
        state.events.push({ t: "jump", frame: state.frame, slot: f.slot, x: f.x, y: f.y, double: false });
      }
      break;
    }
    case "grabHold": {
      const v = state.fighters[f.grabbing];
      if (!v || v.grabbedBy !== f.slot) { setAction(f, "idle"); f.grabbing = -1; break; }
      groundFriction(f, def, 3);
      f.grabTimer--;
      v.x = f.x + f.facing * (s.width * 0.5 + defOf(v).stats.width * 0.5 + 6);
      v.y = f.y;
      v.facing = (-f.facing) as 1 | -1;
      if (v.mash > 0) { f.grabTimer -= v.mash * C.MASH_VALUE; v.mash = 0; }
      if (f.grabTimer <= 0) { releaseGrab(state, f, v, true); break; }
      if (buffered(f, e, B.ATTACK) && f.frame > 4 && !(f.flickT > 0)) { consume(f, B.ATTACK); startMove(state, f, "pummel"); break; }
      const d = stickDir(f, input);
      const flick = f.flickT > 0 && (f.flickX !== 0 || f.flickY !== 0);
      if ((flick || (e.pressed & B.SPECIAL)) && f.frame > 3) {
        const t = d === "u" ? "uthrow" : d === "d" ? "dthrow" : d === "b" ? "bthrow" : "fthrow";
        startMove(state, f, t);
        v.action = "thrown";
        v.frame = 0;
        state.events.push({ t: "throw", frame: state.frame, attacker: f.slot, victim: v.slot, x: v.x, y: v.y });
      }
      break;
    }
    case "grabbed":
    case "thrown": {
      const g = state.fighters[f.grabbedBy];
      if (!g || g.grabbing !== f.slot) { f.grabbedBy = -1; setAction(f, f.grounded ? "idle" : "air"); }
      f.vx = 0; f.vy = 0;
      break;
    }
    case "taunt": {
      groundFriction(f, def, 2);
      if (f.frame >= C.TAUNT) { setAction(f, "idle"); f.tauntCooldown = 30; }
      break;
    }
    default:
      break;
  }

  // shield regen whenever it's down
  if (f.action !== "shield" && f.action !== "shieldStun" && f.action !== "shieldBreak") f.shield = Math.min(C.SHIELD_MAX, f.shield + C.SHIELD_REGEN);
  if (f.action !== "shield") f.shieldHeld = false;
  if (f.action !== "grabHold" && f.action !== "attack") f.grabbing = f.grabbing >= 0 && state.fighters[f.grabbing]?.grabbedBy === f.slot ? f.grabbing : -1;
  f.mash = 0;
}

function climbTo(f: Fighter, stage: Stage, L: { x: number; y: number; side: 1 | -1 }, dist = 30): void {
  f.x = L.x - L.side * dist;
  f.y = L.y;
  f.grounded = true;
  f.platform = stage.ledges.find((l) => l.x === L.x)?.platform ?? 0;
  f.vx = 0; f.vy = 0;
}

/**
 * Generated fighters bring their own hook code. A hook that throws cuts the move short (the fighter
 * drops to idle) with an event so the screen can say so. Nothing outside the state is changed, so
 * a rolled-back throw leaves no trace and every client agrees.
 */
function runHook(state: State, f: Fighter, def: FighterDef, mv: Move, input: InputFrame, prev: InputFrame): void {
  const hook = def.hooks[mv.hook!];
  if (!hook) throw new Error(`${def.id}.${mv.id} names missing hook ${mv.hook}`);
  try {
    hook({ state, f, input, prev });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    state.events.push({ t: "hookError", frame: state.frame, slot: f.slot, move: mv.id, error });
    if (f.grabbing >= 0) { const v = state.fighters[f.grabbing]; if (v) releaseGrab(state, f, v, false); }
    setAction(f, f.grounded ? "idle" : "air");
  }
}

export function releaseGrab(state: State, g: Fighter, v: Fighter, escaped: boolean): void {
  g.grabbing = -1;
  v.grabbedBy = -1;
  setAction(g, "idle");
  if (escaped) {
    v.x += (-g.facing) * 30;
    v.vx = -g.facing * 4;
    v.invuln = Math.max(v.invuln, 10);
  }
  setAction(v, v.grounded ? "idle" : "air");
  void state;
}

export function shieldBreak(state: State, f: Fighter): void {
  f.shieldHeld = false;
  f.shield = 0;
  setAction(f, "shieldBreak");
  f.vy = -10;
  f.grounded = false;
  state.events.push({ t: "shieldBreak", frame: state.frame, slot: f.slot, x: f.x, y: f.y });
}

function applyPending(f: Fighter, input: InputFrame): void {
  const p = f.pending!;
  f.pending = null;
  // DI: rotate the launch vector toward the stick, up to DI_MAX degrees
  let vx = p.vx, vy = p.vy;
  const len = Math.sqrt(vx * vx + vy * vy);
  if (len > 0.01 && (Math.abs(input.x) >= STICK_DEAD || Math.abs(input.y) >= STICK_DEAD)) {
    const sx = input.x / 100, sy = input.y / 100;
    // perpendicular component of the stick relative to launch direction decides rotation
    const nx = vx / len, ny = vy / len;
    const perp = sx * -ny + sy * nx; // cross product sign
    const t = clamp(perp, -1, 1) * (C.DI_MAX / 180) * 3.14159265;
    // small-angle rotation using series-free approximation: rotate by t via cos/sin approximations with + - * only
    const c = 1 - (t * t) / 2 + (t * t * t * t) / 24;
    const s = t - (t * t * t) / 6 + (t * t * t * t * t) / 120;
    vx = (nx * c - ny * s) * len;
    vy = (nx * s + ny * c) * len;
  }
  f.vx = vx;
  f.vy = vy;
  f.hitstun = p.hitstun;
  if (vy < -0.8 || !f.grounded || p.kb >= C.TUMBLE_KB) {
    f.grounded = false;
    f.platform = -1;
  } else {
    f.vy = 0;
  }
  f.frame = 0;
  f.action = p.kb >= C.TUMBLE_KB ? "tumble" : "hitstun";
  f.move = null;
  f.fastFalling = false;
}

function stepMove(state: State, f: Fighter, def: FighterDef, input: InputFrame, prev: InputFrame, e: Edges, stage: Stage): void {
  const mv = currentMove(f)!;
  const s = def.stats;
  if (mv.hook) runHook(state, f, def, mv, input, prev);
  if (f.action !== "attack") return; // the hook changed state
  if (mv.motion) for (const [fr, mx, my] of mv.motion) if (fr === f.frame) { f.vx = mx * f.moveFacing; f.vy = my; if (my < 0) { f.grounded = false; f.platform = -1; } }
  const hovering = mv.hover && f.frame >= mv.hover[0] && f.frame <= mv.hover[1];
  if (mv.invuln && f.frame === mv.invuln[0]) f.invuln = Math.max(f.invuln, mv.invuln[1] - mv.invuln[0] + 1);
  if (f.grounded) {
    groundFriction(f, def, mv.aerial ? 1 : 1.2);
  } else if (hovering) {
    f.vy = 0;
    f.vx = approach(f.vx, 0, 0.3);
  } else {
    if (mv.aerial || f.move === "uspecial" || f.move === "sspecial" || f.move === "nspecial" || f.move === "dspecial") airControl(f, def, input, 0.8);
    else f.vx = approach(f.vx, 0, s.airAccel * 0.3);
    applyGravity(f, def, input, mv.aerial === true);
  }
  // throws
  if (mv.throwFrame && f.frame === mv.throwFrame && f.grabbing >= 0) {
    const v = state.fighters[f.grabbing];
    if (v && v.grabbedBy === f.slot) {
      const hb = mv.hitboxes[0];
      throwVictim(state, f, v, hb.damage, hb.angle, hb.base, hb.growth);
      f.grabbing = -1;
    }
  }
  if (f.move === "pummel" && f.frame >= mv.total) { setAction(f, "grabHold"); f.frame = 5; return; }
  if (mv.next && f.frame >= (mv.nextFrom ?? 1) && buffered(f, e, B.ATTACK) && (f.hitsThisMove > 0 || f.frame >= (mv.iasa ?? mv.total))) {
    consume(f, B.ATTACK);
    startMove(state, f, mv.next);
    return;
  }
  // IASA / end
  const iasa = mv.iasa ?? mv.total + 1;
  if (f.frame >= iasa && f.frame < mv.total) {
    if (f.grounded ? tryGroundActions(state, f, def, input, e, true) : tryAirActions(state, f, def, input, e)) return;
    if (f.grounded && Math.abs(input.x) >= STICK_RUN) { f.facing = sign(input.x) as 1 | -1; setAction(f, "dash"); f.vx = s.dashInit * f.facing; return; }
  }
  if (f.frame >= mv.total) {
    if (mv.helpless && !f.grounded) setAction(f, "helpless");
    else setAction(f, f.grounded ? "idle" : "air");
    if (f.grounded && mv.id === "grab" && f.grabbing >= 0) setAction(f, "grabHold");
  }
  void stage;
}

export function throwVictim(state: State, g: Fighter, v: Fighter, damage: number, angle: number, base: number, growth: number): void {
  v.grabbedBy = -1;
  hitOf(state, g, v, { frames: [0, 0], x: 0, y: 0, r: 0, damage, angle, base, growth, fx: "heavy" }, v.x, v.y - 40, true);
}
