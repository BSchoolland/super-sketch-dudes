import type { Stage } from "../types";

// Origin is the centre of the main stage's top surface. y grows downward.
export const provingGround: Stage = {
  id: "proving",
  name: "Proving Ground",
  platforms: [{ x1: -560, x2: 560, y: 0, solid: true, bottom: 260 }],
  ledges: [
    { x: -560, y: 0, side: -1, platform: 0 },
    { x: 560, y: 0, side: 1, platform: 0 },
  ],
  blast: { left: -1300, right: 1300, top: -1150, bottom: 560 },
  camera: { left: -1100, right: 1100, top: -1000, bottom: 420, minWidth: 900 },
  spawns: [
    { x: -390, y: 0, facing: 1 },
    { x: 390, y: 0, facing: -1 },
    { x: -130, y: 0, facing: 1 },
    { x: 130, y: 0, facing: -1 },
  ],
  respawn: { x: 0, y: -420 },
  theme: "proving",
};
