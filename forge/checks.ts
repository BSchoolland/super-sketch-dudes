// The forge's headless gate, run by forge/tools/check.ts and deploy.ts.
import { createMatch, step, cloneState, hashState } from "../shared/sim";
import { cpuInput } from "../shared/cpu";
import { hitOf } from "../shared/hits";
import { B, EMPTY_INPUT } from "../shared/input";
import { startMove } from "../shared/fighter";
import { registerFighter, roster } from "../shared/fighters/index";
import { studyFighter } from "../shared/cpu-study";
import { buildGenerated, lintGeneratedSource, validateGenerated, type GeneratedBundle } from "../shared/gen/load";
import type { FighterDef, State } from "../shared/types";
import type { HouseId } from "../shared/house";
import { loadHouse } from "../test/house";

export interface Failure { kind: "hard" | "hook"; msg: string }
export interface CheckInput { bundle: GeneratedBundle; height: number }
export interface CheckReport {
  ok: boolean;
  failures: Failure[];
  soft: string[];
  ladder: Record<string, { wins: number; losses: number; avgSeconds: number; dealtPerMatch: number }>;
  recovery: number | null;
  killPercents: Record<string, number | null>;
  movesUsed: string[];
  timings: Record<string, number>;
}

/** The balance ladder, from the house roster: an all-rounder, a heavy, a swordsman and a fire-throwing caster. */
export const LADDER: readonly HouseId[] = ["woodstove", "slugbert", "rocket", "wizard"];
/** The punching bag for the move, recovery and KO checks. */
const DUMMY: HouseId = "woodstove";
const LADDER_MATCHES = 2, LEVEL = 5, CAP_FRAMES = 60 * 180, SOFT_SECONDS = 25;
const KO_MOVES = ["ftilt", "fsmash", "usmash", "dsmash", "fair", "bair", "uair", "dair", "nair", "nspecial", "sspecial", "dspecial"];

class HookLog {
  byMove = new Map<string, { error: string; n: number }>();
  collect(s: State, slots: (slot: number) => boolean): void {
    for (const e of s.events) if (e.t === "hookError" && slots(e.slot)) {
      const cur = this.byMove.get(e.move);
      if (cur) cur.n++; else this.byMove.set(e.move, { error: e.error, n: 1 });
    }
  }
}

export async function runChecks(input: CheckInput): Promise<CheckReport> {
  const { bundle, height } = input;
  const id = bundle.id;
  const r: CheckReport = { ok: false, failures: [], soft: [], ladder: {}, recovery: null, killPercents: {}, movesUsed: [], timings: {} };
  const hard = (msg: string) => r.failures.push({ kind: "hard", msg });
  const timed = async (name: string, fn: () => unknown) => { const t0 = Date.now(); await fn(); r.timings[name] = Date.now() - t0; };

  for (const l of lintGeneratedSource(bundle.source)) hard(`lint: ${l}`);
  if (r.failures.length) return r;
  const house = new Set<HouseId>([...LADDER, DUMMY]);
  if (house.has(id as HouseId)) throw new Error(`the candidate's id ${id} would replace the house fighter it is checked against`);
  for (const h of house) await loadHouse(h);
  // hooks that throw get disabled on the def they ran on, so every check gets a fresh build
  const fresh = async (): Promise<FighterDef> => { const d = await buildGenerated(bundle); registerFighter(d); return d; };
  let def: FighterDef;
  try { def = await fresh(); } catch (e) {
    for (const l of String((e as Error).message).split("\n").filter(Boolean)) hard(`build: ${l}`);
    return r;
  }
  for (const l of validateGenerated(def, { strict: true })) hard(`build: ${l}`);
  if (def.stats.height !== height) hard(`stats.height is ${def.stats.height} but the cell boxes were converted at ${height}; set stats.height = ${height} so the drawing and the hitboxes line up`);
  if (!def.moves.uspecial.helpless || !def.moves.uspecial.ledgeOk) hard("uspecial must have helpless: true and ledgeOk: true");

  const hooks = new HookLog();
  const used = new Set<string>();
  const guard = (what: string, fn: () => void): boolean => {
    try { fn(); return true; } catch (e) { hard(`${what} threw: ${(e as Error).message}`); return false; }
  };
  // the CPU's study of it ships in the bundle; every check below plays against a CPU that reads it
  await timed("study", () => { guard("the CPU study", () => { bundle.cpu = studyFighter(def); }); });
  if (!bundle.cpu) return r;

  await timed("determinism", async () => {
    await fresh();
    const cfg = { stage: "proving", players: [{ fighter: id, cpu: LEVEL }, ...LADDER.slice(0, 3).map((h) => ({ fighter: h, cpu: LEVEL }))], seed: 7 };
    guard("the 4-player determinism match", () => {
      const a = createMatch(cfg);
      let snap: State | null = null;
      const inputsAt: ReturnType<typeof cpuInput>[][] = [];
      for (let i = 0; i < 2400; i++) {
        const inputs = a.fighters.map((f) => cpuInput(a, f.slot, LEVEL));
        inputsAt.push(inputs);
        step(a, inputs);
        hooks.collect(a, (s) => s === 0);
        for (const e of a.events) if (e.t === "move" && e.slot === 0) used.add(e.move);
        a.events.length = 0;
        if (i === 1200) snap = cloneState(a);
      }
      // a throwing hook is disabled mid-run, so the resim can't match; the hook failure is reported instead
      if (hooks.byMove.size) return;
      const b = snap!;
      for (let i = 1201; i < 2400; i++) { step(b, inputsAt[i]); b.events.length = 0; }
      if (hashState(b) !== hashState(a)) hard("determinism: resimulating from a frame-1200 snapshot gave a different state. Keep ALL mutable state in f.special (every key present in special() from the start, numbers only) or on the fighter's own fields; never in closure variables, module-level objects or the moves/def objects");
    });
  });

  // what every bar did over the ladder and the move sweep: a bar that never moves is a mechanic that never ran
  const seen: Record<string, { lo: number; hi: number; tripped: boolean }> = {};
  for (const k in def.bars) seen[k] = { lo: Infinity, hi: -Infinity, tripped: false };
  const watch = (f: { bars: Record<string, number>; tripped: Record<string, number> }) => {
    for (const k in seen) { const v = f.bars[k], b = seen[k]; b.lo = Math.min(b.lo, v); b.hi = Math.max(b.hi, v); if (f.tripped[k]) b.tripped = true; }
  };

  await timed("ladder", async () => {
    let dealt = 0;
    for (const opp of LADDER) {
      const row = { wins: 0, losses: 0, avgSeconds: 0, dealtPerMatch: 0 };
      let frames = 0;
      for (let m = 0; m < LADDER_MATCHES; m++) {
        await fresh();
        const flip = m % 2 === 1;
        const me = flip ? 1 : 0;
        guard(`ladder match vs ${opp}`, () => {
          const s = createMatch({ stage: "proving", players: flip ? [{ fighter: opp, cpu: LEVEL }, { fighter: id, cpu: LEVEL }] : [{ fighter: id, cpu: LEVEL }, { fighter: opp, cpu: LEVEL }], seed: 1000 + m * 7919 + opp.length * 31 });
          let n = 0;
          while (!s.ended && n < CAP_FRAMES) {
            step(s, [cpuInput(s, 0, LEVEL), cpuInput(s, 1, LEVEL)]);
            hooks.collect(s, (slot) => slot === me);
            watch(s.fighters[me]);
            for (const e of s.events) if (e.t === "move" && e.slot === me) used.add(e.move);
            s.events.length = 0; n++;
          }
          if (s.winner === me) row.wins++; else if (s.winner >= 0) row.losses++;
          row.dealtPerMatch += s.fighters[me].dealt;
          dealt += s.fighters[me].dealt;
          frames += n;
        });
      }
      row.avgSeconds = Math.round(frames / LADDER_MATCHES / 60);
      row.dealtPerMatch = Math.round(row.dealtPerMatch / LADDER_MATCHES);
      r.ladder[opp] = row;
    }
    if (dealt === 0) hard(`ladder: dealt 0% in ${LADDER.length * LADDER_MATCHES} UNFAIR CPU matches. The CPU can't land anything: check hitbox positions (x forward, y negative is UP), active frames inside total, and that jab1/ftilt/fsmash have hitboxes near the body (x 20-120, y -20..-${height})`);
    const all = Object.values(r.ladder);
    const w = all.reduce((a, x) => a + x.wins, 0), total = LADDER.length * LADDER_MATCHES;
    const secs = all.reduce((a, x) => a + x.avgSeconds, 0) / all.length;
    if (w === total && secs < SOFT_SECONDS) r.soft.push(`wins every ladder match in ${secs.toFixed(0)}s on average: probably overtuned`);
    if (w === 0 && secs < SOFT_SECONDS) r.soft.push(`loses every ladder match in ${secs.toFixed(0)}s on average: probably too weak or too light`);
  });

  // the CPU leaves some moves (often the specials) unused; run every move directly so their hooks run too
  await timed("moves", async () => {
    const d = await fresh();
    const held = { ...EMPTY_INPUT, x: 100, b: B.SPECIAL | B.ATTACK };
    for (const [m, mv] of Object.entries(d.moves)) {
      if (mv.throwFrame || m === "pummel") continue;
      for (const input of [EMPTY_INPUT, held]) guard(`move ${m} started on its own`, () => {
        const s = createMatch({ stage: "proving", players: [{ fighter: id }, { fighter: DUMMY }], seed: 3 });
        const f = s.fighters[0], v = s.fighters[1];
        f.x = -40; v.x = 40; f.facing = 1; v.facing = -1;
        if (mv.aerial) for (const x of [f, v]) { x.y = -220; x.grounded = false; x.platform = -1; }
        startMove(s, f, m);
        for (let i = 0; i < mv.total + 30; i++) {
          step(s, [i < 20 ? input : EMPTY_INPUT, EMPTY_INPUT]);
          hooks.collect(s, (slot) => slot === 0);
          watch(f);
          s.events.length = 0;
        }
      });
    }
    for (const [k, b] of Object.entries(seen)) {
      const bar = def.bars![k];
      if (b.hi === b.lo) hard(`bars.${k} (${bar.label}) never changed in ${LADDER.length * LADDER_MATCHES} CPU matches nor when every move was run with special held: nothing reads or writes f.bars.${k}`);
      else if (bar.trip !== undefined && !b.tripped) r.soft.push(`bars.${k} (${bar.label}) never tripped its latch (trip ${bar.trip}): it ranged ${Math.round(b.lo)}..${Math.round(b.hi)} of ${bar.max}`);
      else if (b.hi < bar.max * 0.9 && (bar.start ?? 0) < bar.max * 0.9) r.soft.push(`bars.${k} (${bar.label}) never got near full: it peaked at ${Math.round(b.hi)} of ${bar.max}`);
    }
  });

  await timed("recovery", async () => {
    await fresh();
    let recovered = 0, usedUp = 0, bestGap = Infinity, bestRise = 0;
    guard("the recovery check", () => {
      for (let seed = 1; seed <= 10; seed++) {
        const s = createMatch({ stage: "proving", players: [{ fighter: id, cpu: LEVEL }, { fighter: DUMMY }], rules: { stocks: 1 }, seed });
        const f = s.fighters[0], thrower = s.fighters[1];
        const side = seed % 2 ? 1 : -1;
        f.x = side * 535; f.y = 0; f.percent = 52; f.facing = (-side) as 1 | -1;
        thrower.x = f.x - side * 75; thrower.y = 0; thrower.facing = side as 1 | -1; thrower.moveFacing = thrower.facing;
        hitOf(s, thrower, f, { frames: [0, 0], x: 0, y: 0, r: 0, damage: 8, angle: 35, base: 50, growth: 55 }, f.x, f.y - 50, true);
        const away = { ...EMPTY_INPUT, x: side * 85, y: -100 };
        let up = false, upY = 0, out = false;
        for (let i = 0; i < 900 && f.stocks > 0; i++) {
          // the worst case: DI and drift away from the stage until the launch is over, then recover
          const launched = f.hitlag > 0 || f.action === "hitstun" || (f.action === "tumble" && f.frame < f.hitstun);
          step(s, [launched ? away : cpuInput(s, 0, LEVEL), EMPTY_INPUT]);
          hooks.collect(s, (slot) => slot === 0);
          for (const e of s.events) if (e.t === "move" && e.slot === 0 && e.move === "uspecial") { up = true; upY = f.y; }
          s.events.length = 0;
          if (up) bestRise = Math.max(bestRise, upY - f.y);
          if (Math.abs(f.x) > 620) out = true;
          if (out && f.y > -40 && f.y < 60) bestGap = Math.min(bestGap, Math.abs(f.x) - 560);
          if (f.grounded && f.platform === 0 && Math.abs(f.x) <= 560) { recovered++; break; }
        }
        if (up) usedUp++;
      }
    });
    r.recovery = recovered;
    if (recovered < 6) hard(`recovery: knocked offstage from x=±535 at 52%, made it back ${recovered}/10 times (need 6). The CPU used uspecial in ${usedUp}/10 attempts; uspecial rose at most ${Math.round(bestRise)} units; ${bestGap === Infinity ? "it never came back to ledge height" : `at ledge height it got no closer than ${Math.round(bestGap)} units outside the ledge (x=±560)`}, after being knocked out to about x=±760. uspecial must carry it about 250 units back toward the stage AND up: set f.grounded = false, f.platform = -1, a strongly negative f.vy (-9 to -14) and let f.vx follow input.x at 5-8 units/frame for 20-30 frames in its hook; check airSpeed/airAccel, jumps and doubleJump too`);
  });

  await timed("ko", async () => {
    await fresh();
    for (const m of KO_MOVES) if (def.moves[m]) {
      const d = roster[id];
      guard(`the KO test of ${m}`, () => { r.killPercents[m] = killPercent(d, m); });
    }
    const best = Object.values(r.killPercents).filter((p): p is number => p !== null);
    if (!best.length) hard(`KO: no move kills a weight-${roster[DUMMY].stats.weight} opponent from centre stage under 300% (tested ${Object.keys(r.killPercents).join(", ")}). Give fsmash or a special a hitbox with base 50-70 and growth 90-110 at a launching angle (30-60 or 80-90)`);
  });

  for (const [move, { error, n }] of hooks.byMove) r.failures.push({ kind: "hook", msg: `hook of move ${move} threw ${n}x: "${error}". The engine disables a throwing hook, so the move loses its gimmick; guard against missing targets and undefined fields` });
  r.movesUsed = [...used].sort();
  r.ok = r.failures.length === 0;
  return r;
}

function killPercent(def: FighterDef, moveId: string): number | null {
  const mv = def.moves[moveId];
  const hbs = mv.hitboxes.filter((h) => !h.grab);
  if (!hbs.length) return null;
  const hb = hbs.reduce((a, b) => (b.base + b.growth > a.base + a.growth ? b : a));
  const dies = (percent: number): boolean => {
    const s = createMatch({ stage: "proving", players: [{ fighter: def.id }, { fighter: DUMMY }], seed: 1 });
    const a = s.fighters[0], v = s.fighters[1];
    a.x = -60; v.x = 0; v.facing = -1; a.facing = 1; a.moveFacing = 1;
    v.percent = percent;
    a.action = "attack"; a.move = moveId; a.frame = hb.frames[0]; a.moveInstance = 1; a.chargeMul = 1;
    hitOf(s, a, v, hb, v.x, v.y - 60, !!mv.throwFrame);
    a.action = "idle"; a.move = null;
    for (let i = 0; i < 600; i++) {
      step(s, [EMPTY_INPUT, EMPTY_INPUT]);
      for (const e of s.events) if (e.t === "ko" && e.slot === 1) return e.side !== "bottom";
      s.events.length = 0;
      if (i > 30 && v.grounded && v.action !== "tumble" && v.hitstun <= 0) return false;
    }
    return false;
  };
  if (!dies(300)) return null;
  let lo = 0, hi = 300;
  while (hi - lo > 5) { const mid = Math.round((lo + hi) / 10) * 5; if (mid === hi || mid === lo) break; if (dies(mid)) hi = mid; else lo = mid; }
  return hi;
}

