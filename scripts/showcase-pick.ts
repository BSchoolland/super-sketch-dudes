// Simulates 1-stock CPU fights between the most played community characters, headless at full speed, scores them for a
// promo clip (a real KO by the opponent, close, hits both ways, lots of different moves, specials and smashes used) and
// prints a summary per CPU tier plus the best fights as JSON. Every tier fights the same matchups on the same seeds.
// Usage: tsx scripts/showcase-pick.ts [fighters=16] [seeds=2] [stages=final,proving] [tiers=5,showman] [site=https://supersketchdudes.com]
// A tier is 1-5 or "showman". Bundles are cached in $TMPDIR/ssd-showcase-bundles (their URLs change when they do).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMatch, step } from "../shared/sim";
import { cpuInput } from "../shared/cpu";
import { SHOWMAN_TIER } from "../shared/cpu-skill";
import { showOf } from "../shared/cpu-show";
import { registerFighter, roster } from "../shared/fighters/index";
import { buildGenerated, type GeneratedBundle } from "../shared/gen/load";

const NF = Number(process.argv[2] ?? 16), SEEDS = Number(process.argv[3] ?? 2), STAGES = (process.argv[4] ?? "final,proving").split(",");
const TIERS = (process.argv[5] ?? "5,showman").split(",").map(tierOf);
const SITE = process.argv[6] ?? "https://supersketchdudes.com";
const MAX_FRAMES = 60 * 90;
/** A hit this big is one viewers should see land. */
const HEAVY = 15;

function tierOf(arg: string): number {
  if (arg === "showman") return SHOWMAN_TIER;
  const t = Number(arg);
  if (!Number.isInteger(t) || t < 1 || t > 5) throw new Error(`tier ${arg}: 1 to 5 or showman`);
  return t;
}
const tierLabel = (t: number) => (t === SHOWMAN_TIER ? "showman" : `tier ${t}`);

type Listed = { id: string; name: string; bundleUrl: string; plays: number; saves: number };
const res = await fetch(`${SITE}/api/characters/community`);
if (!res.ok) throw new Error(`community characters: HTTP ${res.status}`);
const list = ((await res.json()).characters as Listed[]).sort((a, b) => b.plays + 3 * b.saves - (a.plays + 3 * a.saves)).slice(0, NF);
const cache = join(tmpdir(), "ssd-showcase-bundles");
mkdirSync(cache, { recursive: true });
const names: Record<string, string> = {};
for (const c of list) {
  const file = join(cache, c.bundleUrl.replace(/[^a-z0-9.-]/gi, "_"));
  if (!existsSync(file)) {
    const r = await fetch(SITE + c.bundleUrl);
    if (!r.ok) throw new Error(`${c.name} bundle: HTTP ${r.status}`);
    writeFileSync(file, await r.text());
  }
  registerFighter(await buildGenerated(JSON.parse(readFileSync(file, "utf8")) as GeneratedBundle));
  names[c.id] = c.name;
}

interface Fight {
  score: number; stage: string; seed: number; ids: string[]; names: string[]; secs: number;
  real: boolean; selfKO: boolean; close: number; hits: number[]; moves: number[]; bigUses: number[]; bigLands: number[]; heavy: number; blocked: number; winner: number;
}

const isBig = (m: string) => /special|smash/i.test(m);

function fight(ids: string[], stage: string, seed: number, tier: number): Fight {
  const s = createMatch({ stage, players: ids.map((fighter) => ({ fighter, cpu: tier })), rules: { stocks: 1, time: 0 }, seed });
  const shows = ids.map((id) => showOf(roster[id]).big);
  const moves = [new Set<string>(), new Set<string>()], bigUses = [0, 0], hits = [0, 0], bigLands = [0, 0];
  let ko: { slot: number; by: number } | null = null, heavy = 0, blocked = 0;
  while (!s.ended && s.frame < MAX_FRAMES) {
    step(s, [cpuInput(s, 0, tier), cpuInput(s, 1, tier)]);
    for (const e of s.events) {
      if (e.t === "move") { moves[e.slot].add(e.move); if (isBig(e.move)) bigUses[e.slot]++; }
      if (e.t === "hit" && e.victim >= 0) {
        hits[e.attacker]++;
        const big = shows[e.attacker];
        if (s.fighters[e.attacker].move === big.id || e.damage >= big.power * 0.8) bigLands[e.attacker]++;
        if (e.damage >= HEAVY) heavy++;
      }
      if (e.t === "shieldHit" && e.damage >= HEAVY) blocked++;
      if (e.t === "ko" && !ko) ko = { slot: e.slot, by: e.by };
    }
    s.events.length = 0;
  }
  const secs = s.frame / 60;
  const real = !!ko && ko.by >= 0 && ko.by !== ko.slot;
  const dealt = s.fighters.map((f) => f.dealt);
  const close = Math.min(...dealt) / Math.max(1, ...dealt);
  const variety = Math.min(moves[0].size, moves[1].size) + 0.5 * Math.max(moves[0].size, moves[1].size);
  const length = secs < 12 ? secs / 12 : secs > 45 ? 45 / secs : 1;
  const score = real ? (variety * 2 + Math.min(...bigUses) * 3 + Math.min(...hits) * 0.5 + close * 10) * length : 0;
  return {
    score: +score.toFixed(1), stage, seed, ids, names: ids.map((x) => names[x]), secs: +secs.toFixed(1), real, selfKO: !!ko && !real,
    close: +close.toFixed(2), hits, moves: moves.map((x) => x.size), bigUses, bigLands, heavy, blocked, winner: s.winner,
  };
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const pct = (n: number, d: number) => `${((100 * n) / Math.max(1, d)).toFixed(0)}%`;

function summary(rs: Fight[]): Record<string, string> {
  const real = rs.filter((r) => r.real), fighters = rs.flatMap((r) => [0, 1].map((i) => ({ r, i })));
  return {
    fights: String(rs.length),
    "real KO": pct(real.length, rs.length),
    "self-destruct": pct(rs.filter((r) => r.selfKO).length, rs.length),
    "no KO in 90 s": pct(rs.filter((r) => !r.real && !r.selfKO).length, rs.length),
    "avg length (s)": avg(rs.map((r) => r.secs)).toFixed(1),
    "length 20-45 s": pct(rs.filter((r) => r.secs >= 20 && r.secs <= 45).length, rs.length),
    "under 20 s": pct(rs.filter((r) => r.secs < 20).length, rs.length),
    "over 45 s": pct(rs.filter((r) => r.secs > 45).length, rs.length),
    "distinct moves / fighter": avg(fighters.map(({ r, i }) => r.moves[i])).toFixed(1),
    "specials+smashes / fighter": avg(fighters.map(({ r, i }) => r.bigUses[i])).toFixed(1),
    "hits / fighter": avg(fighters.map(({ r, i }) => r.hits[i])).toFixed(1),
    "hits, fewer side": avg(rs.map((r) => Math.min(...r.hits))).toFixed(1),
    closeness: avg(rs.map((r) => r.close)).toFixed(2),
    "biggest move lands / fighter": avg(fighters.map(({ r, i }) => r.bigLands[i])).toFixed(2),
    "biggest move landed at least once": pct(fighters.filter(({ r, i }) => r.bigLands[i] > 0).length, fighters.length),
    [`${HEAVY}+ damage hits taken / fight`]: avg(rs.map((r) => r.heavy)).toFixed(1),
    [`${HEAVY}+ damage hits shielded / fight`]: avg(rs.map((r) => r.blocked)).toFixed(1),
    "avg score": avg(rs.map((r) => r.score)).toFixed(1),
  };
}

const sums: Record<string, Record<string, string>> = {}, tops: Record<string, Fight[]> = {};
for (const tier of TIERS) {
  const t0 = Date.now(), results: Fight[] = [];
  let n = 0;
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) for (const stage of STAGES) for (let k = 0; k < SEEDS; k++) {
    results.push(fight([list[i].id, list[j].id], stage, 1 + n * 7919, tier));
    n++;
  }
  console.error(`${tierLabel(tier)}: ${n} fights from ${list.length} fighters in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  sums[tierLabel(tier)] = summary(results);
  tops[tierLabel(tier)] = [...results].sort((a, b) => b.score - a.score).slice(0, 8);
}
console.error(`\n${"".padEnd(34)}${Object.keys(sums).map((k) => k.padStart(10)).join("")}`);
for (const row of Object.keys(Object.values(sums)[0])) console.error(`${row.padEnd(34)}${Object.values(sums).map((s) => s[row].padStart(10)).join("")}`);
console.log(JSON.stringify(tops, null, 1));
