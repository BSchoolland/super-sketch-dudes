import { roster } from "../../../shared/fighters/index";
import { profileOf } from "../../../shared/cpu-profile";
import { VIEW_H, VIEW_W } from "../render/camera";
import { PAPER, inkRect, INK } from "../render/paper";
import { Renderer } from "../render/render";
import { grow, keysInHand, label } from "./ui";
import { drawKeyIcons, type KeyIcon } from "./keyicons";
import { bindingsOf, keyName } from "../input/bindings";
import { DemoRun, demoMoves, holds, showings, type DemoMove, type Dir, type Rep } from "./demorun";

const STEP = 1000 / 60;
/** Milliseconds a frame may spend working out showings. */
const WORK_MS = 4;
const ARROW: Record<Dir, string> = { n: "●", f: "▶", u: "▲", d: "▼" };

/**
 * A little match playing in a box, the real sim and renderer with no HUD. Given a move it shows it
 * over and over, each showing from a fresh start: every direction, and once they're worked out (a few
 * milliseconds a frame, the move on screen first), the taps and full bars that change what it does.
 */
export class MoveDemo {
  private run!: DemoRun;
  private renderer!: Renderer;
  private move: DemoMove | null = null;
  private reps: Rep[] = [];
  private rep = 0;
  private acc = 0;
  private showingsOf = new Map<string, Rep[]>();
  /** Moves whose showings are still to be worked out, the next first, and the one being worked on. */
  private queue: DemoMove[];
  private work: { move: DemoMove; job: Generator<void, Rep[]> } | null = null;

  constructor(private fighter: string, private dummy: string | null) {
    this.queue = demoMoves(roster[fighter]);
    this.start();
  }

  /** The labels of the bars that change what this move does (none until that's been worked out). */
  barsFor(move: DemoMove): string[] {
    const bars = roster[this.fighter].bars ?? {};
    return [...new Set((this.showingsOf.get(move.name) ?? []).flatMap((r) => (r.bar ? [bars[r.bar].label] : [])))];
  }

  /** Works out showings for up to WORK_MS; a finished move on screen takes its showings from its next one. */
  private pump(): void {
    const until = performance.now() + WORK_MS;
    while (performance.now() < until) {
      if (!this.work) {
        const move = this.queue.shift();
        if (!move) return;
        this.work = { move, job: showings(this.fighter, this.dummy, move) };
      }
      const r = this.work.job.next();
      if (!r.done) continue;
      this.showingsOf.set(this.work.move.name, r.value);
      if (this.work.move.name === this.move?.name) {
        // carry on from the showing on screen, wherever it falls among them all
        const now = this.run.rep!;
        this.reps = r.value;
        this.rep = Math.max(0, r.value.findIndex((q) => q.dir === now.dir && q.bar === now.bar && q.tap === now.tap));
      }
      this.work = null;
    }
  }

  private get cur(): Rep | null {
    return this.reps.length ? this.reps[this.rep % this.reps.length] : null;
  }

  private start(): void {
    const run = this.run = new DemoRun(this.fighter, this.dummy, this.move, this.cur);
    const setup = run.setup;
    this.renderer = new Renderer(run.state, []);
    this.renderer.chrome = false;
    if (setup.launch) this.renderer.afterWorld = (ctx) => this.drawSpring(ctx);
    // centred on the pair (and the top of the dummy's flight), wide and tall enough for all of it
    let top = Math.min(-330, -(setup.launch?.rise ?? 0) - (roster[this.dummy ?? this.fighter].stats.height + 120));
    // a recovery from a jump climbs a long way: keep the top of it in frame (within reason)
    if (run.jumps && run.dir === "u") {
      const def = roster[this.fighter];
      const climb = (def.stats.fullHop * def.stats.fullHop) / (2 * def.stats.gravity) + (profileOf(def).specials.uspecial?.airRise ?? 0);
      top = Math.max(-820, Math.min(top, -climb - def.stats.height - 40));
    }
    const zoom = Math.min(VIEW_W / Math.max(760, Math.abs(setup.dummyX - setup.youX) + 520), VIEW_H / (80 - top));
    this.renderer.cam.pinned = { x: (setup.youX + setup.dummyX) / 2, y: (top + 80) / 2, zoom };
  }

  /** The spring pad under the dummy, leaning the way it throws: wound down until it does, then bouncing out and settling. */
  private drawSpring(ctx: CanvasRenderingContext2D): void {
    const { dummyX, launch } = this.run.setup;
    const t = this.run.frame - launch!.frame;
    const h = t < 0 ? 10 : 34 + 16 * Math.exp(-t / 10) * Math.cos(t / 2.2);
    const w = 70, coils = 5;
    ctx.save();
    this.renderer.cam.apply(ctx);
    ctx.translate(dummyX, 0);
    ctx.rotate(Math.atan2(launch!.dx / launch!.frames, launch!.vy) * 0.6);
    ctx.strokeStyle = INK; ctx.lineWidth = 4; ctx.lineJoin = "round"; ctx.lineCap = "round";
    ctx.beginPath();
    for (let i = 0; i <= coils * 2; i++) ctx.lineTo(i === 0 || i === coils * 2 ? 0 : i % 2 ? w / 2 - 8 : -w / 2 + 8, -(i / (coils * 2)) * h);
    ctx.stroke();
    ctx.fillStyle = PAPER;
    ctx.fillRect(-w / 2, -h - 8, w, 8);
    ctx.strokeRect(-w / 2, -h - 8, w, 8);
    ctx.restore();
  }

  /** Show `move` (null: just the two of them standing there). */
  play(move: DemoMove | null): void {
    if (move === this.move || (move && this.move && move.name === this.move.name)) return;
    this.move = move;
    this.reps = move ? this.showingsOf.get(move.name) ?? move.dirs.map((dir) => ({ dir, bar: null, tap: false })) : [];
    this.rep = 0;
    this.start();
    // the move on screen is worked out next
    const i = move ? this.queue.findIndex((q) => q.name === move.name) : -1;
    if (i > 0) this.queue.unshift(...this.queue.splice(i, 1));
  }

  /** Whether every showing of the current move has played at least once. */
  get shownAll(): boolean {
    return !!this.move && this.rep >= this.reps.length;
  }

  private tick(): void {
    const events = this.run.tick();
    this.renderer.snapshot(this.run.state);
    this.renderer.fx.consume(this.run.state, events, this.renderer.cam);
    if (this.run.done) {
      this.rep++;
      this.start();
    }
  }

  update(dt: number): void {
    this.pump();
    this.acc += dt * 1000;
    let n = 0;
    while (this.acc >= STEP && n < 4) { this.tick(); this.acc -= STEP; n++; }
    if (n === 4) this.acc = Math.min(this.acc, STEP);
  }

  /** Draws the match scaled into the box (16:9), with what's being pressed in its corner. */
  draw(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, dt: number): void {
    const h = (w * VIEW_H) / VIEW_W;
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.fillStyle = PAPER; ctx.fillRect(x, y, w, h);
    ctx.translate(x, y);
    ctx.scale(w / VIEW_W, w / VIEW_W);
    this.renderer.draw(ctx, this.run.state, this.acc / STEP, dt);
    ctx.restore();
    inkRect(ctx, x, y, w, h, INK, 1.6);
    const m = this.move, cur = this.run.rep;
    if (!m || !cur) return;
    // what keyboard player 1 presses for it (facing right, so forward is D), or on the touchscreen the controls' buttons
    const icons: KeyIcon[] = [];
    if (keysInHand()) {
      const b = bindingsOf("kb1");
      const icon = (keys: string[]): KeyIcon => keys[0] === "Space" ? { space: true } : keys[0] === "Mouse0" ? { mouse: "left" } : keys[0] === "Mouse2" ? { mouse: "right" } : { key: keyName(keys[0] ?? "") };
      if (this.run.jumps) icons.push(icon(b.jump));
      if (cur.dir !== "n") icons.push(icon(b[({ f: "right", u: "up", d: "down" } as const)[cur.dir]]));
      icons.push(icon(m.kind === "special" ? b.special : b.attack));
    } else {
      if (this.run.jumps) icons.push({ button: "JUMP" });
      if (cur.dir !== "n") icons.push({ stick: ({ f: "▶", u: "▲", d: "▼" } as const)[cur.dir] });
      icons.push({ button: m.kind === "special" ? "SPECIAL" : "ATTACK" });
    }
    const end = drawKeyIcons(ctx, icons, x + 20, y + 16, 48);
    // "hold" for a smash, and for a special when its tap is shown too
    const held = m.kind === "smash" || (holds(this.fighter, m, cur.dir) && this.reps.some((r) => r.dir === cur.dir && r.tap));
    if (cur.tap || held) label(ctx, cur.tap ? "tap" : "hold", end + 8, y + 50, grow(28, 12), INK, "left", 800);
    let below = y + 96;
    if (m.dirs.length > 1) {
      const size = grow(22, 11);
      m.dirs.forEach((d, i) => label(ctx, ARROW[d], x + 34 + i * Math.max(34, size * 1.5), below, size, d === cur.dir ? INK : "rgba(41,39,34,0.3)", "center", 900));
      below += size + 2;
    }
    if (cur.bar) this.drawBar(ctx, cur.bar, x + 20, below);
  }

  /** The bar this showing filled first: its name, and how full it is now. */
  private drawBar(ctx: CanvasRenderingContext2D, key: string, x: number, y: number): void {
    const b = roster[this.fighter].bars![key];
    const k = Math.max(0, Math.min(1, this.run.state.fighters[0].bars[key] / b.max));
    const w = 220;
    label(ctx, b.label, x, y + 4, 22, INK, "left", 900);
    ctx.fillStyle = b.color;
    ctx.fillRect(x, y + 14, w * k, 16);
    inkRect(ctx, x, y + 14, w, 16, INK, 1.4);
  }
}
