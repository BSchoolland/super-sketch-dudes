import type { DeviceId } from "./input/devices";
import type { SlotSource } from "./match";
import { fighterLoad } from "./gen";
import { houseChoice, isHouseId } from "./fighters";
import { HOUSE_ROSTER } from "../../shared/house";
import { roster } from "../../shared/fighters/index";
import { VersusScreen } from "./screens/versus";
import type { Screen } from "./screens/ui";

/** Registers the named fighters: house ids load their bundles, anything else must already be loaded (?gen=). */
export async function loadFighters(ids: string[]): Promise<void> {
  const loads = ids.map((id) => {
    if (roster[id]) return null;
    if (!isHouseId(id)) throw new Error(`fighter ${id}: not a house fighter (${HOUSE_ROSTER.map((h) => h.id).join(", ")}); load others with ?gen=<bundle url>`);
    return fighterLoad(houseChoice(id, id).bundleUrl);
  });
  await Promise.all(loads.map((l) => l?.promise));
  const failed = loads.find((l) => l?.state === "failed");
  if (failed) throw new Error(failed.error);
}

/**
 * ?quick=1&p2=cpu&cpu=9&f=lampjack,tank&stage=rooftops&seed=3&boxes=1 skips the menus into a
 * match; &training=1 makes it training. No sign-in needed.
 */
export async function quickMatch(params: URLSearchParams, exit: () => Screen): Promise<VersusScreen> {
  const ids = (params.get("f") ?? "lampjack,tank").split(",").filter(Boolean);
  await loadFighters(ids);
  const p2 = params.get("p2") ?? "cpu";
  const cpu = Number(params.get("cpu") ?? 6);
  const p1 = params.get("p1") ?? "kb1";
  const sources: SlotSource[] = ids.map((_, i) =>
    i === 0 ? (p1 === "cpu" ? { device: null, cpu } : { device: p1 as DeviceId, cpu: 0 })
    : i === 1 && p2 !== "cpu" ? { device: "kb2", cpu: 0 }
    : { device: null, cpu });
  const training = params.get("training") === "1";
  const make = (): VersusScreen => {
    const cfg = { stage: params.get("stage") ?? "proving", players: ids.map((id, i) => ({ fighter: id, cpu: sources[i].cpu })), rules: { stocks: Number(params.get("stocks") ?? 3), time: 0 }, seed: (Math.random() * 0xffffffff) >>> 0 };
    return new VersusScreen(cfg, sources.map((s) => ({ ...s })), exit, make, training);
  };
  const v = make();
  v.countdown = 0;
  if (params.get("seed")) v.match.state.seed = Number(params.get("seed"));
  if (params.get("boxes") === "1") v.renderer.showHitboxes = true;
  return v;
}
