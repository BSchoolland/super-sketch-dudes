// Push a finished fighter to the live game. Usage:
//   npx tsx forge/tools/deploy.ts <fighter.js> <cellsDir> --name "NAME" --tagline "one line" --card "ATTACK  ...|SPECIAL  ...|UP+SPECIAL  ...|GRAB  ..." [--description "..."] [--anims '{"crouch":"block"}']
// Runs the checks first and refuses if they fail. Only the module and the cells go up: it writes the
// upload next to the cells as payload.json and the worker sends it; nothing else you changed leaves here.
import fs from "node:fs";
import path from "node:path";
import { runCheck, printReport } from "./gate";

const args = process.argv.slice(2);
const opt = (k: string, d = ""): string => { const i = args.indexOf(`--${k}`); return i >= 0 ? args.splice(i, 2)[1] : d; };
const name = opt("name").trim().slice(0, 24), tagline = opt("tagline").trim().slice(0, 120), description = opt("description").trim().slice(0, 600);
const card = opt("card").split("|").map((s) => s.trim()).filter(Boolean).slice(0, 4);
let anims: Record<string, string> = {};
try { anims = JSON.parse(opt("anims", "{}")); } catch { console.error("--anims must be JSON"); process.exit(2); }
const [js, cells] = args;
if (!js || !cells || !name || !tagline) { console.error("usage: npx tsx forge/tools/deploy.ts <fighter.js> <cellsDir> --name NAME --tagline LINE [--card a|b|c|d] [--description ...] [--anims json]"); process.exit(2); }

const { report, bundle, meta } = await runCheck(js, cells, anims);
printReport(report);
if (!report.ok) { console.error("\nnot uploaded: fix the failures above and run again"); process.exit(1); }
const b64 = (f: string) => fs.readFileSync(f).toString("base64");
const payload = {
  name, tagline, description, card: card.length === 4 ? card : null, source: bundle.source,
  sprite: { px: meta.px, feetPx: meta.feetPx, heightPx: meta.heightPx, anims },
  cells: Object.fromEntries(Object.keys(meta.cells).map((c) => [c, b64(path.join(cells, `${c}.png`))])),
  sheet: fs.existsSync(path.join(cells, "sheet.png")) ? b64(path.join(cells, "sheet.png")) : undefined,
  report: { checks: report, soft: report.soft },
};
const out = path.join(path.dirname(path.resolve(cells)), "payload.json");
fs.writeFileSync(out, JSON.stringify(payload));
console.log(`\nready to upload: ${name} ("${tagline}") -> ${out}`);
