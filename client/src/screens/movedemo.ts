import { cloneState, createMatch, step } from "../../../shared/sim";
import { B, EMPTY_INPUT, cloneInput, type InputFrame } from "../../../shared/input";
import type { Fighter, FighterDef, State } from "../../../shared/types";
import { roster } from "../../../shared/fighters/index";
import { HELD, profileOf, type ShotPath } from "../../../shared/cpu-profile";
import { stages } from "../../../shared/stages/index";
import { VIEW_H, VIEW_W } from "../render/camera";
import { PAPER, inkRect, INK } from "../render/paper";
import { Renderer } from "../render/render";
import { label } from "./ui";
import { drawKeyIcons, type KeyIcon } from "./keyicons";
import { kb1Bindings, keyName } from "../input/bindings";

type Dir = "n" | "f" | "u" | "d";
/** One button on the detail screen: what's pressed (from the air or not) and the directions the fighter has it in. */
export interface DemoMove { name: string; button: number; air: boolean; dirs: Dir[] }

const STEP = 1000 / 60;
const PRESS_AT = 42, AFTER = 110, MAX_FRAMES = 480;
/** How long a demo holds a special that charges or keeps going while held. */
const HOLD_FRAMES = 100;
/** Where the dummy stands; the fighter lines up to its left at the move's range. */
const DUMMY_X = 0;
const STICK: Record<Dir, [number, number]> = { n: [0, 0], f: [100, 0], u: [0, -100], d: [0, 100] };
const ARROW: Record<Dir, string> = { n: "●", f: "▶", u: "▲", d: "▼" };
/**
 * How a rep gets the fighter onto the dummy: from the ground; a short hop (nair, fair); a full hop
 * with the attack at the top (uair, under a dummy up on a platform); or jumping over it (dair).
 */
type Approach = "ground" | "shortHop" | "fullHop" | "overhead";
interface Setup { youX: number; platY: number | null; approach: Approach; span: number }
const PLATFORM_HALF = 90;

/** Proving Ground plus a thin platform over the dummy's spot at `y`, registered once per height. */
function stageWithPlatform(y: number): string {
  const id = `demo@${Math.round(y)}`;
  if (!stages[id]) {
    const base = stages.proving;
    stages[id] = { ...base, id, platforms: [...base.platforms, { x1: DUMMY_X - PLATFORM_HALF, x2: DUMMY_X + PLATFORM_HALF, y: Math.round(y) }] };
  }
  return id;
}

const MOVE_ID: Record<"attack" | "air" | "special", Record<Dir, string>> = {
  attack: { n: "jab", f: "ftilt", u: "utilt", d: "dtilt" },
  air: { n: "nair", f: "fair", u: "uair", d: "dair" },
  special: { n: "nspecial", f: "sspecial", u: "uspecial", d: "dspecial" },
};
const kindOf = (m: DemoMove): keyof typeof MOVE_ID => (m.button === B.SPECIAL ? "special" : m.air ? "air" : "attack");
const DIRS: Dir[] = ["n", "f", "u", "d"];
const SPECIAL_NAME: Record<Dir, string> = { n: "SPECIAL", f: "SIDE+SPECIAL", u: "UP+SPECIAL", d: "DOWN+SPECIAL" };

/** Every move the fighter actually has, as detail-screen buttons: its tilts, its aerials, each special. */
export function demoMoves(def: FighterDef): DemoMove[] {
  const has = (kind: keyof typeof MOVE_ID) => DIRS.filter((d) => def.moves[MOVE_ID[kind][d]]);
  const out: DemoMove[] = [];
  if (has("attack").length) out.push({ name: "ATTACK", button: B.ATTACK, air: false, dirs: has("attack") });
  if (has("air").length) out.push({ name: "AIR", button: B.ATTACK, air: true, dirs: has("air") });
  for (const d of has("special")) out.push({ name: SPECIAL_NAME[d], button: B.SPECIAL, air: false, dirs: [d] });
  return out;
}

/**
 * A little match playing in a box: the fighter against the practice dummy (who never moves), the
 * real sim and renderer, no HUD. Given a move it does it over and over, each rep from a fresh
 * start, stepping through the move's directions.
 */
export class MoveDemo {
  private state!: State;
  private renderer!: Renderer;
  private move: DemoMove | null = null;
  private rep = 0;
  private frame = 0;
  private acc = 0;
  private inputs: InputFrame[] = [];
  private approach: Approach = "ground";
  private pressed = false;
  /** Frames left to keep holding the button: a special that charges or keeps firing while held. */
  private hold = 0;

  constructor(private fighter: string, private dummy: string | null) {
    this.reset();
  }

  private reset(): void {
    const setup = this.setup();
    const players = [{ fighter: this.fighter, cpu: 0 }, ...(this.dummy ? [{ fighter: this.dummy, cpu: 0 }] : [])];
    this.state = createMatch({ stage: setup.platY === null ? "proving" : stageWithPlatform(setup.platY), players, rules: { stocks: 99, time: 0 }, seed: 1 });
    const [you, dummy] = this.state.fighters;
    you.x = setup.youX; you.facing = 1;
    if (dummy) {
      dummy.x = DUMMY_X; dummy.facing = -1; dummy.percent = 40;
      if (setup.platY !== null) { dummy.y = Math.round(setup.platY); dummy.platform = 1; }
    }
    this.approach = setup.approach;
    this.pressed = false;
    this.hold = 0;
    this.inputs = this.state.fighters.map(() => cloneInput(EMPTY_INPUT));
    this.renderer = new Renderer(this.state, []);
    this.renderer.chrome = false;
    // centred on the pair (and the platform, when there is one), wide and tall enough for all of it
    let top = Math.min(-330, (setup.platY ?? 0) - (roster[this.dummy ?? this.fighter].stats.height + 120));
    // a recovery from a jump climbs a long way: keep the top of it in frame (within reason)
    if (this.jumps && this.dir === "u") {
      const def = roster[this.fighter];
      const climb = (def.stats.fullHop * def.stats.fullHop) / (2 * def.stats.gravity) + (profileOf(def).specials.uspecial?.airRise ?? 0);
      top = Math.max(-820, Math.min(top, -climb - def.stats.height - 40));
    }
    const zoom = Math.min(VIEW_W / Math.max(760, setup.span + 520), VIEW_H / (80 - top));
    this.renderer.cam.pinned = { x: (setup.youX + DUMMY_X) / 2, y: (top + 80) / 2, zoom };
    this.frame = 0;
  }

  /** Where the fighter starts, where the dummy stands, and how the fighter gets there, for this rep's move. */
  private setup(): Setup {
    const def = roster[this.fighter];
    const id = this.moveId;
    const m = this.move;
    const gap = this.spacing();
    if (!m || !id || !def.moves[id]) return { youX: DUMMY_X - gap, platY: null, approach: "ground", span: gap };
    const profile = profileOf(def);
    const r = profile.reach[id];
    const dummyH = roster[this.dummy ?? this.fighter].stats.height;
    const fullHopRise = (def.stats.fullHop * def.stats.fullHop) / (2 * def.stats.gravity);
    // a move that fires something: put the dummy where the shot goes, up on a platform if that's in the air
    const target = this.shotTarget(profile.shots[id], m);
    if (target && !(this.jumps && this.dir === "d")) {
      const rise = this.jumps ? fullHopRise : 0;
      const feet = -rise + target.y + dummyH / 2;
      const platY = feet < -50 ? Math.max(-560, feet) : null;
      return { youX: DUMMY_X - target.x, platY, approach: this.jumps ? "fullHop" : "ground", span: Math.abs(target.x) };
    }
    const midX = r.first === 999 ? 0 : Math.max(-40, Math.min(200, (r.minX + r.maxX) / 2));
    const midY = r.first === 999 ? -def.stats.height : (r.minY + r.maxY) / 2;
    if (this.dir === "u") {
      // the dummy up where the hitboxes are: its middle at theirs, standing on a platform
      const rise = this.jumps ? fullHopRise : 0;
      const platY = Math.max(-520, Math.min(-60, -rise + midY + dummyH / 2));
      return { youX: DUMMY_X - midX, platY, approach: this.jumps ? "fullHop" : "ground", span: Math.abs(midX) };
    }
    if (this.jumps && this.dir === "d") return { youX: DUMMY_X - 110, platY: null, approach: "overhead", span: 110 };
    return { youX: DUMMY_X - gap, platY: null, approach: this.jumps ? "shortHop" : "ground", span: gap };
  }

  /** Show `move` (null: just the two of them standing there). */
  play(move: DemoMove | null): void {
    if (move === this.move || (move && this.move && move.name === this.move.name)) return;
    this.move = move;
    this.rep = 0;
    this.reset();
  }

  /** Whether every direction of the current move has been shown at least once. */
  get shownAll(): boolean {
    return !!this.move && this.rep >= this.move.dirs.length;
  }

  private get moveId(): string | null {
    return this.move ? MOVE_ID[kindOf(this.move)][this.dir] : null;
  }

  /**
   * How far from the dummy to stand so the move lands: the middle of its hitboxes' reach, as the
   * CPU measures it, or for a special that shoots or travels, part of the way along.
   */
  private spacing(): number {
    const you = roster[this.fighter], dummy = this.dummy ? roster[this.dummy] : null;
    const bodies = (you.stats.width + (dummy?.stats.width ?? you.stats.width)) / 2;
    const id = this.moveId;
    if (!id || !you.moves[id]) return bodies + 60;
    const p = profileOf(you);
    const r = p.reach[id];
    const probe = p.specials[id as keyof typeof p.specials];
    let d = r && r.first !== 999 && r.maxX > 0 ? (Math.max(0, r.minX) + r.maxX) / 2 : bodies + 30;
    if (probe?.shotRange) d = Math.max(d, Math.min(probe.shotRange * 0.5, 380));
    if (probe?.groundDx) d = Math.max(d, probe.groundDx * 0.6);
    return Math.max(bodies * 0.8, Math.min(d, 480));
  }

  /**
   * Where along its shot the move is worth watching land: the path the CPU recorded for it (from
   * the air for an aerial; held for a special that's held), at its last point within reach of the
   * frame, where it bursts or fades. Relative to the fighter's start, facing +x.
   */
  private shotTarget(paths: ShotPath[] | undefined, m: DemoMove): { x: number; y: number } | null {
    if (!paths?.length) return null;
    const held = this.holdsFor(m);
    const path = paths.find((p) => p.air === this.jumps && (held ? p.hold === HELD : p.hold === 0)) ?? paths.find((p) => p.air === this.jumps) ?? paths[0];
    const near = path.pts.filter((q) => Math.hypot(q.x, q.y) <= 460);
    // a shot that runs along the floor (a skipped shell) is met by a dummy standing on it
    const floor = this.dir === "u" ? [] : near.filter((q) => q.y > -30);
    const pick = floor.length ? floor : near;
    const q = pick.length ? pick[pick.length - 1] : path.pts[0];
    return q ? { x: q.x, y: q.y } : null;
  }

  private holdsFor(m: DemoMove): boolean {
    const id = MOVE_ID[kindOf(m)][this.dir];
    return m.button === B.SPECIAL && !!profileOf(roster[this.fighter]).specials[id as keyof ReturnType<typeof profileOf>["specials"]]?.held;
  }

  /** Drifts the fighter until it's right above the dummy, allowing for where the move's hitboxes sit. */
  private driftOver(you: Fighter, input: InputFrame): void {
    const r = this.moveId ? profileOf(roster[this.fighter]).reach[this.moveId] : undefined;
    const overX = DUMMY_X - (r && r.first !== 999 ? (r.minX + r.maxX) / 2 : 0);
    if (you.x < overX - 6) { input.x = 100; input.b |= B.DIGITAL; }
    else if (you.x > overX + 6) { input.x = -100; input.b |= B.DIGITAL; }
  }

  /**
   * Presses the move in a copy of the match, this frame, with the rest of this frame's input, and
   * plays it on: does it hit the dummy?
   */
  private wouldHit(frameInput: InputFrame): boolean {
    const m = this.move;
    if (!m || this.state.fighters.length < 2) return false;
    const copy = cloneState(this.state);
    const [sx, sy] = STICK[this.dir];
    const pressed: InputFrame = { ...frameInput, x: sx, y: sy, b: frameInput.b | B.DIGITAL | m.button };
    const held = this.holdsFor(m) ? HOLD_FRAMES : 1;
    const inputs = copy.fighters.map(() => cloneInput(EMPTY_INPUT));
    for (let f = 0; f < 90; f++) {
      inputs[0] = f < held ? pressed : cloneInput(EMPTY_INPUT);
      copy.events.length = 0;
      step(copy, inputs);
      if (copy.events.some((e) => e.t === "hit" && e.attacker === 0 && e.victim === 1)) return true;
    }
    return false;
  }

  /** Started from a jump: aerials, and up specials (a recovery shows best from the air). */
  private get jumps(): boolean {
    return !!this.move && (this.move.air || (this.move.button === B.SPECIAL && this.dir === "u"));
  }

  private get dir(): Dir {
    return this.move ? this.move.dirs[this.rep % this.move.dirs.length] : "n";
  }

  private tick(): void {
    const you = this.state.fighters[0];
    const input = cloneInput(EMPTY_INPUT);
    const m = this.move;
    const press = () => {
      // digital, so a direction plus the button is a tilt, never a smash flick
      [input.x, input.y] = STICK[this.dir];
      input.b = B.DIGITAL | m!.button;
      this.pressed = true;
      const id = this.moveId;
      const probe = id ? profileOf(roster[this.fighter]).specials[id as keyof ReturnType<typeof profileOf>["specials"]] : undefined;
      if (m!.button === B.SPECIAL && probe?.held) this.hold = HOLD_FRAMES;
    };
    if (m && this.pressed && this.hold > 0) {
      this.hold--;
      [input.x, input.y] = STICK[this.dir];
      input.b = B.DIGITAL | m.button;
    }
    if (m && !this.pressed) {
      const jumpAt = PRESS_AT - 8;
      if (this.approach === "ground" && this.frame === PRESS_AT) press();
      if (this.approach !== "ground") {
        // a one-frame jump is a short hop; holding it through the squat, a full one
        if (this.frame === jumpAt || (this.approach !== "shortHop" && this.frame > jumpAt && this.frame < jumpAt + 8)) input.b = B.JUMP;
        // over the dummy: drift until right above it
        if (this.approach === "overhead" && this.frame >= jumpAt) this.driftOver(you, input);
        // attack on the first frame it would land on the dummy, or at the last moment before touching down
        // (a special, a recovery, goes at the top of the jump rather than the bottom)
        const late = m.button === B.SPECIAL ? you.vy >= 0 : you.vy > 0 && you.y + you.vy * 2 >= 0;
        if (this.frame > jumpAt + 3 && !you.grounded && (late || this.wouldHit(input))) press();
      }
    }
    this.inputs[0] = input;
    step(this.state, this.inputs);
    this.state.ended = false;
    this.renderer.snapshot(this.state);
    this.renderer.fx.consume(this.state, this.state.events, this.renderer.cam);
    this.state.events.length = 0;
    this.frame++;
    const settled = you.grounded && (you.action === "idle" || you.action === "walk") && !this.state.projectiles.length;
    const total = (this.moveId && roster[this.fighter].moves[this.moveId]?.total) || 40;
    if (this.move && ((this.pressed && this.frame > PRESS_AT + total + AFTER && settled) || this.frame > MAX_FRAMES)) {
      this.rep++;
      this.reset();
    }
  }

  update(dt: number): void {
    this.acc += dt * 1000;
    let n = 0;
    while (this.acc >= STEP && n < 4) { this.tick(); this.acc -= STEP; n++; }
    if (n === 4) this.acc = Math.min(this.acc, STEP);
  }

  /** Draws the match scaled into the box (16:9), with the direction being shown in its corner. */
  draw(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, dt: number): void {
    const h = (w * VIEW_H) / VIEW_W;
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.fillStyle = PAPER; ctx.fillRect(x, y, w, h);
    ctx.translate(x, y);
    ctx.scale(w / VIEW_W, w / VIEW_W);
    this.renderer.draw(ctx, this.state, this.acc / STEP, dt);
    ctx.restore();
    inkRect(ctx, x, y, w, h, INK, 1.6);
    if (this.move) {
      // what keyboard player 1 presses for it (facing right, so forward is D)
      const icons: KeyIcon[] = [];
      const b = kb1Bindings();
      const icon = (keys: string[]): KeyIcon => keys[0] === "Space" ? { space: true } : keys[0] === "Mouse0" ? { mouse: "left" } : keys[0] === "Mouse2" ? { mouse: "right" } : { key: keyName(keys[0] ?? "") };
      if (this.jumps) icons.push(icon(b.jump));
      if (this.dir !== "n") icons.push(icon(b[({ f: "right", u: "up", d: "down" } as const)[this.dir]]));
      icons.push(icon(this.move.button === B.ATTACK ? b.attack : b.special));
      drawKeyIcons(ctx, icons, x + 20, y + 16, 48);
      if (this.move.dirs.length > 1) this.move.dirs.forEach((d, i) => label(ctx, ARROW[d], x + 34 + i * 34, y + 96, 22, d === this.dir ? INK : "rgba(41,39,34,0.3)", "center", 900));
    }
  }
}
