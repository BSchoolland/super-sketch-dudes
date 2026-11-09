// Checks a restyle changed only how a fighter looks: plays the original and the restyle frame for frame and
// reports the first frame each one plays differently. Usage: npx tsx forge/tools/same-game.ts <original.js> <restyled.js> <cellsDir>
import path from "node:path";
import { bundleOf } from "./gate";
import { sameGame } from "../same-game";

const [orig, next, cells] = process.argv.slice(2);
if (!orig || !next || !cells) { console.error("usage: npx tsx forge/tools/same-game.ts <original.js> <restyled.js> <cellsDir>"); process.exit(2); }
const problems = await sameGame(bundleOf(path.resolve(orig), path.resolve(cells)).bundle, bundleOf(path.resolve(next), path.resolve(cells)).bundle);
if (problems.length) {
  console.log(`PLAYS DIFFERENTLY (only draws, looks and a move's draw may change):\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log("SAME GAME: the restyle plays exactly like the original");
