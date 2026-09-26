/**
 * The house roster: forged characters that ship with the game, served from /house/<id>/. They
 * are the CPU opponents when a library is empty, the forge's balance ladder, and the test
 * fixtures. Bundles are built by scripts/house-roster.mjs.
 */
export const HOUSE_ROSTER = [
  { id: "woodstove", name: "WOODSTOVE" },
  { id: "slugbert", name: "SLUGBERT" },
  { id: "rocket", name: "ROCKET" },
  { id: "wizard", name: "WIZARD" },
] as const;
export type HouseId = (typeof HOUSE_ROSTER)[number]["id"];
/** Bundle URL relative to the site base (cell URLs inside the bundle are relative to it too). */
export const houseBundlePath = (id: HouseId): string => `house/${id}/bundle.json`;
