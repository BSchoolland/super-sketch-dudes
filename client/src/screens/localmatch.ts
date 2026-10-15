import type { Screen } from "./ui";
import type { FighterChoice } from "../fighters";
import type { SlotSource } from "../match";
import type { MatchSetup } from "./stage";
import { LoadingScreen } from "./loading";
import { VersusScreen } from "./versus";

/** `team`: their side, when the match is a team battle. */
export interface LocalPlayer { fighter: FighterChoice; source: SlotSource; team?: number }

/** A local match: loads every fighter, then fights; REMATCH replays the same setup with a new seed. */
export function localMatch(players: LocalPlayer[], setup: MatchSetup, exit: () => Screen, teams = false): Screen {
  const make = (): Screen => {
    const cfg = { stage: setup.stage, players: players.map((p) => ({ fighter: p.fighter.id, cpu: p.source.cpu, team: p.team })), rules: { stocks: setup.stocks, time: setup.time, teams }, seed: (Math.random() * 0xffffffff) >>> 0, ...(setup.map ? { map: setup.map } : {}) };
    return new VersusScreen(cfg, players.map((p) => ({ ...p.source })), exit, make);
  };
  return new LoadingScreen(players.map((p) => p.fighter.bundleUrl), make, exit);
}
