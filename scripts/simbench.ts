// Sim cost per frame: step, cloneState, hashState and CPU input, over a 4-player CPU match on the house roster.
// Usage: tsx scripts/simbench.ts [frames=3600] [stage=rooftops]
import { cloneState, createMatch, hashState, step } from "../shared/sim";
import { cpuInput } from "../shared/cpu";
import { rosterList } from "../shared/fighters/index";
import { loadAllHouse } from "../test/house";

await loadAllHouse();
const FRAMES = Number(process.argv[2] ?? 3600), STAGE = process.argv[3] ?? "rooftops";
const ids = rosterList.map((d) => d.id);
const s = createMatch({ stage: STAGE, players: [0, 1, 2, 3].map((i) => ({ fighter: ids[i % ids.length], cpu: 9 })), seed: 12345 });
const t = { cpu: 0, step: 0, clone: 0, hash: 0 };
for (let f = 0; f < FRAMES && !s.ended; f++) {
  let a = performance.now();
  const inputs = s.fighters.map((_, i) => cpuInput(s, i, 9));
  let b = performance.now(); t.cpu += b - a; a = b;
  step(s, inputs); s.events.length = 0;
  b = performance.now(); t.step += b - a; a = b;
  cloneState(s);
  b = performance.now(); t.clone += b - a; a = b;
  if (f % 30 === 0) hashState(s);
  b = performance.now(); t.hash += b - a;
}
const n = s.frame;
console.log(`${n} frames, ${ids.length} fighters in roster, per frame (µs): cpu ${(t.cpu / n * 1000).toFixed(1)} step ${(t.step / n * 1000).toFixed(1)} clone ${(t.clone / n * 1000).toFixed(1)} hash/30f ${(t.hash / n * 1000 * 30).toFixed(1)}`);
console.log(`state JSON size ${JSON.stringify(s).length} bytes`);
