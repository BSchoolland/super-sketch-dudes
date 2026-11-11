import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type express from "express";
import type { NameRequest, Player } from "../shared/account";
import { isJudgement, NAME_FLAG_LABELS, NAME_VERDICTS } from "../shared/moderation";
import type { WideEvent } from "../shared/wide";
import { decide } from "./moderation";
import { badWordIn } from "./name-filter";
import { nameOf } from "./library";
import { randomName } from "./names";

/**
 * A name a player types is a request: they keep the name they have until the auto moderator's two judges, run by
 * the forge worker, pass the new one (/forge/names/next, then /verdict). A name the word filter catches never
 * reaches the judges. One request waits per player; kept in <dataDir>/name-requests.json.
 */
interface NameRecord {
  /** `claimedAt`: when the worker took it to its judges, 0 while it waits for them. */
  pending: { id: string; name: string; at: number; claimedAt: number } | null;
  refused: { name: string; reason: string; at: number } | null;
  /** When each name went to the judges, the last day's. */
  sent: number[];
}

const DAY_MS = 86_400_000;
/** Names a player may send to the judges in a day: each one is two judge runs. */
export const NAMES_PER_DAY = 5;
/** A claimed name with no verdict this long after goes back to waiting (the judges' own timeout is 2 min). */
const CLAIM_MS = 10 * 60_000;
/** The worker polls every 2 s; quieter than this, it's down. */
const CHECKER_UP_MS = 30_000;

const records = new Map<string, NameRecord>();
let file = "";
let lastPoll = 0;

function persist(): void {
  fs.writeFileSync(file, JSON.stringify(Object.fromEntries(records)));
}

const recordOf = (player: string): NameRecord => {
  let r = records.get(player);
  if (!r) records.set(player, (r = { pending: null, refused: null, sent: [] }));
  return r;
};

/** What the player sees of their last request: waiting, or refused in the last day. */
export function nameRequestOf(player: string, now = Date.now()): NameRequest | null {
  const r = records.get(player);
  if (r?.pending) return { name: r.pending.name, status: "waiting" };
  if (r?.refused && now - r.refused.at < DAY_MS) return { name: r.refused.name, status: "refused", reason: r.refused.reason };
  return null;
}

/** Whether the worker has asked for names lately, so a waiting name will be checked soon. */
export const checkerUp = (now = Date.now()): boolean => now - lastPoll < CHECKER_UP_MS;

/** Asks for `name` (already through typedName) for an account. An error is what to tell them, with its HTTP status. */
export function requestName(player: Player, name: string, now = Date.now()): NameRequest | { error: string; status: number } {
  if (name === player.name) return { error: "that's already your name", status: 400 };
  if (badWordIn(name)) return { error: "That name isn't allowed. Try another.", status: 400 };
  const r = recordOf(player.id);
  if (r.pending) return { error: `"${r.pending.name}" is still being checked`, status: 409 };
  r.sent = r.sent.filter((t) => now - t < DAY_MS);
  if (r.sent.length >= NAMES_PER_DAY) return { error: `That's ${NAMES_PER_DAY} new names today: try again tomorrow`, status: 429 };
  r.sent.push(now);
  r.pending = { id: crypto.randomBytes(6).toString("hex"), name, at: now, claimedAt: 0 };
  r.refused = null;
  persist();
  return { name, status: "waiting" };
}

/** Reads the requests; auth.ts does, as players ask through it. */
export function loadNameRequests(dataDir: string): void {
  file = path.join(dataDir, "name-requests.json");
  records.clear();
  if (fs.existsSync(file)) for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, NameRecord>)) records.set(k, v);
}

/** `rename` puts an approved name everywhere the player's name shows (auth.ts applyName). */
export interface NameJudgingOptions { token: string; rename: (player: string, name: string) => Player }

/** The forge worker's side: it takes names to its judges and brings back their verdicts. */
export function attachNameJudging(api: express.Router, opts: NameJudgingOptions): void {

  const worker = (req: express.Request, res: express.Response): boolean => {
    if (!opts.token || req.get("x-forge-token") !== opts.token) { res.status(401).json({ error: "bad forge token" }); return false; }
    return true;
  };
  const claimed = (id: string): [string, NameRecord] | undefined => [...records].find(([, r]) => r.pending?.id === id && r.pending.claimedAt);

  // the oldest waiting name, or one whose judging never came back
  api.get("/forge/names/next", (req, res) => {
    if (!worker(req, res)) return;
    const now = lastPoll = Date.now();
    const next = [...records]
      .filter(([, r]) => r.pending && (!r.pending.claimedAt || now - r.pending.claimedAt > CLAIM_MS))
      .sort(([, a], [, b]) => a.pending!.at - b.pending!.at)[0];
    if (!next) return res.status(204).end();
    const [player, r] = next;
    r.pending!.claimedAt = now;
    persist();
    res.json({ id: r.pending!.id, name: r.pending!.name, player, playerName: nameOf(player) });
  });

  // { harsh, lenient } -> the decision; the same rule and reputation as drawings (moderation.ts)
  api.post("/forge/names/:id/verdict", (req, res) => {
    if (!worker(req, res)) return;
    const found = claimed(req.params.id);
    if (!found) return res.status(409).json({ error: "no such name being judged" });
    const { harsh, lenient } = req.body ?? {};
    if (!isJudgement(harsh, NAME_VERDICTS) || !isJudgement(lenient, NAME_VERDICTS)) return res.status(400).json({ error: "harsh and lenient name judgements required" });
    const [player, r] = found;
    const name = r.pending!.name;
    const d = decide(player, { name }, { harsh, lenient });
    r.pending = null;
    if (d.blocked) r.refused = { name, reason: [...new Set(d.flags)].map((f) => NAME_FLAG_LABELS[f]).join(", and "), at: Date.now() };
    else opts.rename(player, name);
    persist();
    (res.locals.event as WideEvent | undefined)?.set("name", { player, harsh: harsh.verdict, lenient: lenient.verdict, blocked: d.blocked, reputation: [d.before, d.after] });
    res.json({ blocked: d.blocked, held: d.held, before: d.before, after: d.after });
  });

  // the judges couldn't run: it waits for the next try
  api.post("/forge/names/:id/release", (req, res) => {
    if (!worker(req, res)) return;
    const found = claimed(req.params.id);
    if (!found) return res.status(409).json({ error: "no such name being judged" });
    found[1].pending!.claimedAt = 0;
    persist();
    (res.locals.event as WideEvent | undefined)?.issue("warn", "unjudged", String(req.body?.error ?? "no reason given").slice(0, 300));
    res.status(204).end();
  });

  // Ben taking a name down: the player gets a made-up one
  api.post("/forge/names/take-down", (req, res) => {
    if (!worker(req, res)) return;
    const player = String(req.body?.player ?? "");
    if (!nameOf(player)) return res.status(404).json({ error: "no such player" });
    res.json({ player: opts.rename(player, randomName()) });
  });
}
