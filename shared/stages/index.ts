import type { Stage, StageId } from "../types";
import { provingGround } from "./proving-ground";
import { rooftops } from "./rooftops";
import { kesslerField } from "./kessler-field";

export const stages: Record<StageId, Stage> = {
  [rooftops.id]: rooftops,
  [provingGround.id]: provingGround,
  [kesslerField.id]: kesslerField,
};
export const stageList: Stage[] = Object.values(stages);
