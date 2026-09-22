import { createMatch, step } from "../shared/sim";
import { cpuInput } from "../shared/cpu";
const s = createMatch({ stage: "proving", players: [{ fighter: "sable" }, { fighter: "sable" }], seed: 3 });
const actions: Record<string, number> = {};
let hits = 0, kos = 0;
for (let i = 0; i < 60 * 120; i++) {
  step(s, [cpuInput(s, 0, 9), cpuInput(s, 1, 9)]);
  for (const e of s.events) { if (e.t === "hit") hits++; if (e.t === "ko") kos++; }
  s.events.length = 0;
  for (const f of s.fighters) actions[f.action] = (actions[f.action] ?? 0) + 1;
  if (i % 600 === 0) console.log(`t=${i/60}s`, s.fighters.map(f => `${f.action}@${f.x.toFixed(0)},${f.y.toFixed(0)} ${f.percent}% s${f.stocks}`).join(" | "));
  if (s.ended) { console.log("ended at", i / 60, "s"); break; }
}
console.log({ hits, kos });
console.log(Object.entries(actions).sort((a, b) => b[1] - a[1]).slice(0, 12));
