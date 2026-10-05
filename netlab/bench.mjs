// The netcode benchmark: a fixed suite of recreated sessions from decent to awful connections, each run with the
// same seeds, summarized per tier. Every netcode change is judged on this suite against a saved baseline.
// Usage: node netlab/bench.mjs <label> [--quick] [--baseline netlab/bench/<file>.json] [--only scenario,...]
//   --quick: 1 seed per scenario instead of 2. Results: netlab/bench/<stamp>-<label>.json and .md
// Headline numbers per tier: freezes/min (WAITING stalls), frozen s/min, game speed (% of real time: freezes and
// slow-motion both lower it), plus what a fix could trade for them: input delay, rollbacks, deepest rollback,
// slow frames, errors (desyncs and crashes).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SUITE = [
  { scenario: "alpha-bravo", tier: "decent" },
  { scenario: "school-3p", tier: "decent" },
  { scenario: "evening-4p", tier: "decent" },
  { scenario: "ben-adrean-kirill", tier: "poor" },
  { scenario: "awful-3p", tier: "awful" },
];
const MINUTES = 3;

const argv = process.argv.slice(2);
const take = (flag) => { const i = argv.indexOf(flag); if (i < 0) return undefined; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const quick = argv.includes("--quick") && (argv.splice(argv.indexOf("--quick"), 1), true);
const baselineFile = take("--baseline");
const only = take("--only")?.split(",");
const [label] = argv;
if (!label || !/^[\w.-]+$/.test(label)) throw new Error("usage: node netlab/bench.mjs <label> [--quick] [--baseline file.json] [--only a,b]");
const seeds = quick ? [1] : [1, 2];
const suite = SUITE.filter((s) => !only || only.includes(s.scenario));

const mean = (xs) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
const runs = [];
let built = false;
for (const { scenario, tier } of suite) {
  for (const seed of seeds) {
    console.log(`[bench] ${scenario} seed ${seed}`);
    const out = execFileSync("node", [path.join(HERE, "run.mjs"), scenario, "--minutes", String(MINUTES), "--seed", String(seed), ...(built ? ["--no-build"] : [])], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 64 << 20 });
    built = true;
    const dir = out.trim().split("\n").at(-1);
    const report = JSON.parse(fs.readFileSync(path.join(dir, "report.json"), "utf8"));
    const m = report.lab[0];
    const p = m.players;
    runs.push({
      scenario, tier, seed, dir, commit: report.commit,
      freezesPerMin: m.waitsPerMin, frozenSPerMin: m.waitSPerMin, longestFreezeMs: m.longestWaitMs,
      speedPct: mean(p.map((r) => r.simRatePct)), inputDelay: Math.max(...p.map((r) => r.inputDelay ?? 0)),
      rollbacksPerMin: mean(p.map((r) => r.rollbacksPerMin)), maxRollback: Math.max(...p.map((r) => r.maxDepth ?? 0)),
      slowFramePct: mean(p.map((r) => r.slowFramePct)), errors: p.flatMap((r) => r.errors),
    });
  }
}

const METRICS = ["freezesPerMin", "frozenSPerMin", "longestFreezeMs", "speedPct", "inputDelay", "rollbacksPerMin", "maxRollback", "slowFramePct"];
const summarize = (rs) => Object.fromEntries([...METRICS.map((k) => [k, mean(rs.map((r) => r[k]))]), ["errors", rs.flatMap((r) => r.errors)]]);
const byScenario = Object.fromEntries(suite.map(({ scenario }) => [scenario, summarize(runs.filter((r) => r.scenario === scenario))]));
const byTier = Object.fromEntries([...new Set(suite.map((s) => s.tier))].map((t) => [t, summarize(runs.filter((r) => r.tier === t))]));
const result = { label, at: new Date().toISOString(), commit: runs[0]?.commit, seeds, minutes: MINUTES, byTier, byScenario, runs };

const baseline = baselineFile ? JSON.parse(fs.readFileSync(baselineFile, "utf8")) : null;
const ratio = (b, n) => (b == null || n == null ? "" : n === 0 ? (b === 0 ? " (=)" : " (∞× fewer)") : ` (${Math.round((b / n) * 10) / 10}× ${b >= n ? "fewer" : "MORE"})`);
const table = (title, rows, base) => {
  const out = [`## ${title}`, "", `| | freezes/min | frozen s/min | longest ms | speed % | input delay | rollbacks/min | max rollback | slow frames % | errors |`, "|---|---|---|---|---|---|---|---|---|---|"];
  for (const [name, s] of Object.entries(rows)) {
    const b = base?.[name];
    out.push(`| ${name} | ${s.freezesPerMin}${ratio(b?.freezesPerMin, s.freezesPerMin)} | ${s.frozenSPerMin}${ratio(b?.frozenSPerMin, s.frozenSPerMin)} | ${s.longestFreezeMs} | ${s.speedPct}${b ? ` (was ${b.speedPct})` : ""} | ${s.inputDelay}${b ? ` (was ${b.inputDelay})` : ""} | ${s.rollbacksPerMin} | ${s.maxRollback} | ${s.slowFramePct} | ${s.errors.length ? s.errors.join(", ") : "none"} |`);
  }
  return out.join("\n");
};
const md = [
  `# bench ${label} · ${result.commit} · ${seeds.length} seed(s) × ${MINUTES} min${baseline ? ` · vs ${baseline.label} (${baseline.commit})` : ""}`,
  "",
  table("by tier", byTier, baseline?.byTier),
  "",
  table("by scenario", byScenario, baseline?.byScenario),
  "",
  "Runs: " + runs.map((r) => `${r.scenario}#${r.seed} ${path.relative(HERE, r.dir)}`).join(", "),
].join("\n");
const dir = path.join(HERE, "bench");
fs.mkdirSync(dir, { recursive: true });
const base = path.join(dir, `${result.at.slice(0, 16).replace(/[:T]/g, "-")}-${label}`);
fs.writeFileSync(base + ".json", JSON.stringify(result, null, 1));
fs.writeFileSync(base + ".md", md + "\n");
console.log("\n" + md + `\n\n${base}.json`);
