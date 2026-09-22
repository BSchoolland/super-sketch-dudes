import { createMatch, step } from "../shared/sim";
import { cpuInput } from "../shared/cpu";
const s = createMatch({ stage: "proving", players: [{ fighter: "sable" }, { fighter: "sable" }], seed: 3 });
for (let i = 0; i < 60 * 12; i++) {
  step(s, [cpuInput(s, 0, 9), cpuInput(s, 1, 9)]);
  s.events.length = 0;
  if (i > 540 && i % 20 === 0) console.log(i, s.fighters.map(f => `${f.action}/${f.move}#${f.frame} hl${f.hitlag} x${f.x.toFixed(0)} ch${f.charge} sp${JSON.stringify(f.special)} ${f.percent}%`).join(" | "));
}
