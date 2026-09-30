// The CPU's study of fighters (shared/cpu-study.ts), written into their bundles. Usage:
//   npx tsx forge/tools/study.ts <bundle.json>...
// The house fighters are registered first (a bundle may be one of them), then each bundle is built,
// studied and rewritten with its `cpu` field.
import fs from "node:fs";
import { registerFighter } from "../../shared/fighters/index";
import { buildGenerated, type GeneratedBundle } from "../../shared/gen/load";
import { studyFighter } from "../../shared/cpu-study";

const files = process.argv.slice(2);
if (!files.length) { console.error("usage: npx tsx forge/tools/study.ts <bundle.json>..."); process.exit(2); }
for (const file of files) {
  const bundle = JSON.parse(fs.readFileSync(file, "utf8")) as GeneratedBundle;
  const t0 = Date.now();
  const def = await buildGenerated({ ...bundle, cpu: undefined });
  registerFighter(def);
  bundle.cpu = studyFighter(def);
  fs.writeFileSync(file, JSON.stringify(bundle));
  console.log(`${bundle.id}: studied in ${((Date.now() - t0) / 1000).toFixed(1)}s (${Object.keys(bundle.cpu.forms).length} forms), ${(JSON.stringify(bundle.cpu).length / 1024).toFixed(0)} KB`);
}
