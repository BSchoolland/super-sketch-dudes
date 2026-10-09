import { api } from "./account";
import { registerStage, stageList, stages } from "../../shared/stages/index";
import { stageFromMap, type MapDoc } from "../../shared/maps";
import type { Stage } from "../../shared/types";
import { ART_THEMES } from "./render/stageart";

/** The signed-in player's maps and whether they may make them, fetched on demand and shared by every screen. */
export const myMaps: { docs: MapDoc[] | null; canCreate: boolean; error: string; loading: boolean } = { docs: null, canCreate: false, error: "", loading: false };

export const mapsApi = {
  list: () => api<{ maps: MapDoc[]; canCreate: boolean }>("/maps"),
  create: (doc: Pick<MapDoc, "name" | "pieces" | "spawns">) => api<{ map: MapDoc }>("/maps", { method: "POST", body: JSON.stringify(doc) }),
  save: (doc: MapDoc) => api<{ map: MapDoc }>(`/maps/${doc.id}`, { method: "PUT", body: JSON.stringify(doc) }),
  remove: (id: string) => api<void>(`/maps/${id}`, { method: "DELETE" }),
};

export async function refreshMaps(): Promise<void> {
  myMaps.loading = true;
  try {
    const { maps, canCreate } = await mapsApi.list();
    myMaps.docs = maps;
    myMaps.canCreate = canCreate;
    myMaps.error = "";
    for (const doc of maps) registerMap(doc);
  } catch (error) {
    console.error("maps fetch failed", error);
    myMaps.error = error instanceof Error ? error.message : String(error);
  } finally {
    myMaps.loading = false;
  }
}

export function forgetMaps(): void {
  myMaps.docs = null;
  myMaps.canCreate = false;
  myMaps.error = "";
}

/** Builds the map's stage and makes it playable (again, if the map changed). */
export function registerMap(doc: MapDoc): Stage {
  const stage = stageFromMap(doc);
  registerStage(stage);
  return stage;
}

/** A stage someone can pick: shipped, or a map (theirs, or one a host is showing them). */
export interface StageChoice { stage: Stage; map: MapDoc | null }

/** `art`: the stages drawn from art too (the EXTRA STAGES setting, or someone else's pick being shown). */
export function stageChoices(extra: MapDoc | null = null, art = true): StageChoice[] {
  const out: StageChoice[] = stageList.filter((stage) => art || !ART_THEMES.has(stage.theme)).map((stage) => ({ stage, map: null }));
  for (const doc of myMaps.docs ?? []) out.push({ stage: stages[doc.id] ?? registerMap(doc), map: doc });
  if (extra && !out.some((c) => c.map?.id === extra.id)) out.push({ stage: registerMap(extra), map: extra });
  return out;
}
