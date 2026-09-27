// The title screen's brawl (shared/brawl.ts), run headless at full speed with every house fighter and
// everyone's characters from the live site, all loaded up front. Prints kills, deaths, time survived and
// damage per life for each character.
// Usage: tsx scripts/brawl-bench.ts [sim minutes per brawl=120] [brawls in parallel=8] [site=https://bschoolland.dev]
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Brawl } from "../shared/brawl";
import { C } from "../shared/config";
import { registerFighter } from "../shared/fighters/index";
import { buildGenerated, type GeneratedBundle } from "../shared/gen/load";
import { HOUSE_ROSTER } from "../shared/house";
import { loadHouse } from "../test/house";

interface Row { kills: number; deaths: number; survivedSec: number; dealt: number; drops: number }
type Totals = Record<string, Row>;

const MINUTES = Number(process.argv[2] ?? 120), PARALLEL = Number(process.argv[3] ?? 8), SITE = process.argv[4] ?? "https://bschoolland.dev";
const worker = process.env.BRAWL_SEED !== undefined;

async function loadEveryone(): Promise<Record<string, string>> {
  const names: Record<string, string> = {};
  for (const h of HOUSE_ROSTER) { await loadHouse(h.id); names[h.id] = h.name; }
  const res = await fetch(`${SITE}/sketch-battle/api/characters/everyone`);
  if (!res.ok) throw new Error(`everyone's characters: HTTP ${res.status}`);
  const { characters } = (await res.json()) as { characters: { id: string; name: string; bundleUrl: string }[] };
  for (const c of characters) {
    if (names[c.id]) continue;
    const b = await fetch(`${SITE}${c.bundleUrl}`);
    if (!b.ok) throw new Error(`${c.name} (${c.id}) bundle: HTTP ${b.status}`);
    registerFighter(await buildGenerated((await b.json()) as GeneratedBundle));
    names[c.id] = c.name;
  }
  return names;
}

function run(ids: string[], seed: number): Totals {
  const totals: Totals = {};
  const row = (id: string): Row => totals[id] ??= { kills: 0, deaths: 0, survivedSec: 0, dealt: 0, drops: 0 };
  const brawl = new Brawl(() => ids, seed);
  const seen = new Set<object>();
  for (let frame = 0; frame < MINUTES * 60 * C.FPS; frame++) {
    const { kos } = brawl.step();
    for (const f of brawl.state?.fighters ?? []) if (!seen.has(f)) { seen.add(f); row(f.id).drops++; }
    for (const k of kos) {
      const v = row(k.victim);
      v.deaths++; v.survivedSec += k.survivedSec; v.dealt += k.dealt;
      if (k.killer) row(k.killer).kills++;
    }
  }
  return totals;
}

if (worker) {
  const names = await loadEveryone();
  process.send!(run(Object.keys(names), Number(process.env.BRAWL_SEED)));
  process.exit(0);
}

const names = await loadEveryone();
const t0 = performance.now();
const parts = await Promise.all(Array.from({ length: PARALLEL }, (_, i) => new Promise<Totals>((resolve, reject) => {
  const child = fork(fileURLToPath(import.meta.url), process.argv.slice(2), { env: { ...process.env, BRAWL_SEED: String(0x5eed + i * 7919) }, execArgv: process.execArgv });
  child.once("message", (m) => resolve(m as Totals));
  child.once("exit", (code) => { if (code) reject(new Error(`brawl ${i} exited ${code}`)); });
})));
const all: Totals = {};
for (const p of parts) for (const [id, r] of Object.entries(p)) {
  const a = all[id] ??= { kills: 0, deaths: 0, survivedSec: 0, dealt: 0, drops: 0 };
  a.kills += r.kills; a.deaths += r.deaths; a.survivedSec += r.survivedSec; a.dealt += r.dealt; a.drops += r.drops;
}
const rows = Object.entries(all).map(([id, r]) => ({ name: names[id] ?? id, ...r, kdr: r.kills / Math.max(1, r.deaths) })).sort((a, b) => b.kdr - a.kdr);
const deaths = rows.reduce((n, r) => n + r.deaths, 0);
console.log(`${PARALLEL} brawls × ${MINUTES} sim minutes, ${rows.length} characters, ${deaths} deaths, ${((performance.now() - t0) / 1000).toFixed(0)}s wall`);
console.log("name                       drops  kills deaths   KDR  avg life  dmg/life");
for (const r of rows) {
  const per = (n: number) => (r.deaths ? n / r.deaths : 0);
  console.log(`${r.name.padEnd(26)} ${String(r.drops).padStart(5)} ${String(r.kills).padStart(6)} ${String(r.deaths).padStart(6)} ${r.kdr.toFixed(2).padStart(5)} ${per(r.survivedSec).toFixed(0).padStart(8)}s ${per(r.dealt).toFixed(0).padStart(8)}%`);
}
