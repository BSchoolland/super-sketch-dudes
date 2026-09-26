// Kill-percent calibration: for each fighter's key moves, the lowest percent at which the victim
// (a house fighter, no DI) dies from centre stage and from near the ledge on Proving Ground.
// Usage: tsx scripts/killpercents.ts [victim=lampjack]
import { createMatch, step } from "../shared/sim";
import { EMPTY_INPUT } from "../shared/input";
import { rosterList, roster } from "../shared/fighters/index";
import { hitOf } from "../shared/hits";
import { houseId, loadAllHouse } from "../test/house";

await loadAllHouse();
const victimId = houseId(process.argv[2] ?? "lampjack");
const MOVES = ["ftilt", "fsmash", "usmash", "bair", "fair", "uair", "dsmash", "nspecial", "bthrow", "uthrow"];

function dies(attackerId: string, moveId: string, percent: number, x: number, tipper: boolean): boolean {
  const s = createMatch({ stage: "proving", players: [{ fighter: attackerId }, { fighter: victimId }], seed: 1 });
  const a = s.fighters[0], v = s.fighters[1];
  a.x = x - 60; v.x = x; v.facing = -1; a.facing = 1; a.moveFacing = 1;
  v.percent = percent;
  const mv = roster[attackerId].moves[moveId];
  const hbs = mv.hitboxes.filter((h) => !h.grab);
  const hb = tipper ? hbs.find((h) => h.priority === 0) ?? hbs[0] : hbs.find((h) => (h.priority ?? 1) !== 0) ?? hbs[0];
  if (!hb) return false;
  a.action = "attack"; a.move = moveId; a.frame = hb.frames[0]; a.moveInstance = 1;
  a.chargeMul = 1;
  hitOf(s, a, v, hb, v.x, v.y - 60, !!mv.throwFrame);
  a.action = "idle"; a.move = null; // one hit only: the rest of the active window must not connect again
  // only side/top blast-zone deaths count: falling to the bottom is the dummy not recovering, not knockback
  for (let i = 0; i < 600; i++) {
    step(s, [EMPTY_INPUT, EMPTY_INPUT]);
    for (const e of s.events) if (e.t === "ko" && e.slot === 1) return e.side !== "bottom";
    s.events.length = 0;
    if (v.stocks < 3) return false;
  }
  return false;
}
function killPercent(attackerId: string, moveId: string, x: number, tipper: boolean): number | null {
  for (let p = 0; p <= 300; p += 5) if (dies(attackerId, moveId, p, x, tipper)) return p;
  return null;
}
const pad = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n);
console.log(`kill percents vs ${victimId} (weight ${roster[victimId].stats.weight}, no DI), centre / near ledge (x=450). "-" = no kill under 300%`);
for (const def of rosterList) {
  const row = MOVES.map((m) => {
    if (!def.moves[m]) return pad("", 12);
    const hasTip = def.moves[m].hitboxes.some((h) => h.priority === 0) && def.moves[m].hitboxes.some((h) => (h.priority ?? 1) !== 0);
    const c = killPercent(def.id, m, 0, true), l = killPercent(def.id, m, 450, true);
    const cs = c === null ? "-" : `${c}`, ls = l === null ? "-" : `${l}`;
    return pad(`${cs}/${ls}${hasTip ? "*" : ""}`, 12);
  }).join("");
  console.log(pad(def.id, 11) + row);
}
console.log(pad("", 11) + MOVES.map((m) => pad(m, 12)).join(""));
console.log("* = tipper/sweetspot used");
