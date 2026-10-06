import express from "express";
import { charactersMade } from "./forge";

/**
 * Class time: a Chromebook on the school's network during school hours gets a note from Ben instead
 * of the game. Its addresses are SCHOOL_IPS in the server's .env; the hours are a guess from when the traffic came in.
 */
const SCHOOL = { ips: (process.env.SCHOOL_IPS ?? "").split(",").filter(Boolean), tz: "America/Los_Angeles", from: "08:15", to: "14:45", openDays: ["2026-10-06"] };

export function clientIp(req: express.Request): string {
  // Apache's ProxyPass appends the address it saw; earlier entries come from proxies on the client's side
  const fwd = req.get("x-forwarded-for");
  return (fwd ? fwd.split(",").at(-1)! : req.socket.remoteAddress ?? "").trim();
}

export function inClassTime(now: Date): boolean {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: SCHOOL.tz, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(now).map((p) => [p.type, p.value]));
  if (parts.weekday === "Sat" || parts.weekday === "Sun") return false;
  if (SCHOOL.openDays.includes(new Intl.DateTimeFormat("en-CA", { timeZone: SCHOOL.tz }).format(now))) return false;
  const hm = `${parts.hour}:${parts.minute}`;
  return hm >= SCHOOL.from && hm < SCHOOL.to;
}

export function attachSchool(api: express.Router): void {
  api.get("/class", (req, res) => {
    const blocked = SCHOOL.ips.includes(clientIp(req)) && /CrOS/.test(req.get("user-agent") ?? "") && inClassTime(new Date());
    res.json({ blocked, characters: blocked ? charactersMade() : null });
  });
}
