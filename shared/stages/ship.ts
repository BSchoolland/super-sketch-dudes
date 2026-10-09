import type { Stage } from "../types";

/** The crow's nest's rest position and how far the mast sways it. */
export const NEST = { x1: -120, x2: 30, y: -400, sway: 90 };

/** A pirate ship's deck on the open sea: a raised deck fore and aft, and a crow's nest swaying on the mast. */
export const ship: Stage = {
  id: "ship",
  name: "Pirate Ship",
  platforms: [
    { x1: -600, x2: 600, y: 0, solid: true, bottom: 280 },
    { x1: -560, x2: -300, y: -150 },
    { x1: 300, x2: 560, y: -150 },
    { x1: NEST.x1, x2: NEST.x2, y: NEST.y, motion: { kind: "line", dx: NEST.sway, dy: 0, period: 420, phase: 0 } },
  ],
  ledges: [
    { x: -600, y: 0, side: -1, platform: 0 },
    { x: 600, y: 0, side: 1, platform: 0 },
  ],
  blast: { left: -1450, right: 1450, top: -1300, bottom: 560 },
  camera: { left: -1250, right: 1250, top: -1150, bottom: 420, minWidth: 900 },
  spawns: [
    { x: -440, y: 0, facing: 1 },
    { x: 440, y: 0, facing: -1 },
    { x: -180, y: 0, facing: 1 },
    { x: 180, y: 0, facing: -1 },
  ],
  respawn: { x: 0, y: -700 },
  theme: "ship",
};
