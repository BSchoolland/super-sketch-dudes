// CPU-vs-CPU ladder: every fighter against every fighter, prints a win-rate matrix and match stats.
// Usage: tsx scripts/ladder.ts [matches per pair=4] [level=9] [stage=proving]   (the house roster)
import { createMatch, step } from "../shared/sim";
import { cpuInput } from "../shared/cpu";
import { rosterList } from "../shared/fighters/index";
import { loadAllHouse } from "../test/house";

await loadAllHouse();

const N = Number(process.argv[2] ?? 4), LEVEL = Number(process.argv[3] ?? 9), STAGE = process.argv[4] ?? "proving";
const ids = rosterList.map((d) => d.id);
const wins: Record<string, Record<string, number>> = {};
let totalFrames = 0, matches = 0, warn = 0;
const dealt: Record<string, number> = {};
for (const a of ids) { wins[a] = {}; for (const b of ids) wins[a][b] = 0; }
for (const a of ids) for (const b of ids) {
  if (a >= b) continue;
  for (let m = 0; m < N; m++) {
    const flip = m % 2 === 1;
    const s = createMatch({ stage: STAGE, players: [{ fighter: flip ? b : a, cpu: LEVEL }, { fighter: flip ? a : b, cpu: LEVEL }], seed: 1000 + m * 7919 + a.length * 31 + b.length }, );
    let frames = 0;
    while (!s.ended && frames < 60 * 300) { step(s, [cpuInput(s, 0, LEVEL), cpuInput(s, 1, LEVEL)]); s.events.length = 0; frames++; }
    const w = s.winner;
    const winner = w < 0 ? null : s.fighters[w].id;
    if (winner) wins[winner][winner === a ? b : a]++;
    for (const f of s.fighters) dealt[f.id] = (dealt[f.id] ?? 0) + f.dealt;
    totalFrames += frames; matches++;
    if (!s.ended) warn++;
  }
}
const pad = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n);
console.log(`ladder: ${N} matches per pair, CPU ${LEVEL}, stage ${STAGE}. avg match ${(totalFrames / matches / 60).toFixed(0)}s${warn ? `, ${warn} timed out` : ""}`);
console.log(pad("", 11) + ids.map((i) => pad(i, 11)).join(""));
for (const a of ids) {
  console.log(pad(a, 11) + ids.map((b) => (a === b ? pad("-", 11) : pad(`${wins[a][b]}-${wins[b][a]}`, 11))).join("") + `  dealt/match ${((dealt[a] ?? 0) / (N * (ids.length - 1))).toFixed(0)}%`);
}
let worst = 0;
for (const a of ids) for (const b of ids) if (a < b) { const t = wins[a][b] + wins[b][a]; if (t) worst = Math.max(worst, Math.abs(wins[a][b] / t - 0.5)); }
console.log(`worst matchup skew: ${(50 + worst * 100).toFixed(0)}/${(50 - worst * 100).toFixed(0)}`);
