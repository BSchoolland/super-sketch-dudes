import { createMatch, step } from "../../../shared/sim";
import { B, EMPTY_INPUT, cloneInput, type InputFrame } from "../../../shared/input";
import type { FighterDef, GameEvent, State } from "../../../shared/types";
import { roster } from "../../../shared/fighters/index";
import { currentMove, setAction } from "../../../shared/fighter";
import { hitboxWorld } from "../../../shared/hits";
import { profileOf } from "../../../shared/cpu-profile";
import { C } from "../../../shared/config";

export type Dir = "n" | "f" | "u" | "d";
type Kind = "attack" | "smash" | "air" | "special";
/** One button on the detail screen: which kind of move, and the directions the fighter has it in. */
export interface DemoMove { name: string; kind: Kind; dirs: Dir[] }
/**
 * One showing of a move: a direction, with one of the fighter's bars filled first (null: as it
 * starts), and for a special that charges, tapped instead of held.
 */
export interface Rep { dir: Dir; bar: string | null; tap: boolean }

const PRESS_AT = 42, AFTER = 110, MAX_FRAMES = 480;
/** How long a demo holds a special that charges or keeps going while held. */
const HOLD_FRAMES = 100;
/** How long a demo holds attack for a smash: past the keyboard's tilt, into a little charge. */
const SMASH_FRAMES = C.SMASH_HOLD + 16;
/** Where the fighter starts, facing right. */
const YOU_X = -200;
/** Where the dummy waits while the move is played unseen: far off, but there for anything that aims. */
const AWAY_X = 480;
/** A strike this little above the floor is met by the dummy standing; higher, it's sprung up to meet it. */
const STANDING_REACH = 40;
/** The highest the spring throws the dummy. */
const MAX_RISE = 600;
/** How far beyond the strike, away from the fighter, the spring pad sits. */
const PAD_OUT = 260;
/** The lowest top of a throw: one that comes down onto a strike near the floor still arcs. */
const MIN_ARC = 160;
/** The floor's edges (Proving Ground), less a margin for the pad. */
const FLOOR_EDGE = 520;
const STICK: Record<Dir, [number, number]> = { n: [0, 0], f: [100, 0], u: [0, -100], d: [0, 100] };
/**
 * How a rep gets the fighter going: from the ground; a short hop (nair, fair); a full hop (uair, up
 * special: a recovery shows best from the air); or a full hop drifting forward (dair).
 */
type Approach = "ground" | "shortHop" | "fullHop" | "overhead";
/**
 * The first thing the move hits with: when (frames into the showing), where (a hitbox's far end, a
 * shot's middle), whether it's a shot, and where the fighter was.
 */
interface Strike { frame: number; x: number; y: number; shot: boolean; youX: number }
/**
 * Where the dummy is to be hit. It stands at `dummyX`; for a strike up in the air, or where the
 * fighter is, a spring pad under it there throws it on `launch.frame` in an arc (`rise` at its top)
 * that carries it `dx` across in `frames`, meeting the strike where and when it comes.
 */
export interface Setup {
  youX: number;
  dummyX: number;
  launch: { frame: number; frames: number; dx: number; vy: number; rise: number } | null;
}

const MOVE_ID: Record<Kind, Partial<Record<Dir, string>>> = {
  attack: { n: "jab", f: "ftilt", u: "utilt", d: "dtilt" },
  smash: { f: "fsmash", u: "usmash", d: "dsmash" },
  air: { n: "nair", f: "fair", u: "uair", d: "dair" },
  special: { n: "nspecial", f: "sspecial", u: "uspecial", d: "dspecial" },
};
const buttonOf = (kind: Kind): number => (kind === "special" ? B.SPECIAL : B.ATTACK);
const DIRS: Dir[] = ["n", "f", "u", "d"];
const SPECIAL_NAME: Record<Dir, string> = { n: "SPECIAL", f: "SIDE+SPECIAL", u: "UP+SPECIAL", d: "DOWN+SPECIAL" };

/** Every move the fighter actually has, as detail-screen buttons: its tilts, its smashes, its aerials, each special. */
export function demoMoves(def: FighterDef): DemoMove[] {
  const has = (kind: Kind) => DIRS.filter((d) => { const id = MOVE_ID[kind][d]; return id && def.moves[id]; });
  const out: DemoMove[] = [];
  if (has("attack").length) out.push({ name: "ATTACK", kind: "attack", dirs: has("attack") });
  if (has("smash").length) out.push({ name: "SMASH", kind: "smash", dirs: has("smash") });
  if (has("air").length) out.push({ name: "AIR", kind: "air", dirs: has("air") });
  for (const d of has("special")) out.push({ name: SPECIAL_NAME[d], kind: "special", dirs: [d] });
  return out;
}

/** A special the fighter keeps doing, or charges, while the button is held. */
export function holds(fighter: string, move: DemoMove, dir: Dir): boolean {
  const id = MOVE_ID[move.kind][dir];
  return move.kind === "special" && !!profileOf(roster[fighter]).specials[id as keyof ReturnType<typeof profileOf>["specials"]]?.held;
}

/**
 * Every showing of `move` worth watching: each direction pressed plainly, and before or after it the
 * variations that make it do something else (another move, other shots, clearly more hurt): a tap of a
 * special that's normally held, and the move with each of the fighter's bars full. Works it out by
 * playing them all, unseen, yielding after every frame so it can be spread over a few.
 */
export function* showings(fighter: string, dummy: string | null, move: DemoMove): Generator<void, Rep[]> {
  const bars = roster[fighter].bars ?? {};
  const reps: Rep[] = [];
  for (const dir of move.dirs) {
    const plain: Rep = { dir, bar: null, tap: false };
    const base = yield* rehearse(fighter, dummy, move, plain);
    const tap: Rep = { ...plain, tap: true };
    if (holds(fighter, move, dir) && differs(base, yield* rehearse(fighter, dummy, move, tap))) reps.push(tap);
    reps.push(plain);
    for (const k in bars) {
      if ((bars[k].start ?? 0) >= bars[k].max) continue;
      const full: Rep = { ...plain, bar: k };
      const o = yield* rehearse(fighter, dummy, move, full);
      if (o.barShown && differs(base, o)) reps.push(full);
    }
  }
  return reps;
}

/** What a showing came to: the moves it went through, its hits on the dummy, what it fired. */
interface Outcome { moves: string; shots: string; hits: number; damage: number; kb: number; barShown: boolean }

/** Plays one showing of `move` out, unseen. */
function* rehearse(fighter: string, dummy: string | null, move: DemoMove, rep: Rep): Generator<void, Outcome> {
  const run = new DemoRun(fighter, dummy, move, rep);
  const bar = rep.bar ? roster[fighter].bars![rep.bar] : null;
  const moves: string[] = [], shots: string[] = [];
  let hits = 0, damage = 0, kb = 0, barShown = !bar?.show;
  while (!run.done) {
    for (const e of run.tick()) {
      if (e.t === "move" && e.slot === 0) moves.push(e.move);
      else if (e.t === "projectile" && e.slot === 0) shots.push(e.kind);
      else if (e.t === "hit" && e.attacker === 0 && e.victim === 1) { hits++; damage += e.damage; kb = Math.max(kb, e.kb); }
    }
    if (!barShown) barShown = bar!.show!(run.state.fighters[0]);
    yield;
  }
  return { moves: moves.join(","), shots: shots.join(","), hits, damage, kb, barShown };
}

function differs(a: Outcome, b: Outcome): boolean {
  const far = (p: number, q: number) => Math.abs(p - q) >= Math.max(2, 0.2 * Math.max(p, q));
  return a.moves !== b.moves || a.shots !== b.shots || a.hits !== b.hits || far(a.damage, b.damage) || far(a.kb, b.kb);
}

/**
 * One showing of a move as a little match: the fighter against the practice dummy (who never
 * moves on its own), the real sim, from a fresh start until the move has played out and the fighter
 * settled. The showing is played once unseen first, the dummy out of the way, to find where the move
 * strikes; the dummy is put there. With no move, the two of them just stand there.
 */
export class DemoRun {
  readonly state: State;
  readonly setup: Setup;
  private inputs: InputFrame[];
  private _frame = 0;
  private pressed = false;
  /** Frames left to keep holding the button: a special that charges or keeps firing while held, a smash. */
  private hold = 0;
  /** The dummy is in its throw, carried across until it's hit. */
  private flying = false;
  /** Unseen, the dummy out of the way: the first strike, once there's been one. */
  private strike: Strike | null = null;

  constructor(private fighter: string, private dummy: string | null, readonly move: DemoMove | null, readonly rep: Rep | null, private unseen = false) {
    const players = [{ fighter, cpu: 0 }, ...(dummy ? [{ fighter: dummy, cpu: 0 }] : [])];
    this.state = createMatch({ stage: "proving", players, rules: { stocks: 99, time: 0 }, seed: 1 });
    const [you, them] = this.state.fighters;
    you.x = YOU_X; you.facing = 1;
    if (rep?.bar) you.bars[rep.bar] = roster[fighter].bars![rep.bar].max;
    this.inputs = this.state.fighters.map(() => cloneInput(EMPTY_INPUT));
    this.setup = unseen ? { youX: YOU_X, dummyX: AWAY_X, launch: null } : this.place();
    if (them) { them.x = this.setup.dummyX; them.facing = -1; them.percent = 40; }
  }

  /** Frames into the showing. */
  get frame(): number {
    return this._frame;
  }

  get dir(): Dir {
    return this.rep?.dir ?? "n";
  }

  /** Started from a jump: aerials, and up specials (a recovery shows best from the air). */
  get jumps(): boolean {
    return !!this.move && (this.move.kind === "air" || (this.move.kind === "special" && this.dir === "u"));
  }

  private get approach(): Approach {
    if (!this.jumps) return "ground";
    if (this.dir === "d" && this.move!.kind === "air") return "overhead";
    return this.dir === "u" ? "fullHop" : "shortHop";
  }

  /** Held for the showing: a special that charges, unless this is its tap. */
  private get held(): boolean {
    return !!this.move && holds(this.fighter, this.move, this.dir) && !this.rep?.tap;
  }

  /** The move has played out and the fighter settled (or it ran too long). Never, with no move. */
  get done(): boolean {
    if (!this.move) return false;
    const you = this.state.fighters[0];
    const settled = you.grounded && (you.action === "idle" || you.action === "walk") && !this.state.projectiles.length;
    const total = (this.moveId && roster[this.fighter].moves[this.moveId]?.total) || 40;
    return (this.pressed && this._frame > PRESS_AT + total + AFTER && settled) || this._frame > MAX_FRAMES;
  }

  private get moveId(): string | null {
    return this.move ? MOVE_ID[this.move.kind][this.dir] ?? null : null;
  }

  /**
   * Where the dummy goes: where the move first strikes when played with the dummy away, or a step
   * away if it never does; a hitbox lands on its near side, a shot on its middle. Standing there if
   * that's on the floor and clear of where the fighter starts; otherwise thrown in an arc off a
   * spring further out, to meet the strike.
   */
  private place(): Setup {
    const ghost = new DemoRun(this.fighter, this.dummy, this.move, this.rep, true);
    while (!ghost.done && !ghost.strike && this.move) ghost.tick();
    const s = ghost.strike;
    const you = roster[this.fighter].stats, them = roster[this.dummy ?? this.fighter].stats;
    const clear = (you.width + them.width) / 2;
    if (!s || !this.dummy) return { youX: YOU_X, dummyX: YOU_X + clear + 60, launch: null };
    const side = Math.sign(s.x - s.youX) || 1;
    const x = s.shot ? s.x : s.x + side * them.width * 0.3;
    const rise = Math.min(MAX_RISE, Math.max(0, -(s.y + them.height / 2)));
    if (rise < STANDING_REACH && Math.abs(x - YOU_X) >= clear) return { youX: YOU_X, dummyX: x, launch: null };
    // the pad out past the strike, away from the fighter (and on the floor, and clear of the fighter)
    let padX = Math.max(-FLOOR_EDGE, Math.min(FLOOR_EDGE, x + side * PAD_OUT));
    if (Math.abs(padX - YOU_X) < clear + PAD_OUT / 2) padX = YOU_X - side * (clear + PAD_OUT);
    const arc = springArc(this.dummy, rise);
    return { youX: YOU_X, dummyX: padX, launch: { frame: Math.max(0, s.frame - arc.frames), frames: arc.frames, dx: x - padX, vy: arc.vy, rise: arc.top } };
  }

  /** Notes the move's first strike, once it's pressed (a jump that goes off isn't the aerial): an active hitbox of its, or a live shot of its, that hurts or grabs. */
  private noteStrike(): void {
    const you = this.state.fighters[0];
    let best: { damage: number; x: number; y: number; shot: boolean } | null = null;
    const mv = you.action === "attack" ? currentMove(you) : null;
    // a hitbox's far end from the fighter's middle: where something standing clear of it gets hit
    const midY = you.y - roster[this.fighter].stats.height / 2;
    const far = (x1: number, y1: number, x2: number, y2: number) => (Math.hypot(x1 - you.x, y1 - midY) >= Math.hypot(x2 - you.x, y2 - midY) ? { x: x1, y: y1 } : { x: x2, y: y2 });
    if (mv) for (const hb of mv.hitboxes) {
      if (you.frame < hb.frames[0] || you.frame > hb.frames[1] || !(hb.damage > 0 || hb.grab)) continue;
      const c = hitboxWorld(you, hb);
      if (!best || hb.damage > best.damage) best = { damage: hb.damage, ...far(c.x1, c.y1, c.x2, c.y2), shot: false };
    }
    for (const p of this.state.projectiles) {
      if (p.dead || p.owner !== 0 || p.age < p.hb.frames[0] || p.age > p.hb.frames[1] || !(p.hb.damage > 0 || p.hb.grab)) continue;
      if (!best || p.hb.damage > best.damage) best = { damage: p.hb.damage, x: p.x, y: p.y, shot: true };
    }
    if (best) this.strike = { frame: this._frame, x: best.x, y: best.y, shot: best.shot, youX: you.x };
  }

  /** One frame of the showing; the events it raised. */
  tick(): GameEvent[] {
    const [you, them] = this.state.fighters;
    const input = cloneInput(EMPTY_INPUT);
    const m = this.move;
    const press = () => {
      // pressed the way a keyboard does: a direction and a tap of attack is the tilt, holding it the smash
      [input.x, input.y] = STICK[this.dir];
      input.b = B.DIGITAL | buttonOf(m!.kind);
      this.pressed = true;
      if (this.held) this.hold = HOLD_FRAMES;
      if (m!.kind === "smash") this.hold = SMASH_FRAMES;
    };
    if (m && this.pressed && this.hold > 0) {
      this.hold--;
      [input.x, input.y] = STICK[this.dir];
      input.b = B.DIGITAL | buttonOf(m.kind);
    }
    if (m && !this.pressed) {
      const approach = this.approach;
      const jumpAt = PRESS_AT - 8;
      if (approach === "ground" && this._frame === PRESS_AT) press();
      if (approach !== "ground") {
        // a one-frame jump is a short hop; holding it through the squat, a full one
        if (this._frame === jumpAt || (approach !== "shortHop" && this._frame > jumpAt && this._frame < jumpAt + 8)) input.b = B.JUMP;
        // dair: drifting forward, to come down on whatever is ahead
        if (approach === "overhead" && this._frame >= jumpAt) { input.x = 100; input.b |= B.DIGITAL; }
        // at the top of the jump
        if (this._frame > jumpAt + 3 && !you.grounded && you.vy >= 0) press();
      }
    }
    const launch = this.setup.launch;
    if (them && launch) {
      const t = this._frame - launch.frame;
      if (t === 0) { them.grounded = false; them.platform = -1; setAction(them, "air"); them.vy = -launch.vy; this.flying = true; }
      // carried across at an even pace (the sim would drag it to a stop) until it meets the strike or is hit
      if (this.flying && t >= 0 && t <= launch.frames) { them.x = this.setup.dummyX + (launch.dx * t) / launch.frames; them.vx = 0; }
    }
    this.inputs[0] = input;
    this.state.events.length = 0;
    step(this.state, this.inputs);
    if (this.state.events.some((e) => e.t === "hit" && e.victim === 1)) this.flying = false;
    this.state.ended = false;
    this._frame++;
    if (this.unseen && this.pressed && !this.strike) this.noteStrike();
    return this.state.events;
  }
}

/** How high a throw straight up off the floor has the dummy after each frame (index 0: on the floor). */
function flight(dummy: string, vy: number): number[] {
  const s = createMatch({ stage: "proving", players: [{ fighter: dummy, cpu: 0 }], rules: { stocks: 99, time: 0 }, seed: 1 });
  const f = s.fighters[0], none = [cloneInput(EMPTY_INPUT)];
  f.grounded = false; f.platform = -1; setAction(f, "air"); f.vy = -vy;
  const out = [0];
  for (let i = 1; i < 240 && !f.grounded; i++) { step(s, none); out.push(-f.y); }
  return out;
}

const arcs = new Map<string, { vy: number; frames: number; top: number }>();

/**
 * The throw that meets a strike `rise` up: at the top of its arc, or for a strike lower than
 * MIN_ARC, on the way down from that high. Its speed up, the frames it takes, and how high it goes.
 */
function springArc(dummy: string, rise: number): { vy: number; frames: number; top: number } {
  const key = `${dummy}:${Math.round(rise)}`;
  const known = arcs.get(key);
  if (known) return known;
  const top = Math.max(rise, MIN_ARC);
  const peak = (path: number[]) => path.reduce((b, r, i) => (r > path[b] ? i : b), 0);
  let lo = 0, hi = 60;
  for (let i = 0; i < 18; i++) { const mid = (lo + hi) / 2; const p = flight(dummy, mid); if (p[peak(p)] < top) lo = mid; else hi = mid; }
  const path = flight(dummy, hi), t = peak(path);
  const down = path.findIndex((r, i) => i > t && r <= rise);
  const frames = rise >= top - 1 ? t : down < 0 ? path.length - 1 : down;
  const out = { vy: hi, frames, top: path[t] };
  arcs.set(key, out);
  return out;
}
