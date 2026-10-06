import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type express from "express";
import { playerOf } from "./auth";
import { decodePng } from "./characters";
import { clientIp } from "./school";
import { DRAW_PNG_MAX_BYTES, type Player } from "../shared/account";
import { FEEDBACK_MAX, RESPONSE_MAX, type FeedbackItem, type FeedbackResponse } from "../shared/feedback";

/**
 * Feedback: anything a player tells Ben, with an optional sketch. Submissions append to <dataDir>/feedback.jsonl (sketches in
 * feedback/<hex>.png); Ben's responses live in feedback-responses.json, keyed by the submission's `at`. The admins read
 * everything and respond; a player reads their own submissions and the responses to them.
 */
export interface FeedbackOptions { dataDir: string; admins: string[] }

const PER_DAY = 20;

interface Entry { at: string; player: Pick<Player, "id" | "name"> | null; text: string; sketch: string | null }

export function attachFeedback(api: express.Router, opts: FeedbackOptions): void {
  const file = path.join(opts.dataDir, "feedback.jsonl");
  const responsesFile = path.join(opts.dataDir, "feedback-responses.json");
  const sketchDir = path.join(opts.dataDir, "feedback");
  const entries: Entry[] = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Entry) : [];
  const ids = new Set(entries.map((e) => e.at));
  const responses: Record<string, FeedbackResponse> = fs.existsSync(responsesFile) ? JSON.parse(fs.readFileSync(responsesFile, "utf8")) : {};
  for (const r of Object.values(responses)) r.sketch ??= null;
  const saveResponses = () => fs.writeFileSync(responsesFile, JSON.stringify(responses, null, 1));
  const item = (e: Entry): FeedbackItem => ({ id: e.at, player: e.player, text: e.text, sketch: e.sketch ? path.basename(e.sketch) : null, response: responses[e.at] ?? null });
  const isAdmin = (p: Player | null) => !!p && opts.admins.includes(p.id);
  /** A posted sketch as a PNG, or why it's refused. */
  const readPng = (body: unknown): Buffer | null | { error: string } => {
    const raw = (body as { png?: unknown } | undefined)?.png;
    if (!raw) return null;
    const png = typeof raw === "string" ? decodePng(raw) : null;
    if (!png) return { error: "sketch must be a PNG data URL" };
    if (png.length > DRAW_PNG_MAX_BYTES) return { error: "sketch too large" };
    return png;
  };
  /** Saves a PNG under feedback/ and returns its file name. */
  const savePng = (png: Buffer): string => {
    const name = `${crypto.randomBytes(6).toString("hex")}.png`;
    fs.mkdirSync(sketchDir, { recursive: true });
    fs.writeFileSync(path.join(sketchDir, name), png);
    return name;
  };
  const today = new Map<string, { day: string; n: number }>();

  // { text, png?: <data URL> }
  api.post("/feedback", (req, res) => {
    const text = typeof req.body?.text === "string" ? req.body.text.trim().slice(0, FEEDBACK_MAX) : "";
    const png = readPng(req.body);
    if (png && "error" in png) return res.status(400).json(png);
    if (!text && !png) return res.status(400).json({ error: "empty feedback" });
    const player = playerOf(req);
    const who = player?.id ?? clientIp(req);
    const day = new Date().toISOString().slice(0, 10);
    const count = today.get(who)?.day === day ? today.get(who)!.n : 0;
    if (count >= PER_DAY) return res.status(429).json({ error: "that's a lot of feedback for one day, try again tomorrow" });
    today.set(who, { day, n: count + 1 });
    const sketch = png ? `feedback/${savePng(png)}` : null;
    // `at` identifies the entry, so two in the same millisecond can't share one
    let t = Date.now();
    while (ids.has(new Date(t).toISOString())) t++;
    const entry: Entry = { at: new Date(t).toISOString(), player: player ? { id: player.id, name: player.name } : null, text, sketch };
    fs.appendFileSync(file, JSON.stringify(entry) + "\n");
    entries.push(entry);
    ids.add(entry.at);
    res.status(204).end();
  });

  // the caller's own feedback, newest first; `admin` says whether they may read everyone's
  api.get("/feedback/mine", (req, res) => {
    const player = playerOf(req);
    if (!player) return res.status(401).json({ error: "not signed in" });
    res.json({ items: entries.filter((e) => e.player?.id === player.id).map(item).reverse(), admin: isAdmin(player) });
  });

  // they've read these responses
  api.post("/feedback/seen", (req, res) => {
    const player = playerOf(req);
    if (!player) return res.status(401).json({ error: "not signed in" });
    const want = Array.isArray(req.body?.ids) ? (req.body.ids as unknown[]).filter((v): v is string => typeof v === "string") : [];
    const now = new Date().toISOString();
    let changed = false;
    for (const e of entries) {
      const r = responses[e.at];
      if (e.player?.id === player.id && want.includes(e.at) && r && !r.seenAt) { r.seenAt = now; changed = true; }
    }
    if (changed) saveResponses();
    res.status(204).end();
  });

  api.get("/feedback/all", (req, res) => {
    if (!isAdmin(playerOf(req))) return res.status(403).json({ error: "only Ben reads everyone's feedback" });
    res.json({ items: entries.map(item).reverse() });
  });

  // { id, text, png? }: the whole response, so answering again replaces it (and its image), and the player sees it as new
  api.put("/feedback/response", (req, res) => {
    if (!isAdmin(playerOf(req))) return res.status(403).json({ error: "only Ben responds to feedback" });
    const id = String(req.body?.id ?? "");
    const text = typeof req.body?.text === "string" ? req.body.text.trim().slice(0, RESPONSE_MAX) : "";
    const e = entries.find((x) => x.at === id);
    if (!e) return res.status(404).json({ error: `no feedback ${id}` });
    if (!e.player) return res.status(400).json({ error: "that feedback was sent signed out: there's no account to respond to" });
    const png = readPng(req.body);
    if (png && "error" in png) return res.status(400).json(png);
    if (!text && !png) return res.status(400).json({ error: "empty response" });
    const old = responses[id]?.sketch;
    responses[id] = { text, sketch: png ? savePng(png) : null, at: new Date().toISOString(), seenAt: null };
    saveResponses();
    if (old) fs.rmSync(path.join(sketchDir, old));
    res.json({ item: item(e) });
  });

  // a sketch or response image, for the player whose feedback it's on and the admins
  api.get("/feedback/sketch/:name", (req, res) => {
    const name = req.params.name;
    const player = playerOf(req);
    const e = /^[0-9a-f]{12}\.png$/.test(name) ? entries.find((x) => x.sketch === `feedback/${name}` || responses[x.at]?.sketch === name) : undefined;
    if (!e) return res.status(404).json({ error: "no such sketch" });
    if (!player || !(isAdmin(player) || e.player?.id === player.id)) return res.status(403).json({ error: "not your sketch" });
    res.sendFile(path.join(sketchDir, name));
  });
}
