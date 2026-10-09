import type { Stage } from "../types";

/** The trampoline's bed, the bleachers' top rows and the basketball backboard. */
export const TRAMPOLINE = { x1: -130, x2: 130, y: -70 };
export const BLEACHERS = { x1: 340, x2: 540, y: -250 };
export const BACKBOARD = { x1: -90, x2: 90, y: -540 };
/** How high a trampoline springs you (player maps' bouncy pieces too). */
export const BOUNCE = 380;

/** Gym class: a trampoline in the middle bounces you up toward the basketball backboard. */
export const gym: Stage = {
  id: "gym",
  name: "Gym Class",
  platforms: [
    { x1: -660, x2: 660, y: 0, solid: true, bottom: 140 },
    { ...TRAMPOLINE, bounce: BOUNCE },
    { x1: -BLEACHERS.x2, x2: -BLEACHERS.x1, y: BLEACHERS.y },
    { ...BLEACHERS },
    { ...BACKBOARD },
  ],
  ledges: [
    { x: -660, y: 0, side: -1, platform: 0 },
    { x: 660, y: 0, side: 1, platform: 0 },
  ],
  blast: { left: -1400, right: 1400, top: -1300, bottom: 600 },
  camera: { left: -1200, right: 1200, top: -1150, bottom: 440, minWidth: 900 },
  spawns: [
    { x: -450, y: 0, facing: 1 },
    { x: 450, y: 0, facing: -1 },
    { x: -250, y: 0, facing: 1 },
    { x: 250, y: 0, facing: -1 },
  ],
  respawn: { x: 0, y: -760 },
  theme: "gym",
};
