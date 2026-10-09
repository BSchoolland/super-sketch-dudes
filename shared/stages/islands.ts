import type { Stage } from "../types";

/** Two islands with a gap between them, a ferry going back and forth across it and a platform over it. */
export const islands: Stage = {
  id: "islands",
  name: "Islands",
  platforms: [
    { x1: -860, x2: -240, y: 0, solid: true, bottom: 300 },
    { x1: 240, x2: 860, y: 0, solid: true, bottom: 300 },
    { x1: -230, x2: -30, y: -20, motion: { kind: "line", dx: 260, dy: 0, period: 360, phase: 0 } },
    { x1: -110, x2: 110, y: -260 },
  ],
  ledges: [
    { x: -860, y: 0, side: -1, platform: 0 },
    { x: -240, y: 0, side: 1, platform: 0 },
    { x: 240, y: 0, side: -1, platform: 1 },
    { x: 860, y: 0, side: 1, platform: 1 },
  ],
  blast: { left: -1620, right: 1620, top: -1150, bottom: 560 },
  camera: { left: -1420, right: 1420, top: -1000, bottom: 420, minWidth: 900 },
  spawns: [
    { x: -640, y: 0, facing: 1 },
    { x: 640, y: 0, facing: -1 },
    { x: -400, y: 0, facing: 1 },
    { x: 400, y: 0, facing: -1 },
  ],
  respawn: { x: 0, y: -450 },
  theme: "islands",
};
