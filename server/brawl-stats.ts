import fs from "node:fs";
import path from "node:path";
import express from "express";

/**
 * Kills, deaths, time survived and damage dealt per character in the menu brawl, summed across every
 * browser into `brawl-stats.json`. Nothing shows them yet; they're kept in case something wants them.
 * Per-life averages are `survivedSec / lives` and `dealt / dealtLives`: each counts only the deaths that
 * came with that number, since older builds still open in someone's tab post less.
 */
export interface BrawlRow { kills: number; deaths: number; lives: number; survivedSec: number; dealt: number; dealtLives: number }
export type BrawlTally = Record<string, BrawlRow>;

/** More than any one batch could honestly hold: a browser posts about once a minute. */
const MAX_PER_BATCH = 200;
const MAX_SECONDS_PER_BATCH = 200 * 600;
const MAX_DAMAGE_PER_BATCH = 200 * 2000;
const ID = /^[\w-]{1,64}$/;

export function attachBrawlStats(api: express.Router, dataDir: string): void {
  const file = path.join(dataDir, "brawl-stats.json");
  const totals: BrawlTally = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};

  api.post("/brawl-stats", express.text({ type: "text/plain", limit: "16kb" }), (req, res) => {
    const batch = parse(req.body);
    if (!batch) return res.status(400).json({ error: "bad tally" });
    for (const [id, t] of Object.entries(batch)) {
      const row = totals[id] ??= { kills: 0, deaths: 0, lives: 0, survivedSec: 0, dealt: 0, dealtLives: 0 };
      row.kills += t.kills; row.deaths += t.deaths;
      row.lives = (row.lives ?? 0) + t.lives; row.survivedSec = (row.survivedSec ?? 0) + t.survivedSec;
      row.dealtLives = (row.dealtLives ?? 0) + t.dealtLives; row.dealt = (row.dealt ?? 0) + t.dealt;
    }
    fs.writeFileSync(file, JSON.stringify(totals));
    res.status(204).end();
  });
}

function parse(body: unknown): BrawlTally | null {
  let raw: unknown;
  try { raw = JSON.parse(String(body)); } catch { return null; }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const ok = (n: unknown, max = MAX_PER_BATCH): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= max;
  const out: BrawlTally = {};
  for (const [id, t] of Object.entries(raw)) {
    const { kills, deaths, lives = 0, survivedSec = 0, dealt = 0, dealtLives = 0 } = (t ?? {}) as Record<string, unknown>;
    if (!ID.test(id) || !ok(kills) || !ok(deaths) || !ok(lives) || lives > deaths || !ok(survivedSec, MAX_SECONDS_PER_BATCH)) return null;
    if (!ok(dealtLives) || dealtLives > deaths || !ok(dealt, MAX_DAMAGE_PER_BATCH)) return null;
    out[id] = { kills, deaths, lives, survivedSec, dealt, dealtLives };
  }
  return out;
}
