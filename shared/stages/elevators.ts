import type { Stage } from "../types";

/** A small main stage with a lift going up and down past each edge, out of step with each other. */
export const elevators: Stage = {
  id: "elevators",
  name: "Elevators",
  platforms: [
    { x1: -420, x2: 420, y: 0, solid: true, bottom: 280 },
    { x1: -700, x2: -520, y: 80, motion: { kind: "line", dx: 0, dy: -380, period: 300, phase: 0 } },
    { x1: 520, x2: 700, y: 80, motion: { kind: "line", dx: 0, dy: -380, period: 300, phase: 150 } },
    { x1: -110, x2: 110, y: -220 },
  ],
  ledges: [
    { x: -420, y: 0, side: -1, platform: 0 },
    { x: 420, y: 0, side: 1, platform: 0 },
  ],
  blast: { left: -1420, right: 1420, top: -1150, bottom: 560 },
  camera: { left: -1220, right: 1220, top: -1000, bottom: 420, minWidth: 900 },
  spawns: [
    { x: -300, y: 0, facing: 1 },
    { x: 300, y: 0, facing: -1 },
    { x: -100, y: 0, facing: 1 },
    { x: 100, y: 0, facing: -1 },
  ],
  respawn: { x: 0, y: -450 },
  theme: "elevators",
};
