import type { Stage } from "../types";

/** A thin platform: [x1, x2, y]. */
export type Thin = readonly [number, number, number];

export interface StagePlan {
  id: string;
  name: string;
  /** The main platform's walkable top, at y = 0. */
  main: readonly [number, number];
  /** How deep the main platform's solid body goes. */
  bottom: number;
  thin?: readonly Thin[];
  /** Renderer theme key; defaults to the id. */
  theme?: string;
}

/**
 * A stage laid out with the shipped stages' proportions (Rooftops, Proving Ground): blast zones about 760 units
 * outside the main platform's edges, the camera box 200 inside them, spawns spread over the main platform.
 */
export function layoutStage(plan: StagePlan): Stage {
  const [x1, x2] = plan.main;
  const thin = plan.thin ?? [];
  const highest = Math.min(0, ...thin.map((t) => t[2]));
  const top = Math.min(-1150, highest - 870);
  const half = (x2 - x1) / 2, mid = (x1 + x2) / 2;
  const far = Math.round(half * 0.72), near = Math.round(half * 0.24);
  return {
    id: plan.id,
    name: plan.name,
    platforms: [{ x1, x2, y: 0, solid: true, bottom: plan.bottom }, ...thin.map(([a, b, y]) => ({ x1: a, x2: b, y }))],
    ledges: [
      { x: x1, y: 0, side: -1, platform: 0 },
      { x: x2, y: 0, side: 1, platform: 0 },
    ],
    blast: { left: x1 - 760, right: x2 + 760, top, bottom: 550 },
    camera: { left: x1 - 560, right: x2 + 560, top: top + 150, bottom: 410, minWidth: 900 },
    spawns: [
      { x: mid - far, y: 0, facing: 1 },
      { x: mid + far, y: 0, facing: -1 },
      { x: mid - near, y: 0, facing: 1 },
      { x: mid + near, y: 0, facing: -1 },
    ],
    respawn: { x: mid, y: Math.min(-430, highest - 160) },
    theme: plan.theme ?? plan.id,
  };
}
