import type { Stage } from "../types";

/** The lunar lander's deck, and the moon rock that bobs over the far side. */
export const LANDER = { x1: -480, x2: -300, y: -230 };
export const ROCK = { x1: 170, x2: 370, y: -400, bob: 70 };

/** The Moon: low gravity, so jumps go high and launches carry; the blast zone sits farther out to make up for it. */
export const moon: Stage = {
  id: "moon",
  name: "The Moon",
  platforms: [
    { x1: -640, x2: 640, y: 0, solid: true, bottom: 150 },
    { ...LANDER },
    { x1: ROCK.x1, x2: ROCK.x2, y: ROCK.y, motion: { kind: "line", dx: 0, dy: ROCK.bob, period: 600, phase: 0 } },
  ],
  ledges: [
    { x: -640, y: 0, side: -1, platform: 0 },
    { x: 640, y: 0, side: 1, platform: 0 },
  ],
  blast: { left: -1400, right: 1400, top: -1600, bottom: 650 },
  camera: { left: -1200, right: 1200, top: -1380, bottom: 480, minWidth: 900 },
  spawns: [
    { x: -440, y: 0, facing: 1 },
    { x: 440, y: 0, facing: -1 },
    { x: -150, y: 0, facing: 1 },
    { x: 150, y: 0, facing: -1 },
  ],
  respawn: { x: 0, y: -760 },
  theme: "moon",
  gravity: 0.65,
};
