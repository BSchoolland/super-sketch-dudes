import fs from "node:fs";
import path from "node:path";
import express from "express";
import { playerOf } from "./auth";
import crypto from "node:crypto";
import { charactersMade } from "./forge";
import { decodePng } from "./characters";
import { DRAW_PNG_MAX_BYTES } from "../shared/account";

/**
 * Class time: a Chromebook on the school's network during school hours gets a note from Ben instead
 * of the game. Its addresses are SCHOOL_IPS in the server's .env; the hours are a guess from when the traffic came in.
 */
const SCHOOL = { ips: (process.env.SCHOOL_IPS ?? "").split(",").filter(Boolean), tz: "America/Los_Angeles", from: "08:15", to: "14:45" };
const FEEDBACK_MAX = 2000;
const FEEDBACK_PER_DAY = 20;

function clientIp(req: express.Request): string {
  // Apache's ProxyPass appends the address it saw; earlier entries come from proxies on the client's side
  const fwd = req.get("x-forwarded-for");
  return (fwd ? fwd.split(",").at(-1)! : req.socket.remoteAddress ?? "").trim();
}

export function inClassTime(now: Date): boolean {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: SCHOOL.tz, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(now).map((p) => [p.type, p.value]));
  if (parts.weekday === "Sat" || parts.weekday === "Sun") return false;
  const hm = `${parts.hour}:${parts.minute}`;
  return hm >= SCHOOL.from && hm < SCHOOL.to;
}

export function attachSchool(api: express.Router, dataDir: string): void {
  api.get("/class", (req, res) => {
    const blocked = SCHOOL.ips.includes(clientIp(req)) && /CrOS/.test(req.get("user-agent") ?? "") && inClassTime(new Date());
    res.json({ blocked, characters: blocked ? charactersMade() : null });
  });

  const file = path.join(dataDir, "feedback.jsonl");
  const today = new Map<string, { day: string; n: number }>();
  // { text, png?: <data URL> }: the sketch is saved next to the log as feedback/<id>.png
  api.post("/feedback", (req, res) => {
    const text = typeof req.body?.text === "string" ? req.body.text.trim().slice(0, FEEDBACK_MAX) : "";
    const png = typeof req.body?.png === "string" ? decodePng(req.body.png) : null;
    if (req.body?.png && !png) return res.status(400).json({ error: "sketch must be a PNG data URL" });
    if (png && png.length > DRAW_PNG_MAX_BYTES) return res.status(400).json({ error: "sketch too large" });
    if (!text && !png) return res.status(400).json({ error: "empty feedback" });
    const player = playerOf(req);
    const who = player?.id ?? clientIp(req);
    const day = new Date().toISOString().slice(0, 10);
    const count = today.get(who)?.day === day ? today.get(who)!.n : 0;
    if (count >= FEEDBACK_PER_DAY) return res.status(429).json({ error: "that's a lot of feedback for one day, try again tomorrow" });
    today.set(who, { day, n: count + 1 });
    let sketch: string | null = null;
    if (png) {
      sketch = `feedback/${crypto.randomBytes(6).toString("hex")}.png`;
      fs.mkdirSync(path.join(dataDir, "feedback"), { recursive: true });
      fs.writeFileSync(path.join(dataDir, sketch), png);
    }
    fs.appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), player: player ? { id: player.id, name: player.name } : null, text, sketch }) + "\n");
    res.status(204).end();
  });
}
