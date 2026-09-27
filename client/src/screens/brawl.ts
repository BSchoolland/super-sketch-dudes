import { Brawl } from "../../../shared/brawl";
import { roster } from "../../../shared/fighters/index";
import { Renderer } from "../render/render";
import { library } from "../account";
import { fighterLoad, type FighterLoad } from "../gen";
import { houseChoices, type FighterChoice } from "../fighters";
import { tallyKo } from "./brawl-tally";

const STEP = 1000 / 60;
/** Seconds between starting to load another contender, so the whole pool is in within a minute. */
const WARM_EVERY = 2;

interface Contender { id: string; bundleUrl: string }

/**
 * The fight under the title screen (shared/brawl.ts), with fighters drawn from every library and the
 * house, loaded a few at a time as it goes. No sound and no HUD; draws through the normal renderer with
 * a fixed camera, and tallies every KO for the server.
 */
export class MenuBrawl {
  private brawl = new Brawl(() => this.ready(), (Math.random() * 0x7fffffff) | 0);
  private renderer: Renderer | null = null;
  private acc = 0;
  /** No loading until everyone's list is in (or has failed), so the first pair is as random as the rest. */
  private warmT = Infinity;
  private pool: Contender[] = houseChoices().map((c: FighterChoice) => ({ id: c.id, bundleUrl: c.bundleUrl }));
  private loads = new Map<string, FighterLoad>();

  constructor() {
    library.everyone().then(({ characters }) => {
      for (const c of characters) if (!this.pool.some((p) => p.id === c.id)) this.pool.push({ id: c.id, bundleUrl: c.bundleUrl });
      for (let i = 0; i < 6; i++) this.warm();
    }, (error) => console.error("brawl: everyone's characters", error)).finally(() => { this.warmT = 0; });
  }

  /** Starts loading a random contender so a spawn later finds someone ready. */
  private warm(): void {
    if (!this.pool.length) return;
    const c = this.pool[this.brawl.rand(this.pool.length)];
    if (!this.loads.has(c.id)) this.loads.set(c.id, fighterLoad(c.bundleUrl));
  }

  private ready(): string[] {
    return [...this.loads.entries()].filter(([id, l]) => l.state === "ready" && roster[id]).map(([id]) => id);
  }

  update(dt: number): void {
    this.warmT -= dt;
    if (this.warmT <= 0) { this.warm(); this.warmT = WARM_EVERY; }
    this.acc += dt * 1000;
    let n = 0;
    while (this.acc >= STEP && n < 4) {
      const { events, kos } = this.brawl.step();
      const st = this.brawl.state;
      if (st) {
        if (!this.renderer) {
          this.renderer = new Renderer(st, []);
          this.renderer.chrome = false;
          this.renderer.cam.fixed = true;
        }
        this.renderer.snapshot(st);
        this.renderer.fx.consume(st, events, this.renderer.cam);
      }
      for (const k of kos) tallyKo(k.victim, k.killer, k.survivedSec, k.dealt);
      this.acc -= STEP;
      n++;
    }
    if (n === 4) this.acc = Math.min(this.acc, STEP);
  }

  draw(ctx: CanvasRenderingContext2D, dt: number): void {
    const st = this.brawl.state;
    if (!st || !this.renderer) return;
    this.renderer.draw(ctx, st, this.acc / STEP, dt);
  }
}
