import { createMatch, step, cloneState, type MatchConfig } from "../../shared/sim";
import { cpuInput } from "../../shared/cpu";
import { profileOf } from "../../shared/cpu-profile";
import { defOf } from "../../shared/fighter";
import { B, EMPTY_INPUT, type InputFrame } from "../../shared/input";
import type { GameEvent, State } from "../../shared/types";
import { readDevice, type DeviceId } from "./input/devices";
import { settings } from "./screens/ui";

export interface SlotSource { device: DeviceId | null; cpu: number }

export interface MatchDriver {
  readonly state: State;
  readonly sources: SlotSource[];
  paused: boolean;
  readonly stalled: boolean;
  lastInputs: InputFrame[];
  tick(): boolean;
  takeEvents(): GameEvent[];
  /** Online: how far rollbacks moved fighters under the renderer since the last call. */
  takeCorrections?(): { slot: number; dx: number; dy: number }[];
}

/** Drives a local match: input sampling, fixed-step sim, events out. Online swaps the input source. */
export class LocalMatch implements MatchDriver {
  state: State;
  sources: SlotSource[];
  paused = false;
  readonly stalled = false;
  pauseEdge = false;
  events: GameEvent[] = [];
  lastInputs: InputFrame[];
  constructor(cfg: MatchConfig, sources: SlotSource[]) {
    this.state = createMatch(cfg);
    this.sources = sources;
    // the CPU probes each fighter's specials on first use; do it now rather than in the first frame
    sources.forEach((s, i) => { if (!s.device && s.cpu > 0) profileOf(defOf(this.state.fighters[i])); });
    this.lastInputs = sources.map(() => ({ ...EMPTY_INPUT }));
  }
  sample(): InputFrame[] {
    return this.sources.map((s, i) => {
      if (s.device) return readDevice(s.device, { tapJump: settings.tapJump });
      if (s.cpu > 0) return cpuInput(this.state, i, s.cpu);
      return { ...EMPTY_INPUT };
    });
  }
  /** One sim frame with freshly sampled inputs. Returns false if paused. */
  tick(): boolean {
    const inputs = this.sample();
    const pausePressed = inputs.some((inp, i) => (inp.b & B.PAUSE) && !(this.lastInputs[i].b & B.PAUSE));
    this.lastInputs = inputs;
    if (pausePressed && !this.state.ended) this.paused = !this.paused;
    if (this.paused) return false;
    step(this.state, inputs);
    this.events.push(...this.state.events);
    this.state.events.length = 0;
    return true;
  }
  takeEvents(): GameEvent[] { const e = this.events; this.events = []; return e; }
  snapshot(): State { return cloneState(this.state); }
}
