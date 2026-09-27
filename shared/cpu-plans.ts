// What holding a special actually achieves, measured rather than read: each special that keeps going
// while held is run in a private match for a range of hold lengths, with idle dummies at 0% close in
// front, far in front and behind, and the KOs are counted. A special that looks like nothing (a
// stance, a meter that fills) but wipes the arena after four seconds shows up as exactly that. Pure
// function of the def, like the rest of the profile.
import { isActionable, startMove } from "./fighter";
import { B, EMPTY_INPUT, type InputFrame } from "./input";
import { profileOf, type SpecialId } from "./cpu-profile";
import { createMatch, step } from "./sim";
import type { FighterDef } from "./types";

export type Spot = "near" | "far" | "behind";
/** Holding `move` for `hold` frames from the ground: which dummies (all at 0%) it KO'd, and how long it keeps the fighter busy. */
export interface Plan { move: SpecialId; hold: number; kos: Spot[]; frames: number }

const HOLDS = [20, 60, 120, 240, 360];
const SPOTS: [Spot, number][] = [["near", 120], ["far", 420], ["behind", -420]];
/** After letting go: long enough for a launched dummy to reach a blast line. */
const AFTER = 180;
const STUDIED = ["nspecial", "sspecial", "dspecial"] as const;

const plans = new WeakMap<FighterDef, Plan[]>();

/** Every hold of a held special that KO'd at least one dummy, shortest hold first per move. */
export function plansOf(def: FighterDef): Plan[] {
  let p = plans.get(def);
  if (!p) {
    p = [];
    const specials = profileOf(def).specials;
    for (const s of STUDIED) {
      if (!specials[s]?.held) continue;
      for (const hold of HOLDS) {
        const plan = runPlan(def, s, hold);
        if (plan.kos.length) { p.push(plan); break; }
      }
    }
    plans.set(def, p);
  }
  return p;
}

function runPlan(def: FighterDef, move: SpecialId, hold: number): Plan {
  const s = createMatch({ stage: "proving", players: [def.id, def.id, def.id, def.id].map((fighter) => ({ fighter })), rules: { stocks: 9, time: 0 }, seed: 1 });
  const f = s.fighters[0];
  f.x = 0; f.facing = 1; f.moveFacing = 1;
  SPOTS.forEach(([, x], i) => { const d = s.fighters[i + 1]; d.x = x; d.facing = x > 0 ? -1 : 1; });
  const stick: InputFrame = { ...EMPTY_INPUT, x: move === "sspecial" ? 100 : 0, y: move === "dspecial" ? 100 : 0 };
  const held = { ...stick, b: B.SPECIAL };
  s.inputs[0] = { ...held };
  startMove(s, f, move);
  const kos = new Set<Spot>();
  let frames = hold + AFTER;
  for (let i = 0; i < hold + AFTER; i++) {
    step(s, [i < hold ? held : EMPTY_INPUT, EMPTY_INPUT, EMPTY_INPUT, EMPTY_INPUT]);
    for (const e of s.events) if (e.t === "ko" && e.slot > 0) kos.add(SPOTS[e.slot - 1][0]);
    s.events.length = 0;
    if (i > hold && frames === hold + AFTER && isActionable(f)) frames = i;
  }
  return { move, hold, kos: [...kos], frames };
}
