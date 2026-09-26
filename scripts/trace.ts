import { createMatch, step } from "../shared/sim";
import { EMPTY_INPUT } from "../shared/input";
import { roster } from "../shared/fighters/index";
import { hitOf } from "../shared/hits";
import { houseId, loadAllHouse } from "../test/house";

await loadAllHouse();
const [att, mv, pct] = [houseId(process.argv[2] ?? "lampjack"), process.argv[3] ?? "fsmash", Number(process.argv[4] ?? 65)];
const s = createMatch({ stage: "proving", players: [{ fighter: att }, { fighter: "lampjack" }], seed: 1 });
const a = s.fighters[0], v = s.fighters[1];
a.x = -60; v.x = 0; v.facing = -1; a.facing = 1; a.moveFacing = 1; v.percent = pct;
const m = roster[att].moves[mv];
const hb = m.hitboxes.find((h) => h.priority === 0) ?? m.hitboxes[0];
a.action = "attack"; a.move = mv; a.frame = hb.frames[0]; a.moveInstance = 1; a.chargeMul = 1;
hitOf(s, a, v, hb, 0, -60, !!m.throwFrame);
a.action = "idle"; a.move = null;
console.log("pending", v.pending, "hitlag", v.hitlag);
for (let i = 1; i <= 200; i++) {
  step(s, [EMPTY_INPUT, EMPTY_INPUT]);
  const ko = s.events.find((e) => e.t === "ko");
  if (ko) { console.log("KO at frame", i, (ko as any).side); break; }
  s.events.length = 0;
  if (i % 10 === 0 || i < 4) console.log(i, v.action, `x=${v.x.toFixed(0)} y=${v.y.toFixed(0)} vx=${v.vx.toFixed(2)} vy=${v.vy.toFixed(2)} hitstun=${v.hitstun} f=${v.frame}`);
}
