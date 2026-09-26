import type { MenuInput } from "../../input/devices";
import { NetVersusScreen, type NetVersusOptions } from "../netversus";
import type { Screen } from "../ui";
import { standings } from "./logic";

export interface BattleReport {
  /** True when this client is the one that reports the result. */
  isReporter: () => boolean;
  send: (winner: number, standings: number[]) => void;
}

/** A DRAW BATTLE fight: the ladder moves on by itself, so the end screen ignores rematch/back, and the reporter sends the confirmed result. */
export class DrawBattleScreen extends NetVersusScreen {
  private reported = false;

  constructor(opts: NetVersusOptions, private report: BattleReport) {
    super(opts);
    this.endHint = "";
  }

  override update(dt: number, menu: MenuInput): Screen | null {
    const ended = this.session.state.ended;
    const next = super.update(dt, ended && !this.failure ? { ...menu, confirm: false, back: false, start: false } : menu);
    if (next || this.reported || !ended || this.endedFor < 2.5 || !this.report.isReporter()) return next;
    const confirmed = this.session.confirmedState();
    if (!confirmed?.ended) return null;
    const order = standings(confirmed.fighters, confirmed.winner);
    this.report.send(order[0], order);
    this.reported = true;
    return null;
  }
}
