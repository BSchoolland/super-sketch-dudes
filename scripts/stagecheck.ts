// CPU matches on each stage: how long they last and how many KOs were self-destructs (nobody's hit behind them),
// the sign of a stage the CPUs can't get around. Usage: tsx scripts/stagecheck.ts [matches=12] [tier=5] [players=2] [stages=all]
import { createMatch, step } from "../shared/sim";
import { cpuInput } from "../shared/cpu";
import { rosterList } from "../shared/fighters/index";
import { stageList } from "../shared/stages/index";
import { loadAllHouse } from "../test/house";

await loadAllHouse();
const N = Number(process.argv[2] ?? 12), LEVEL = Number(process.argv[3] ?? 5), PLAYERS = Number(process.argv[4] ?? 2);
const only = process.argv[5]?.split(",");
const ids = rosterList.map((d) => d.id);
for (const stage of stageList.filter((s) => !only || only.includes(s.id))) {
  let frames = 0, kos = 0, sds = 0, timeouts = 0;
  const sides = { left: 0, right: 0, top: 0, bottom: 0 };
  for (let m = 0; m < N; m++) {
    const players = Array.from({ length: PLAYERS }, (_, i) => ({ fighter: ids[(m + i * 3) % ids.length], cpu: LEVEL }));
    const s = createMatch({ stage: stage.id, players, seed: 4000 + m * 7919 });
    let f = 0;
    while (!s.ended && f < 60 * 300) {
      step(s, players.map((_, i) => cpuInput(s, i, LEVEL)));
      for (const e of s.events) if (e.t === "ko") { kos++; sides[e.side]++; if (e.by < 0 || e.by === e.slot) sds++; }
      s.events.length = 0;
      f++;
    }
    frames += f;
    if (!s.ended) timeouts++;
  }
  console.log(`${stage.id.padEnd(11)} avg ${(frames / N / 60).toFixed(0)}s  KOs ${kos}  self-destructs ${sds} (${((sds / Math.max(1, kos)) * 100).toFixed(0)}%)  ${Object.entries(sides).map(([k, v]) => `${k} ${v}`).join(" ")}${timeouts ? `  ${timeouts} timed out` : ""}`);
}
