import type { Stage, StageId } from "../types";
import { provingGround } from "./proving-ground";
import { rooftops } from "./rooftops";
import { stadium } from "./stadium";
import { forest } from "./forest";
import { cliffs } from "./cliffs";
import { finalStage } from "./final";
import { menuStage } from "./menu";

/** The stages a match can be played on. */
export const stageList: Stage[] = [rooftops, provingGround, stadium, forest, cliffs, finalStage];
/** Every stage the sim knows, including the title screen's brawl stage. */
export const stages: Record<StageId, Stage> = Object.fromEntries([...stageList, menuStage].map((s) => [s.id, s]));

/** Makes a player-made stage playable; its id must not be one of the shipped stages. */
export function registerStage(stage: Stage): void {
  if (stageList.some((s) => s.id === stage.id) || stage.id === menuStage.id) throw new Error(`stage ${stage.id} is built in`);
  stages[stage.id] = stage;
}
