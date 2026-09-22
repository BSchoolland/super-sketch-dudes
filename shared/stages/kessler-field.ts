import type { Stage } from "../types";

// A small planet-ish main stage with two debris platforms slowly orbiting it.
export const kesslerField: Stage = {
  id: "kessler",
  name: "Kessler Field",
  platforms: [
    { x1: -420, x2: 420, y: 0, solid: true, bottom: 240 },
    { x1: -80, x2: 80, y: -200, motion: { kind: "orbit", cx: 0, cy: -190, rx: 560, ry: 130, period: 1500, phase: 0 } },
    { x1: -80, x2: 80, y: -200, motion: { kind: "orbit", cx: 0, cy: -190, rx: 560, ry: 130, period: 1500, phase: 750 } },
  ],
  ledges: [
    { x: -420, y: 0, side: -1, platform: 0 },
    { x: 420, y: 0, side: 1, platform: 0 },
  ],
  blast: { left: -1200, right: 1200, top: -900, bottom: 520 },
  camera: { left: -1000, right: 1000, top: -820, bottom: 380, minWidth: 900 },
  spawns: [
    { x: -240, y: 0, facing: 1 },
    { x: 240, y: 0, facing: -1 },
    { x: -80, y: 0, facing: 1 },
    { x: 80, y: 0, facing: -1 },
  ],
  respawn: { x: 0, y: -420 },
  theme: "kessler",
};
