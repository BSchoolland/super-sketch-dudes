import { createFighter, createMatch, stageOf, step, type MatchConfig } from "./sim";
import { cpuInput } from "./cpu";
import { profileOf } from "./cpu-profile";
import { defOf, setAction } from "./fighter";
import { cloneInput, EMPTY_INPUT, type InputFrame } from "./input";
import { C } from "./config";
import type { GameEvent, State } from "./types";

export const SPAWN_EVERY = 20 * C.FPS;
/** How soon to look again when nobody is ready to drop in, or there's no room. */
const RETRY = C.FPS;
const MAX_FIGHTERS = 6;
const CPU_TIERS = [3, 4, 5];

/** A fighter's life ended: who fell, who gets the kill (null for a self-destruct), how long it lasted and what it dealt. */
export interface BrawlKo { victim: string; killer: string | null; survivedSec: number; dealt: number }

/**
 * The fight under the title screen, without the drawing: CPUs dropped in one at a time from whoever is
 * `ready`, one stock each (the fallen stay fallen), a new one every SPAWN_EVERY frames into a fallen
 * fighter's slot or a free one. A full arena waits for a KO; nobody alive is pushed out. The title screen
 * and scripts/brawl-bench.ts both run this.
 */
export class Brawl {
  state: State | null = null;
  private cpus: number[] = [];
  /** Sim frame each slot's fighter dropped in on. */
  private born: number[] = [];
  private inputs: InputFrame[] = [];
  private spawnT = SPAWN_EVERY;

  /** `ready` lists every fighter id that could drop in right now (registered in the roster). */
  constructor(private ready: () => string[], private rng: number) {}

  rand(n: number): number {
    this.rng = (this.rng * 1103515245 + 12345) & 0x7fffffff;
    return (this.rng >>> 8) % n;
  }

  /** A ready fighter not already in the fight (nor in `but`), if any. */
  private pick(but: string[] = []): string | null {
    const fighting = new Set([...but, ...(this.state?.fighters.map((f) => f.id) ?? [])]);
    const ready = this.ready().filter((id) => !fighting.has(id));
    return ready.length ? ready[this.rand(ready.length)] : null;
  }

  /** One sim frame, starting the fight first if two fighters are ready. Returns the frame's events and the lives it ended. */
  step(): { events: GameEvent[]; kos: BrawlKo[] } {
    if (!this.state) {
      const a = this.pick();
      const b = a ? this.pick([a]) : null;
      if (a && b) this.begin(a, b);
      return { events: [], kos: [] };
    }
    const st = this.state;
    if (--this.spawnT <= 0) {
      const id = this.full() ? null : this.pick();
      if (id) { this.spawn(id); this.spawnT = SPAWN_EVERY; }
      else this.spawnT = RETRY;
    }
    for (let i = 0; i < st.fighters.length; i++) this.inputs[i] = cpuInput(st, i, this.cpus[i]);
    step(st, this.inputs);
    // the brawl never ends, whatever the stock count says
    st.ended = false;
    const events = st.events;
    st.events = [];
    const kos: BrawlKo[] = [];
    for (const e of events) if (e.t === "ko") {
      const f = st.fighters[e.slot];
      kos.push({ victim: f.id, killer: e.by >= 0 ? st.fighters[e.by].id : null, survivedSec: (st.frame - this.born[e.slot]) / C.FPS, dealt: f.dealt });
    }
    return { events, kos };
  }

  private begin(a: string, b: string): void {
    const cfg: MatchConfig = { stage: "menu", players: [a, b].map((fighter) => ({ fighter, cpu: CPU_TIERS[this.rand(CPU_TIERS.length)] })), rules: { stocks: 1, time: 0 }, seed: this.rng };
    this.state = createMatch(cfg);
    this.cpus = this.state.fighters.map((f) => f.cpu);
    this.born = this.state.fighters.map(() => 0);
    this.inputs = this.state.fighters.map(() => cloneInput(EMPTY_INPUT));
    for (const f of this.state.fighters) profileOf(defOf(f));
  }

  private full(): boolean {
    const st = this.state!;
    return st.fighters.length >= MAX_FIGHTERS && st.fighters.every((f) => f.stocks > 0);
  }

  /** Drops a fighter in from the top: a dead fighter's slot first, else a new slot. */
  private spawn(id: string): void {
    const st = this.state!;
    const stage = stageOf(st);
    const cpu = CPU_TIERS[this.rand(CPU_TIERS.length)];
    let slot: number;
    const dead = st.fighters.findIndex((f) => f.stocks <= 0);
    if (dead >= 0) {
      slot = dead;
      vacate(st, slot);
      st.fighters[slot] = createFighter(slot, id, stage, st.rules, slot, cpu);
      this.cpus[slot] = cpu;
    } else {
      slot = st.fighters.length;
      st.fighters.push(createFighter(slot, id, stage, st.rules, slot, cpu));
      st.inputs.push(cloneInput(EMPTY_INPUT));
      this.inputs.push(cloneInput(EMPTY_INPUT));
      this.cpus.push(cpu);
    }
    this.born[slot] = st.frame;
    const f = st.fighters[slot];
    f.x = stage.respawn.x + (this.rand(600) - 300); f.y = stage.respawn.y;
    f.grounded = false; f.platform = -1; f.facing = f.x < 960 ? 1 : -1;
    f.invuln = C.RESPAWN_INVULN;
    setAction(f, "respawn");
    profileOf(defOf(f));
  }
}

/** Clears everything the rest of the fight holds on a slot about to change hands: its shots, its grabs, credit for its hits. */
function vacate(st: State, slot: number): void {
  st.projectiles = st.projectiles.filter((p) => p.owner !== slot && p.from !== slot);
  for (const o of st.fighters) {
    if (o.grabbing === slot) { o.grabbing = -1; setAction(o, "idle"); }
    if (o.grabbedBy === slot) { o.grabbedBy = -1; setAction(o, o.grounded ? "idle" : "air"); }
    if (o.lastHitBy === slot) o.lastHitBy = -1;
  }
}
