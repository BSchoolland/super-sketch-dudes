/**
 * The house roster: forged characters that ship with the game, served from /house/<id>/. They
 * are the CPU opponents when a library is empty, the forge's balance ladder, and the test
 * fixtures. Bundles are built by scripts/house-roster.mjs.
 */
export const HOUSE_ROSTER = [
  { id: "woodstove", name: "WOODSTOVE" },
  { id: "slugbert", name: "SLUGBERT" },
  { id: "rocket", name: "ROCKET" },
  // the same character as the FIRE WIZARD starter every library shows
  { id: "wizard", name: "FIRE WIZARD", starter: "gen-3358-bba1c9" },
] as const;
export type HouseId = (typeof HOUSE_ROSTER)[number]["id"];
/** Bundle URL relative to the site base (cell URLs inside the bundle are relative to it too). */
export const houseBundlePath = (id: HouseId): string => `house/${id}/bundle.json`;

/** The house fighters made from a starter in `ids`: the same character, so a roster shows only the starter. */
export function houseStartersIn(ids: Iterable<string>): Set<HouseId> {
  const have = new Set(ids);
  return new Set(HOUSE_ROSTER.flatMap((h) => ("starter" in h && have.has(h.starter) ? [h.id] : [])));
}
