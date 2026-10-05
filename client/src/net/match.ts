import { EMPTY_INPUT, cloneInput, type InputFrame } from "../../../shared/input";
import type { GameEvent, State } from "../../../shared/types";
import { readDevice } from "../input/devices";
import { settings } from "../screens/ui";
import type { MatchDriver, SlotSource } from "../match";
import type { RollbackSession } from "./rollback";

export class RollbackMatch implements MatchDriver {
  readonly sources: SlotSource[];
  paused = false;
  lastInputs: InputFrame[];

  constructor(readonly session: RollbackSession, localDevice: SlotSource["device"]) {
    this.sources = session.state.fighters.map((fighter) => ({
      device: fighter.slot === session.localSlot ? localDevice : null,
      cpu: fighter.cpu,
    }));
    this.lastInputs = this.sources.map(() => cloneInput(EMPTY_INPUT));
  }

  get state(): State {
    return this.session.state;
  }

  /** Never: the session's clock moves every tick, frozen or not, and the sim catches up by itself. */
  get stalled(): boolean {
    return false;
  }

  tick(): boolean {
    const source = this.sources[this.session.localSlot];
    const input = source.device ? readDevice(source.device, { tapJump: settings.tapJump }) : cloneInput(EMPTY_INPUT);
    this.lastInputs[this.session.localSlot] = input;
    return this.session.advance(input);
  }

  takeEvents(): GameEvent[] {
    return this.session.takeEvents();
  }
}
