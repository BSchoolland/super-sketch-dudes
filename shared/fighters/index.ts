import type { FighterDef, FighterId } from "../types";
import { sable } from "./sable/index";

export const roster: Record<FighterId, FighterDef> = {
  sable,
};
export const rosterList: FighterDef[] = Object.values(roster);
