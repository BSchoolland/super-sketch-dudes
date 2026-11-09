// Whether two versions of a fighter play the same game: a restyle may redraw a fighter, never change how it plays.
// Both are built from source and played frame for frame from the same start, the state hashed every frame:
// a 4-player CPU match, then every move started from standing (and in the air for aerials) against a dummy.
// Anything a draw can't touch (stats, hitboxes, hooks, bars) shows up as a hash that parts ways.
import { createMatch, step, hashState } from "../shared/sim";
import { cpuInput } from "../shared/cpu";
import { startMove, setAction } from "../shared/fighter";
import { registerFighter } from "../shared/fighters/index";
import { studyFighter } from "../shared/cpu-study";
import { buildGenerated, type GeneratedBundle } from "../shared/gen/load";
import { EMPTY_INPUT } from "../shared/input";
import { HOUSE_ROSTER, type HouseId } from "../shared/house";
import { loadHouse } from "../test/house";
import type { FighterDef, State } from "../shared/types";

const ID = "restyle-candidate";
const LEVEL = 5, MATCH_FRAMES = 3600;

type Trace = { label: string; hashes: number[] };

async function build(bundle: GeneratedBundle, cpu: GeneratedBundle["cpu"]): Promise<FighterDef> {
  const def = await buildGenerated({ ...bundle, id: ID, cpu });
  registerFighter(def);
  return def;
}

function traces(def: FighterDef, opponents: HouseId[]): Trace[] {
  const out: Trace[] = [];
  const match = createMatch({ stage: "proving", players: [{ fighter: ID, cpu: LEVEL }, ...opponents.slice(0, 3).map((h) => ({ fighter: h, cpu: LEVEL }))], seed: 11 });
  const hashes: number[] = [];
  for (let i = 0; i < MATCH_FRAMES && !match.ended; i++) {
    step(match, match.fighters.map((f) => cpuInput(match, f.slot, LEVEL)));
    match.events.length = 0;
    hashes.push(hashState(match));
  }
  out.push({ label: "the CPU match", hashes });
  for (const [id, mv] of Object.entries(def.moves)) {
    if (mv.throwFrame) continue;
    for (const air of mv.aerial ? [true] : [false]) {
      const s: State = createMatch({ stage: "proving", players: [{ fighter: ID }, { fighter: opponents[0] }], seed: 3 });
      const [f, dummy] = s.fighters;
      f.x = dummy.x - 90; f.facing = 1;
      if (air) { f.y -= 160; f.grounded = false; f.platform = -1; setAction(f, "air"); }
      startMove(s, f, id);
      const h: number[] = [];
      for (let k = 0; k < mv.total + 40; k++) { step(s, [EMPTY_INPUT, EMPTY_INPUT]); s.events.length = 0; h.push(hashState(s)); }
      out.push({ label: `${id}${air ? " (in the air)" : ""}`, hashes: h });
    }
  }
  return out;
}

/** Empty when the two play identically; otherwise one line per place they part ways. */
export async function sameGame(before: GeneratedBundle, after: GeneratedBundle): Promise<string[]> {
  const opponents = HOUSE_ROSTER.map((h) => h.id).filter((h) => h !== before.id) as HouseId[];
  for (const h of opponents) await loadHouse(h);
  const a = await build(before, before.cpu);
  // one CPU study for both, made from the original, so the CPU plays them the same way
  const cpu = before.cpu ?? studyFighter(a);
  const ta = traces(await build(before, cpu), opponents);
  const b = await build(after, cpu);
  const problems: string[] = [];
  const movesA = Object.keys(a.moves).sort().join(","), movesB = Object.keys(b.moves).sort().join(",");
  if (movesA !== movesB) problems.push(`the moves changed: before ${movesA}; after ${movesB}`);
  if (JSON.stringify(a.stats) !== JSON.stringify(b.stats)) problems.push("the stats changed");
  const tb = traces(b, opponents);
  for (const x of ta) {
    const y = tb.find((t) => t.label === x.label);
    if (!y) { problems.push(`${x.label}: missing after the restyle`); continue; }
    const n = Math.max(x.hashes.length, y.hashes.length);
    for (let i = 0; i < n; i++) if (x.hashes[i] !== y.hashes[i]) { problems.push(`${x.label}: plays differently from frame ${i + 1}`); break; }
  }
  return problems;
}
