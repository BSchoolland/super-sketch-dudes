import type { Stage } from "../types";

export const rooftops: Stage = {
  id: "rooftops",
  name: "Rooftops",
  platforms: [
    { x1: -480, x2: 480, y: 0, solid: true, bottom: 320 },
    { x1: -340, x2: -130, y: -170 },
    { x1: 130, x2: 340, y: -170 },
    { x1: -105, x2: 105, y: -330 },
  ],
  ledges: [
    { x: -480, y: 0, side: -1, platform: 0 },
    { x: 480, y: 0, side: 1, platform: 0 },
  ],
  blast: { left: -1250, right: 1250, top: -1200, bottom: 540 },
  camera: { left: -1050, right: 1050, top: -1050, bottom: 400, minWidth: 900 },
  spawns: [
    { x: -360, y: 0, facing: 1 },
    { x: 360, y: 0, facing: -1 },
    { x: -120, y: 0, facing: 1 },
    { x: 120, y: 0, facing: -1 },
  ],
  respawn: { x: 0, y: -450 },
  theme: "rooftops",
};
