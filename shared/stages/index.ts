import type { Stage, StageId } from "../types";
import { provingGround } from "./proving-ground";

export const stages: Record<StageId, Stage> = {
  [provingGround.id]: provingGround,
};
export const stageList: Stage[] = Object.values(stages);
