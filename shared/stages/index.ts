import type { Stage, StageId } from "../types";
import { provingGround } from "./proving-ground";
import { rooftops } from "./rooftops";
import { menuStage } from "./menu";

/** The stages a match can be played on. */
export const stageList: Stage[] = [rooftops, provingGround];
/** Every stage the sim knows, including the title screen's brawl stage. */
export const stages: Record<StageId, Stage> = Object.fromEntries([...stageList, menuStage].map((s) => [s.id, s]));
