import { createFighter, createMatch, stageOf, step, type MatchConfig } from "../../../shared/sim";
import { cpuInput } from "../../../shared/cpu";
import { profileOf } from "../../../shared/cpu-profile";
import { defOf, setAction } from "../../../shared/fighter";
import { cloneInput, EMPTY_INPUT, type InputFrame } from "../../../shared/input";
import { roster } from "../../../shared/fighters/index";
import { C } from "../../../shared/config";
import type { State } from "../../../shared/types";
import { Renderer } from "../render/render";
import { library } from "../account";
import { fighterLoad, type FighterLoad } from "../gen";
import { houseChoices, type FighterChoice } from "../fighters";

const STEP = 1000 / 60;
const SPAWN_EVERY = 20;
const MAX_FIGHTERS = 6;
const CPU_LEVELS = [4, 5, 6, 7, 8, 9];

interface Contender { id: string; bundleUrl: string }

/**
 * The fight under the title screen: CPUs drawn from every library and the house, dropped in
 * one at a time, no sound and no HUD. Runs the sim on its own fixed step and draws through the
 * normal renderer with a fixed camera.
 */
export class MenuBrawl {
  private state: State | null = null;
  private renderer: Renderer | null = null;
  private cpus: number[] = [];
  private inputs: InputFrame[] = [];
  private acc = 0;
  private spawnT = SPAWN_EVERY;
  private pool: Contender[] = houseChoices().map((c: FighterChoice) => ({ id: c.id, bundleUrl: c.bundleUrl }));
  private loads = new Map<string, FighterLoad>();
  private next = 0;
  private rng = (Math.random() * 0x7fffffff) | 0;

  constructor() {
    library.everyone().then(({ characters }) => {
      for (const c of characters) if (!this.pool.some((p) => p.id === c.id)) this.pool.push({ id: c.id, bundleUrl: c.bundleUrl });
    }, (error) => console.error("brawl: everyone's characters", error));
    for (let i = 0; i < 4; i++) this.warm();
  }

  private rand(n: number): number {
    this.rng = (this.rng * 1103515245 + 12345) & 0x7fffffff;
    return (this.rng >>> 8) % n;
  }

  /** Starts loading a random contender so a spawn later finds someone ready. */
  private warm(): void {
    if (!this.pool.length) return;
    const c = this.pool[this.rand(this.pool.length)];
    if (!this.loads.has(c.id)) this.loads.set(c.id, fighterLoad(c.bundleUrl));
  }

  /** A loaded fighter not already in the fight (nor in `but`), if any. */
  private pick(but: string[] = []): string | null {
    const fighting = new Set([...but, ...(this.state?.fighters.map((f) => f.id) ?? [])]);
    const ready = [...this.loads.entries()].filter(([id, l]) => l.state === "ready" && roster[id] && !fighting.has(id)).map(([id]) => id);
    if (!ready.length) { this.warm(); return null; }
    return ready[this.rand(ready.length)];
  }

  private begin(a: string, b: string): void {
    const cfg: MatchConfig = { stage: "menu", players: [a, b].map((fighter) => ({ fighter, cpu: CPU_LEVELS[this.rand(CPU_LEVELS.length)] })), rules: { stocks: 99, time: 0 }, seed: this.rng };
    this.state = createMatch(cfg);
    this.cpus = this.state.fighters.map((f) => f.cpu);
    this.inputs = this.state.fighters.map(() => cloneInput(EMPTY_INPUT));
    for (const f of this.state.fighters) profileOf(defOf(f));
    this.renderer = new Renderer(this.state, []);
    this.renderer.chrome = false;
    this.renderer.cam.fixed = true;
  }

  /** Drops a fighter in from the top: a new slot while there's room, else the slot that has been here longest. */
  private spawn(id: string): void {
    const st = this.state!;
    const stage = stageOf(st);
    const cpu = CPU_LEVELS[this.rand(CPU_LEVELS.length)];
    let slot: number;
    if (st.fighters.length < MAX_FIGHTERS) {
      slot = st.fighters.length;
      st.fighters.push(createFighter(slot, id, stage, st.rules, slot, cpu));
      st.inputs.push(cloneInput(EMPTY_INPUT));
      this.inputs.push(cloneInput(EMPTY_INPUT));
      this.cpus.push(cpu);
    } else {
      slot = this.next;
      this.next = (this.next + 1) % MAX_FIGHTERS;
      st.projectiles = st.projectiles.filter((p) => p.owner !== slot && p.from !== slot);
      for (const o of st.fighters) {
        if (o.grabbing === slot) { o.grabbing = -1; setAction(o, "idle"); }
        if (o.grabbedBy === slot) { o.grabbedBy = -1; setAction(o, o.grounded ? "idle" : "air"); }
        if (o.lastHitBy === slot) o.lastHitBy = -1;
      }
      st.fighters[slot] = createFighter(slot, id, stage, st.rules, slot, cpu);
      this.cpus[slot] = cpu;
    }
    const f = st.fighters[slot];
    f.x = stage.respawn.x + (this.rand(600) - 300); f.y = stage.respawn.y;
    f.grounded = false; f.platform = -1; f.facing = f.x < 960 ? 1 : -1;
    f.invuln = C.RESPAWN_INVULN;
    setAction(f, "respawn");
    profileOf(defOf(f));
  }

  update(dt: number): void {
    if (!this.state) {
      const a = this.pick();
      const b = a ? this.pick([a]) : null;
      if (a && b) this.begin(a, b);
      return;
    }
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      const id = this.pick();
      if (id) { this.spawn(id); this.spawnT = SPAWN_EVERY; this.warm(); }
      else this.spawnT = 1;
    }
    this.acc += dt * 1000;
    let n = 0;
    while (this.acc >= STEP && n < 4) {
      const st = this.state;
      for (let i = 0; i < st.fighters.length; i++) this.inputs[i] = cpuInput(st, i, this.cpus[i]);
      stepSilently(st, this.inputs);
      this.renderer!.snapshot(st);
      this.renderer!.fx.consume(st, st.events, this.renderer!.cam);
      st.events.length = 0;
      this.acc -= STEP;
      n++;
    }
    if (n === 4) this.acc = Math.min(this.acc, STEP);
  }

  draw(ctx: CanvasRenderingContext2D, dt: number): void {
    if (!this.state || !this.renderer) return;
    this.renderer.draw(ctx, this.state, this.acc / STEP, dt);
  }
}

/** One sim frame; the brawl never ends, whatever the stock count says. */
function stepSilently(state: State, inputs: InputFrame[]): void {
  step(state, inputs);
  state.ended = false;
}
