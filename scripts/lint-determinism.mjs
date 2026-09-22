// Fails when shared/ uses anything whose result can differ between JS engines or runs.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
const BAD = [/Math\.(sin|cos|tan|atan2|atan|asin|acos|pow|exp|log|log2|log10|random|hypot|cbrt|sinh|cosh|tanh)\b/, /\bDate\b/, /performance\.now/, /structuredClone/, /Number\.parseFloat\(|parseFloat\(/, /toFixed\(/];
let bad = 0;
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (!p.endsWith(".ts")) continue;
    const src = readFileSync(p, "utf8").split("\n");
    src.forEach((line, i) => {
      if (line.includes("// determinism-ok")) return;
      for (const re of BAD) if (re.test(line)) { console.error(`${p}:${i + 1}: ${line.trim()}`); bad++; }
    });
  }
}
walk(new URL("../shared", import.meta.url).pathname);
if (bad) { console.error(`${bad} non-deterministic use(s) in shared/`); process.exit(1); }
console.log("shared/ is deterministic-safe");
