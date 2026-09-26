// Packs a generated fighter module + normalised cells into the bundle JSON the client loads.
// Usage: node scripts/gen-bundle.mjs <fighter.js> <cellsdir> <id> <cellUrlBase> [player] [description] > bundle.json
import { readFileSync } from "node:fs";
import { join } from "node:path";
const [js, cells, id, urlBase, player = "dev", description = ""] = process.argv.slice(2);
const meta = JSON.parse(readFileSync(join(cells, "cells.json"), "utf8"));
const bundle = {
  id, player, description,
  source: readFileSync(js, "utf8"),
  sprite: { px: meta.px, feetPx: meta.feetPx, heightPx: meta.heightPx, anims: {}, cells: Object.fromEntries(Object.keys(meta.cells).map((c) => [c, `${urlBase}/${c}.png`])) },
};
process.stdout.write(JSON.stringify(bundle));
