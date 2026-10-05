// Network profiles: what a player's connection does to every packet, each direction separately, between the player
// and the relay. `base` is the steady state (netem delay/jitter/burst loss); `episodes` are the events that make a
// connection feel bad (a wifi spike: extra delay for a moment; a blackout: everything lost until it ends, so TCP
// backs off and retransmits for real). Calibrated against production telemetry; see scenarios.mjs for the targets.

/**
 * @typedef {{ delayMs: number, jitterMs?: number, lossPct?: number, burstPct?: number }} Base
 *   `lossPct` starts a loss burst (Gilbert-Elliott p), `burstPct` the chance a burst ends per packet (r); 100 = single drops.
 * @typedef {{ type: "spike", everySec: number, durMs: [number, number], addMs: [number, number] }
 *         | { type: "blackout", everySec: number, durMs: [number, number] }} Episode
 *   `everySec` is the mean gap (episodes arrive at random, seeded per run).
 * @typedef {{ about: string, base: Base, episodes?: Episode[] }} Profile
 */

/** @type {Record<string, Profile>} */
export const PROFILES = {
  lan: {
    about: "No added delay: the lab's own floor. Anything that stalls here isn't the network.",
    base: { delayMs: 0 },
  },
  wired: {
    about: "A good wired home connection ~40 ms from the relay.",
    base: { delayMs: 20, jitterMs: 2 },
  },
  "home-wifi": {
    about: "Decent home wifi: a little jitter and the odd brief spike (Ben, Alpha, Bravo in production: rtt ~35-70 avg, max <250).",
    base: { delayMs: 22, jitterMs: 6 },
    episodes: [{ type: "spike", everySec: 45, durMs: [150, 400], addMs: [60, 140] }],
  },
  "busy-wifi": {
    about: "A Mac laptop on busier wifi (Adrean: rtt ~60-80 avg, max 260-400, relay gaps up to ~800 ms).",
    base: { delayMs: 25, jitterMs: 15, lossPct: 0.1, burstPct: 60 },
    episodes: [{ type: "spike", everySec: 25, durMs: [150, 500], addMs: [80, 220] }],
  },
  "school-wifi": {
    about: "A Chromebook on school wifi shared by a class (Charlie/Delta/Echo: rtt ~50 avg, max 250-400, a rare multi-second drop).",
    base: { delayMs: 22, jitterMs: 8, lossPct: 0.2, burstPct: 50 },
    episodes: [
      { type: "spike", everySec: 30, durMs: [200, 500], addMs: [100, 250] },
      { type: "blackout", everySec: 300, durMs: [1500, 5000] },
    ],
  },
  "spiky-wifi": {
    about: "Wifi that keeps hiccuping and now and then drops for seconds (Kirill on 10/5: rtt avg 77-200, max 1-10 s, relay gaps 1.5-9.5 s, 1-5 gaps over 1 s per match).",
    base: { delayMs: 22, jitterMs: 20, lossPct: 0.3, burstPct: 50 },
    episodes: [
      { type: "spike", everySec: 8, durMs: [150, 500], addMs: [80, 250] },
      { type: "blackout", everySec: 150, durMs: [800, 2500] },
      { type: "blackout", everySec: 1200, durMs: [4000, 8000] },
    ],
  },
};

/** `name` or `name@ms`: the profile with its one-way base delay set to ms (players sit at different distances from the relay). */
export function profile(spec) {
  const [name, delay] = spec.split("@");
  const p = PROFILES[name];
  if (!p) throw new Error(`unknown network profile ${name}; have ${Object.keys(PROFILES).join(", ")}`);
  if (delay === undefined) return p;
  if (!/^\d+$/.test(delay)) throw new Error(`${spec}: the delay after @ is whole milliseconds`);
  return { ...p, base: { ...p.base, delayMs: Number(delay) } };
}

/** Seeded PRNG (mulberry32), so a run's episodes are reproducible from its seed. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Every episode for one direction of one player over `seconds`, as [{ atMs, endMs, type, addMs? }] sorted by start.
 * Overlapping episodes are kept; the shaper applies the worst one in force.
 */
export function schedule(p, seconds, random) {
  const out = [];
  const between = (lo, hi) => lo + random() * (hi - lo);
  for (const ep of p.episodes ?? []) {
    let t = -Math.log(1 - random()) * ep.everySec * 1000;
    while (t < seconds * 1000) {
      const dur = between(...ep.durMs);
      out.push({ atMs: Math.round(t), endMs: Math.round(t + dur), type: ep.type, ...(ep.type === "spike" ? { addMs: Math.round(between(...ep.addMs)) } : {}) });
      t += dur - Math.log(1 - random()) * ep.everySec * 1000;
    }
  }
  return out.sort((a, b) => a.atMs - b.atMs);
}
