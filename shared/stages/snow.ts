import type { Stage } from "../types";

/** A snowy branch low on each pine (pointing in), and the top of the snowman's hat. */
export const BRANCH = { x1: 330, x2: 500, y: -210 };
export const PINE_X = 540;
export const HAT = { x1: -60, x2: 60, y: -455 };

/** Snow Day: the whole floor is a frozen pond, so you slide; pine branches and a snowman's hat to stand on. */
export const snow: Stage = {
  id: "snow",
  name: "Snow Day",
  platforms: [
    { x1: -620, x2: 620, y: 0, solid: true, bottom: 140, grip: 0.25 },
    { x1: -BRANCH.x2, x2: -BRANCH.x1, y: BRANCH.y },
    { ...BRANCH },
    { ...HAT },
  ],
  ledges: [
    { x: -620, y: 0, side: -1, platform: 0 },
    { x: 620, y: 0, side: 1, platform: 0 },
  ],
  blast: { left: -1400, right: 1400, top: -1300, bottom: 600 },
  camera: { left: -1200, right: 1200, top: -1150, bottom: 440, minWidth: 900 },
  spawns: [
    { x: -430, y: 0, facing: 1 },
    { x: 430, y: 0, facing: -1 },
    { x: -220, y: 0, facing: 1 },
    { x: 220, y: 0, facing: -1 },
  ],
  respawn: { x: 0, y: -760 },
  theme: "snow",
};
