import type { Stage } from "../types";

/** The paper airplane's rest position and how far it flies before turning back. */
export const PLANE = { x1: -560, x2: -400, y: -420, span: 960 };
/** The book stack's top and the pencil cup's rim. */
export const BOOKS = { x1: -520, x2: -280, y: -140 };
export const CUP = { x1: 300, x2: 450, y: -200 };

/** A school desk with the fighters doodled on it: a stack of books, a pencil cup, and a paper airplane to ride. */
export const desk: Stage = {
  id: "desk",
  name: "School Desk",
  platforms: [
    { x1: -620, x2: 620, y: 0, solid: true, bottom: 120 },
    { ...BOOKS },
    { ...CUP },
    { x1: PLANE.x1, x2: PLANE.x2, y: PLANE.y, motion: { kind: "line", dx: PLANE.span, dy: 0, period: 720, phase: 0 } },
  ],
  ledges: [
    { x: -620, y: 0, side: -1, platform: 0 },
    { x: 620, y: 0, side: 1, platform: 0 },
  ],
  blast: { left: -1400, right: 1400, top: -1300, bottom: 600 },
  camera: { left: -1200, right: 1200, top: -1150, bottom: 440, minWidth: 900 },
  spawns: [
    { x: -440, y: 0, facing: 1 },
    { x: 440, y: 0, facing: -1 },
    { x: -150, y: 0, facing: 1 },
    { x: 150, y: 0, facing: -1 },
  ],
  respawn: { x: 0, y: -720 },
  theme: "desk",
};
