// Balance-test a fighter module against its cells. Usage: npx tsx forge/tools/check.ts <fighter.js> <cellsDir>
// Runs the same gate the game applies before it will serve a fighter: lint, build, validate, recovery,
// KO, determinism resim, a sweep of every move, and a short ladder against four house fighters.
import { runCheck, printReport } from "./gate";
const [js, cells] = process.argv.slice(2);
if (!js || !cells) { console.error("usage: npx tsx forge/tools/check.ts <fighter.js> <cellsDir>"); process.exit(2); }
const { report } = await runCheck(js, cells);
printReport(report);
process.exit(report.ok ? 0 : 1);
