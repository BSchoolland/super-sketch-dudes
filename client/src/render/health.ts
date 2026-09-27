/** Counters the renderer bumps as it draws; an online match's wide event reads them. */
export const drawHealth = {
  sprites: 0,
  /** Sprite draws whose cell image was still loading (a faint placeholder) or had failed (nothing). */
  loading: 0,
  failed: 0,
  failedCells: new Set<string>(),
};
