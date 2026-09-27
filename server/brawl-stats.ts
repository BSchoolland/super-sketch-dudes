import fs from "node:fs";
import path from "node:path";
import express from "express";

/**
 * Kills and deaths per character in the menu brawl, summed across every browser into
 * `brawl-stats.json`. Nothing shows them yet; they're kept in case something wants them.
 */
export type BrawlTally = Record<string, { kills: number; deaths: number }>;

/** More than any one batch could honestly hold: a browser posts about once a minute. */
const MAX_PER_BATCH = 200;
const ID = /^[\w-]{1,64}$/;

export function attachBrawlStats(api: express.Router, dataDir: string): void {
  const file = path.join(dataDir, "brawl-stats.json");
  const totals: BrawlTally = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};

  api.post("/brawl-stats", express.text({ type: "text/plain", limit: "16kb" }), (req, res) => {
    const batch = parse(req.body);
    if (!batch) return res.status(400).json({ error: "bad tally" });
    for (const [id, t] of Object.entries(batch)) {
      const row = totals[id] ??= { kills: 0, deaths: 0 };
      row.kills += t.kills; row.deaths += t.deaths;
    }
    fs.writeFileSync(file, JSON.stringify(totals));
    res.status(204).end();
  });
}

function parse(body: unknown): BrawlTally | null {
  let raw: unknown;
  try { raw = JSON.parse(String(body)); } catch { return null; }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const ok = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= MAX_PER_BATCH;
  const out: BrawlTally = {};
  for (const [id, t] of Object.entries(raw)) {
    const { kills, deaths } = (t ?? {}) as Record<string, unknown>;
    if (!ID.test(id) || !ok(kills) || !ok(deaths)) return null;
    out[id] = { kills, deaths };
  }
  return out;
}
