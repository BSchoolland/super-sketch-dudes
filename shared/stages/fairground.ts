import type { Platform, Stage } from "../types";

/** The Ferris wheel's hub and how far out its gondolas ride. */
export const WHEEL = { x: 0, y: -380, r: 240, period: 900 };

const gondola = (k: number): Platform => ({
  x1: WHEEL.x - 80, x2: WHEEL.x + 80, y: WHEEL.y,
  motion: { kind: "orbit", cx: WHEEL.x, cy: WHEEL.y, rx: WHEEL.r, ry: WHEEL.r, period: WHEEL.period, phase: (k * WHEEL.period) / 4 },
});

/** A main stage under a Ferris wheel: four gondolas going slowly round, to stand on and ride. */
export const fairground: Stage = {
  id: "fairground",
  name: "Fairground",
  platforms: [{ x1: -640, x2: 640, y: 0, solid: true, bottom: 300 }, gondola(0), gondola(1), gondola(2), gondola(3)],
  ledges: [
    { x: -640, y: 0, side: -1, platform: 0 },
    { x: 640, y: 0, side: 1, platform: 0 },
  ],
  blast: { left: -1400, right: 1400, top: -1400, bottom: 550 },
  camera: { left: -1200, right: 1200, top: -1250, bottom: 410, minWidth: 900 },
  spawns: [
    { x: -460, y: 0, facing: 1 },
    { x: 460, y: 0, facing: -1 },
    { x: -200, y: 0, facing: 1 },
    { x: 200, y: 0, facing: -1 },
  ],
  respawn: { x: 0, y: -820 },
  theme: "fairground",
};
