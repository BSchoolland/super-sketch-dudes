// Per-move hit statistics for a CPU match. Usage: tsx scripts/hitstats.ts tank dizzy [tier=5] [stage=proving] [matches=3]
import { createMatch, step } from "../shared/sim";
import { cpuInput } from "../shared/cpu";
import { houseId, loadAllHouse } from "../test/house";

await loadAllHouse();
const [a, b] = [houseId(process.argv[2] ?? "tank"), houseId(process.argv[3] ?? "dizzy")];
const level = Number(process.argv[4] ?? 5), stage = process.argv[5] ?? "proving", N = Number(process.argv[6] ?? 3);
const stats: Record<string, { hits: number; dmg: number; kos: number }>[] = [{}, {}];
const moves: Record<string, string>[] = [{}, {}];
let frames = 0, wins = [0, 0];
const shield: number[] = [0, 0], whiffs: number[] = [0, 0], grabs = [0, 0];
for (let m = 0; m < N; m++) {
  const s = createMatch({ stage, players: [{ fighter: a, cpu: level }, { fighter: b, cpu: level }], seed: 77 + m });
  const lastHit: number[] = [-1, -1];
  while (!s.ended && frames < 60 * 300 * N) {
    step(s, [cpuInput(s, 0, level), cpuInput(s, 1, level)]);
    frames++;
    for (const e of s.events) {
      if (e.t === "move") moves[e.slot][e.move] = (moves[e.slot][e.move] ?? "") + "";
      if (e.t === "move" && !/throw|pummel/.test(e.move)) whiffs[e.slot]++;
      if (e.t === "hit" && e.victim >= 0) {
        const f = s.fighters[e.attacker];
        const key = f.move ?? (s.projectiles.length ? "projectile" : "?");
        const st = stats[e.attacker][key] ?? (stats[e.attacker][key] = { hits: 0, dmg: 0, kos: 0 });
        st.hits++; st.dmg += e.damage; whiffs[e.attacker]--; lastHit[e.victim] = e.attacker;
      }
      if (e.t === "shieldHit") shield[e.victim]++;
      if (e.t === "grab") grabs[e.attacker]++;
      if (e.t === "ko" && e.by >= 0) { const f = s.fighters[e.by]; const key = f.move ?? "?"; const st = stats[e.by][key] ?? (stats[e.by][key] = { hits: 0, dmg: 0, kos: 0 }); st.kos++; }
    }
    s.events.length = 0;
  }
  if (s.winner >= 0) wins[s.winner]++;
}
for (const i of [0, 1]) {
  const id = i === 0 ? a : b;
  const rows = Object.entries(stats[i]).sort((x, y) => y[1].dmg - x[1].dmg);
  const total = rows.reduce((t, r) => t + r[1].dmg, 0);
  console.log(`\n${id}: wins ${wins[i]}/${N}, total dealt ${total.toFixed(0)}% (${(total / N).toFixed(0)}/match), moves started ${Object.keys(moves[i]).length} kinds, whiffs ${whiffs[i]}, shielded-by-opponent ${shield[1 - i]}, grabs ${grabs[i]}`);
  for (const [mv, st] of rows.slice(0, 10)) console.log(`  ${mv.padEnd(12)} hits ${String(st.hits).padStart(4)}  dmg ${st.dmg.toFixed(0).padStart(5)}  kos ${st.kos}`);
}
