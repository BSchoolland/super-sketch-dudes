import type { FighterDef, FighterId } from "../types";
import { sable } from "./sable/index";
import { brick } from "./brick/index";
import { wick } from "./wick/index";
import { pilot } from "./pilot/index";

export const roster: Record<FighterId, FighterDef> = {
  sable,
  brick,
  wick,
  pilot,
};
export const rosterList: FighterDef[] = Object.values(roster);
