import { Brawl } from "../../../shared/brawl";
import { roster } from "../../../shared/fighters/index";
import type { HouseId } from "../../../shared/house";
import { Renderer } from "../render/render";
import { library } from "../account";
import { fighterLoad, unloadFighter, type FighterLoad } from "../gen";
import { houseChoice } from "../fighters";
import { tallyKo } from "./brawl-tally";

const STEP = 1000 / 60;
/** Contenders asked for at a time, when fewer than LOW loaded ones are waiting to drop in. */
const BATCH = 8, LOW = 4;
/** Seconds between asks: the usual, and after the server had nobody new to offer. */
const ASK_EVERY = 2, ASK_AGAIN = 10;

/**
 * The fight under the title screen (shared/brawl.ts), with contenders sampled from the server a few at
 * a time and unloaded once they're KO'd and out of the arena, back into the pool the next asks draw from.
 * No sound and no HUD; draws through the normal renderer with a fixed camera, and tallies every KO.
 */
export class MenuBrawl {
  private brawl = new Brawl(() => this.ready(), (Math.random() * 0x7fffffff) | 0);
  private renderer: Renderer | null = null;
  private acc = 0;
  private askT = 0;
  private asking = false;
  /** In the order they arrived, so the oldest is first. */
  private loads = new Map<string, { url: string; load: FighterLoad }>();
  /** KO'd, to unload once their slot is taken. */
  private fallen = new Set<string>();

  private ready(): string[] {
    return [...this.loads.entries()].filter(([id, l]) => l.load.state === "ready" && roster[id]).map(([id]) => id);
  }

  private fighting(): Set<string> {
    return new Set(this.brawl.state?.fighters.map((f) => f.id) ?? []);
  }

  private async ask(): Promise<void> {
    this.asking = true;
    let got = 0;
    try {
      const { characters } = await library.sample(BATCH, [...this.loads.keys()]);
      for (const c of characters) {
        if (this.loads.has(c.id)) continue;
        const url = c.bundleUrl ?? houseChoice(c.id as HouseId, c.name ?? c.id).bundleUrl;
        this.loads.set(c.id, { url, load: fighterLoad(url) });
        got++;
      }
    } catch (error) {
      console.error("brawl: sampling contenders", error);
    } finally {
      this.asking = false;
      this.askT = got ? ASK_EVERY : ASK_AGAIN;
    }
  }

  private unload(): void {
    const fighting = this.fighting();
    for (const id of this.fallen) {
      if (fighting.has(id)) continue;
      unloadFighter(this.loads.get(id)!.url, id);
      this.loads.delete(id);
      this.fallen.delete(id);
    }
  }

  update(dt: number): void {
    this.askT -= dt;
    if (!this.asking && this.askT <= 0) {
      const fighting = this.fighting();
      if (this.ready().filter((id) => !fighting.has(id)).length < LOW) void this.ask();
      else this.askT = ASK_EVERY;
    }
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
      for (const k of kos) { tallyKo(k.victim, k.killer, k.survivedSec, k.dealt); this.fallen.add(k.victim); }
      this.acc -= STEP;
      n++;
    }
    if (n === 4) this.acc = Math.min(this.acc, STEP);
    this.unload();
  }

  draw(ctx: CanvasRenderingContext2D, dt: number): void {
    const st = this.brawl.state;
    if (!st || !this.renderer) return;
    this.renderer.draw(ctx, st, this.acc / STEP, dt);
  }
}
