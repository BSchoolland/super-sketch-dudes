// Where a point of the 1920x1080 game view is on the screen, worked out here rather than asked of the page, so a
// check that taps there tests the page's own mapping. A phone or tablet held upright turns the game a quarter
// clockwise (client/src/turn.ts): the stage is the viewport's height wide, and its top runs down the screen's right edge.

/** Whether a handheld page of this viewport draws the game turned. */
export const upright = ({ width, height }) => height > width;

/** View (vx, vy) in CSS pixels on a `viewport`-sized page, the game `turned` or not. */
export function viewToCss(viewport, turned, vx, vy) {
  const w = turned ? viewport.height : viewport.width, h = turned ? viewport.width : viewport.height;
  const s = Math.min(w / 1920, h / 1080);
  const x = (w - 1920 * s) / 2 + vx * s, y = (h - 1080 * s) / 2 + vy * s;
  return turned ? [h - y, x] : [x, y];
}

/** View pixels to CSS pixels on such a page: how far a finger moves for a view distance. */
export function viewScale(viewport, turned) {
  const w = turned ? viewport.height : viewport.width, h = turned ? viewport.width : viewport.height;
  return Math.min(w / 1920, h / 1080);
}
