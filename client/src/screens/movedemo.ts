import { createMatch, step } from "../../../shared/sim";
import { B, EMPTY_INPUT, cloneInput, type InputFrame } from "../../../shared/input";
import type { FighterDef, State } from "../../../shared/types";
import { roster } from "../../../shared/fighters/index";
import { profileOf } from "../../../shared/cpu-profile";
import { stages } from "../../../shared/stages/index";
import { VIEW_H, VIEW_W } from "../render/camera";
import { PAPER, inkRect, INK } from "../render/paper";
import { Renderer } from "../render/render";
import { label } from "./ui";

type Dir = "n" | "f" | "u" | "d";
/** One button on the detail screen: what's pressed (from the air or not) and the directions the fighter has it in. */
export interface DemoMove { name: string; button: number; air: boolean; dirs: Dir[] }

const STEP = 1000 / 60;
const PRESS_AT = 12, AFTER = 50, MAX_FRAMES = 360;
/** How long a demo holds a special that charges or keeps going while held. */
const HOLD_FRAMES = 100;
/** Where the dummy stands; the fighter lines up to its left at the move's range. */
const DUMMY_X = 0;
const STICK: Record<Dir, [number, number]> = { n: [0, 0], f: [100, 0], u: [0, -100], d: [0, 100] };
const ARROW: Record<Dir, string> = { n: "●", f: "▶", u: "▲", d: "▼" };
const WORD: Record<Dir, string> = { n: "", f: "FORWARD + ", u: "UP + ", d: "DOWN + " };
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
 * What the forge's card says about a move, if any line covers it. Card heads come as "ATTACK",
 * "SIDE+SPECIAL", and run together as "DOWN/UP+SPECIAL" or "SIDE/DOWN".
 */
export function cardText(card: string[], name: string): string {
  for (const line of card) {
    const [head, ...rest] = line.trim().split(/\s+/);
    const h = head.toUpperCase();
    const names = h === "ATTACK" || h === "AIR" || h === "SPECIAL" ? [h] : h.replace(/\+SPECIAL$/, "").split("/").map((p) => `${p}+SPECIAL`);
    if (names.includes(name)) return rest.join(" ");
  }
  return "";
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
    const top = Math.min(-330, (setup.platY ?? 0) - (roster[this.dummy ?? this.fighter].stats.height + 120));
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
    const r = profileOf(def).reach[id];
    const dummyH = roster[this.dummy ?? this.fighter].stats.height;
    const midX = r.first === 999 ? 0 : Math.max(-40, Math.min(200, (r.minX + r.maxX) / 2));
    const midY = r.first === 999 ? -def.stats.height : (r.minY + r.maxY) / 2;
    const fullHop = (def.stats.fullHop * def.stats.fullHop) / (2 * def.stats.gravity);
    if (this.dir === "u") {
      // the dummy up where the hitboxes are: its middle at theirs, standing on a platform
      const rise = m.air ? fullHop : 0;
      const platY = Math.max(-520, Math.min(-60, -rise + midY + dummyH / 2));
      return { youX: DUMMY_X - midX, platY, approach: m.air ? "fullHop" : "ground", span: Math.abs(midX) };
    }
    if (m.air && this.dir === "d") return { youX: DUMMY_X - 110, platY: null, approach: "overhead", span: 110 };
    return { youX: DUMMY_X - gap, platY: null, approach: m.air ? "shortHop" : "ground", span: gap };
  }

  /** Show `move` (null: just the two of them standing there). */
  play(move: DemoMove | null): void {
    if (move === this.move || (move && this.move && move.name === this.move.name)) return;
    this.move = move;
    this.rep = 0;
    this.reset();
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
      if (this.approach === "shortHop") { if (this.frame === jumpAt) input.b = B.JUMP; if (this.frame === PRESS_AT) press(); }
      if (this.approach === "fullHop" || this.approach === "overhead") {
        // hold jump through the squat for the full hop; attack at the top
        if (this.frame >= jumpAt && this.frame < jumpAt + 8) input.b = B.JUMP;
        // over the dummy: drift forward until above it
        if (this.approach === "overhead" && this.frame >= jumpAt && you.x < DUMMY_X - 10) { input.x = 100; input.b |= B.DIGITAL; }
        if (this.frame > jumpAt + 8 && !you.grounded && you.vy >= -1) press();
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
      const button = this.move.button === B.ATTACK ? "ATTACK" : "SPECIAL";
      label(ctx, `${ARROW[this.dir]}  ${this.move.air ? "JUMP, " : ""}${WORD[this.dir]}${button}`, x + 24, y + 44, 28, INK, "left", 900);
      if (this.move.dirs.length > 1) this.move.dirs.forEach((d, i) => label(ctx, ARROW[d], x + 36 + i * 34, y + 84, 22, d === this.dir ? INK : "rgba(41,39,34,0.3)", "center", 900));
    }
  }
}
