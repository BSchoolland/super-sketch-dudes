import { createMatch, step } from "../../../shared/sim";
import { B, EMPTY_INPUT, cloneInput, type InputFrame } from "../../../shared/input";
import type { State } from "../../../shared/types";
import { roster } from "../../../shared/fighters/index";
import { profileOf } from "../../../shared/cpu-profile";
import { VIEW_H, VIEW_W } from "../render/camera";
import { PAPER, inkRect, INK } from "../render/paper";
import { Renderer } from "../render/render";
import { label } from "./ui";

type Dir = "n" | "f" | "u" | "d";
/** A card line's move: which button, and every direction it comes in. */
export interface DemoMove { button: number; dirs: Dir[] }

const STEP = 1000 / 60;
const PRESS_AT = 12, AFTER = 50, MAX_FRAMES = 300;
/** Where the dummy stands; the fighter lines up to its left at the move's range. */
const DUMMY_X = 0;
const STICK: Record<Dir, [number, number]> = { n: [0, 0], f: [100, 0], u: [0, -100], d: [0, 100] };
const ARROW: Record<Dir, string> = { n: "●", f: "▶", u: "▲", d: "▼" };
const WORD: Record<Dir, string> = { n: "", f: "FORWARD + ", u: "UP + ", d: "DOWN + " };
const MOVE_ID: Record<"attack" | "special", Record<Dir, string>> = {
  attack: { n: "jab", f: "ftilt", u: "utilt", d: "dtilt" },
  special: { n: "nspecial", f: "sspecial", u: "uspecial", d: "dspecial" },
};

/** The move a card line ("SIDE+SPECIAL hammer toss…") names, or null for a line that isn't one. */
export function moveOfLine(line: string): DemoMove | null {
  const head = line.trim().split(/\s+/)[0].toUpperCase();
  if (head === "ATTACK") return { button: B.ATTACK, dirs: ["n", "f", "u", "d"] };
  if (head === "SPECIAL") return { button: B.SPECIAL, dirs: ["n"] };
  if (head === "SIDE+SPECIAL") return { button: B.SPECIAL, dirs: ["f"] };
  if (head === "UP+SPECIAL") return { button: B.SPECIAL, dirs: ["u"] };
  if (head === "DOWN+SPECIAL") return { button: B.SPECIAL, dirs: ["d"] };
  return null;
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

  constructor(private fighter: string, private dummy: string | null) {
    this.reset();
  }

  private reset(): void {
    const players = [{ fighter: this.fighter, cpu: 0 }, ...(this.dummy ? [{ fighter: this.dummy, cpu: 0 }] : [])];
    this.state = createMatch({ stage: "proving", players, rules: { stocks: 99, time: 0 }, seed: 1 });
    const [you, dummy] = this.state.fighters;
    const gap = this.spacing();
    you.x = DUMMY_X - gap; you.facing = 1;
    if (dummy) { dummy.x = DUMMY_X; dummy.facing = -1; dummy.percent = 40; }
    this.inputs = this.state.fighters.map(() => cloneInput(EMPTY_INPUT));
    this.renderer = new Renderer(this.state, []);
    this.renderer.chrome = false;
    // centred on the pair, wide enough for both and some room either side, however far apart the move puts them
    this.renderer.cam.pinned = { x: DUMMY_X - gap / 2, y: -190, zoom: VIEW_W / Math.max(760, gap + 520) };
    this.frame = 0;
  }

  /** Show `move` (null: just the two of them standing there). */
  play(move: DemoMove | null): void {
    if (move === this.move || (move && this.move && move.button === this.move.button && move.dirs.join() === this.move.dirs.join())) return;
    this.move = move;
    this.rep = 0;
    this.reset();
  }

  private get moveId(): string | null {
    return this.move ? MOVE_ID[this.move.button === B.ATTACK ? "attack" : "special"][this.dir] : null;
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
    if (this.move && this.frame === PRESS_AT) {
      // digital, so a direction plus the button is a tilt, never a smash flick
      [input.x, input.y] = STICK[this.dir];
      input.b = B.DIGITAL | this.move.button;
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
    if (this.move && ((this.frame > PRESS_AT + total + AFTER && settled) || this.frame > MAX_FRAMES)) {
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
      label(ctx, `${ARROW[this.dir]}  ${WORD[this.dir]}${button}`, x + 24, y + 44, 28, INK, "left", 900);
      if (this.move.dirs.length > 1) this.move.dirs.forEach((d, i) => label(ctx, ARROW[d], x + 36 + i * 34, y + 84, 22, d === this.dir ? INK : "rgba(41,39,34,0.3)", "center", 900));
    }
  }
}
