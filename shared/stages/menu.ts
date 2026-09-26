import type { Stage } from "../types";

/**
 * The title screen as a stage, in view coordinates (1920x1080, +y down): the menu cards are solid
 * blocks the brawl bounces off, the logo's underline is a thin ledge, the floor is the bottom of
 * the screen. `hidden` platforms are drawn by the title screen itself.
 */
export const MENU_CARD = { x: 700, w: 520, h: 88, y0: 350, step: 96, n: 6 } as const;

export const menuStage: Stage = {
  id: "menu",
  name: "Main Menu",
  platforms: [
    { x1: 140, x2: 1780, y: 1000, solid: true, bottom: 1300 },
    ...Array.from({ length: MENU_CARD.n }, (_, i) => ({ x1: MENU_CARD.x, x2: MENU_CARD.x + MENU_CARD.w, y: MENU_CARD.y0 + i * MENU_CARD.step, solid: true, bottom: MENU_CARD.y0 + i * MENU_CARD.step + MENU_CARD.h, hidden: true })),
    { x1: 550, x2: 1370, y: 236, hidden: true },
    { x1: 150, x2: 440, y: 390 },
    { x1: 1480, x2: 1770, y: 390 },
    { x1: -90, x2: 90, y: 0, motion: { kind: "orbit", cx: 420, cy: 720, rx: 210, ry: 210, period: 1500, phase: 0 } },
    { x1: -90, x2: 90, y: 0, motion: { kind: "orbit", cx: 1500, cy: 720, rx: 210, ry: 210, period: 1500, phase: 750 } },
  ],
  ledges: [
    { x: 140, y: 1000, side: -1, platform: 0 },
    { x: 1780, y: 1000, side: 1, platform: 0 },
  ],
  blast: { left: -260, right: 2180, top: -720, bottom: 1420 },
  camera: { left: 0, right: 1920, top: 0, bottom: 1080, minWidth: 1920 },
  spawns: [
    { x: 420, y: 1000, facing: 1 },
    { x: 1500, y: 1000, facing: -1 },
    { x: 295, y: 390, facing: 1 },
    { x: 1625, y: 390, facing: -1 },
    { x: 760, y: 1000, facing: 1 },
    { x: 1160, y: 1000, facing: -1 },
  ],
  respawn: { x: 960, y: -160 },
  theme: "menu",
};
