// A visitor's first minutes, told in order; see USAGE. Bundled to dist/journey.mjs so it runs on the server too.
import fs from "node:fs";
import path from "node:path";
import { readEvents } from "../server/eventlog";
import { journey, type ForgeJobRecord, type Journey, type Stop } from "../server/journey";
import { visitors } from "../server/visitors";
import { cliArgs, dataDir, parseSince } from "./lib/cli";

const USAGE = `npm run journey -- [--since 3d] [--who <name or id>] [--minutes 10] [--all] [--tz America/Chicago] [--data <dir>]
The first minutes of each visitor whose first page session started since --since, oldest first: every screen and how long
they stayed, what they drew and typed, and where they were while their first fighter forged. The view stretches past
--minutes to see that forge finish. Staff (<data>/staff.json) and bots are left out.
By default only visitors who reached a screen past the title; --all shows everyone.`;
const { flag, value } = cliArgs(["--since", "--who", "--minutes", "--all", "--tz", "--data"], USAGE);
const since = parseSince(value("--since") ?? "3d");
const minutes = Number(value("--minutes") ?? 10);
const who = value("--who")?.toLowerCase();
const timeZone = value("--tz") ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
const data = dataDir(value("--data"), import.meta.url);
const staff = new Set<string>(JSON.parse(fs.readFileSync(path.join(data, "staff.json"), "utf8")));
const jobs = new Map((JSON.parse(fs.readFileSync(path.join(data, "forge-jobs.json"), "utf8")) as ForgeJobRecord[]).map((j) => [j.id, j]));

const events = readEvents(data);
// a visitor counts from their very first session, so this reads them all and keeps those who started in the window
const v = visitors(events, 0, staff);
const PAST_TITLE = (j: Journey) => j.visits.some((x) => x.stops.some((s) => !["TitleScreen", "WaitScreen", "LoadingScreen", "SignInScreen"].includes(s.screen)));
const list = v.humans
  .filter((h) => h.sessions[0].t0 >= since)
  .filter((h) => !who || h.key.toLowerCase().includes(who) || h.sessions.some((s) => s.client!.player?.name.toLowerCase().includes(who)))
  .map((h) => journey(h, events, jobs, v.visitorOf, minutes))
  .filter((j) => flag("--all") || who || PAST_TITLE(j))
  .sort((a, b) => a.start - b.start);

const clock = new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const LABEL: Record<string, string> = {
  TitleScreen: "title", BattleMenuScreen: "battle menu", OnlineScreen: "room lobby", VersusScreen: "match (local)", NetVersusScreen: "match (online)",
  LoadingScreen: "loading", WaitScreen: "connecting", CreateScreen: "DRAW PAD", DescribeScreen: "describe", ForgeScreen: "forge progress",
  LibraryScreen: "my characters", CommunityScreen: "community", SheetScreen: "fighter sheet", SignInScreen: "sign in", FeedbackScreen: "feedback",
  SettingsScreen: "settings", MapsScreen: "maps", MapEditorScreen: "map editor", StageScreen: "stage pick", RenameScreen: "rename",
};
const label = (s: string) => LABEL[s] ?? s.replace(/Screen$/, "");
const dur = (ms: number) => (ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.floor(ms / 60_000)}m${String(Math.round((ms % 60_000) / 1000)).padStart(2, "0")}s`);
const mark = (j: Journey, at: number) => {
  const s = Math.round((at - j.start) / 1000);
  return `${String(Math.floor(s / 60)).padStart(3)}:${String(s % 60).padStart(2, "0")}`;
};
/** A local match entered from their characters is practice against the dummy. */
const practice = (stops: Stop[], i: number) => stops[i].screen === "VersusScreen" && stops[i - 1]?.screen === "LibraryScreen";
/** Loading screens fold into what they loaded; repeats of one screen fold into one stop. */
function fold(stops: Stop[]): Stop[] {
  const out: Stop[] = [];
  for (const s of stops) {
    const prev = out[out.length - 1];
    if (prev && (prev.screen === s.screen || prev.screen === "LoadingScreen")) {
      out[out.length - 1] = { at: prev.at, screen: s.screen, ms: prev.ms + s.ms };
    } else out.push({ ...s });
  }
  return out;
}

for (const j of list) {
  const lines: [number, string][] = [];
  for (const visit of j.visits) {
    const hid = visit.hidden.count ? ` · tab hidden ${visit.hidden.count}× for ${dur(visit.hidden.ms)} in all` : "";
    const rot = visit.views ? ` · ${visit.views} resize/rotate` : "";
    lines.push([visit.t0, `── page load${hid}${rot}`]);
    const stops = fold(visit.stops);
    stops.forEach((s, i) => lines.push([s.at, `${(practice(stops, i) ? "practice" : label(s.screen)).padEnd(16)} ${dur(s.ms)}`]));
    if (visit.lastHeard < j.end) lines.push([visit.lastHeard, "── last heard from this page"]);
  }
  for (const f of j.forges) {
    const hint = f.job.hint ? `"${f.job.hint.name}": ${f.job.hint.description || "(no description)"}` : "(typed nothing)";
    lines.push([f.sentAt, `⚒ FORGE SENT  ${hint}`]);
    lines.push([f.sentAt, `             drawing: ${f.job.drawingPath}`]);
    if (f.job.blocked) lines.push([f.sentAt, `             blocked by the moderator`]);
    if (f.doneAt !== null) {
      const result = f.failed ? `FAILED: ${(f.job.error ?? "?").slice(0, 140)}…` : `"${f.job.result?.name}"`;
      const where = f.atDone ? `they were on ${label(f.atDone)}` : `they were gone (last heard ${dur(f.doneAt - (f.goneAt ?? f.doneAt))} before)`;
      lines.push([f.doneAt, `⚒ FORGE DONE  ${result} after ${dur(f.doneAt - f.sentAt)} · ${where}${f.looked ? " · opened it after" : ""}`]);
    }
  }
  for (const m of j.matches) lines.push([m.at, `⚔ online match vs ${m.opponents.join(", ") || "?"} on ${m.stage}, ${dur(m.ms)}${m.withOwnForge ? " with their own forged fighter" : ""}`]);
  lines.sort((a, b) => a[0] - b[0]);

  console.log(`\n${j.name} (${j.account}) · from ${j.source} · ${j.device} · ${clock.format(j.start)} · ${j.key}`);
  for (const [at, text] of lines) console.log(`${mark(j, at)}  ${text}`);
  for (const f of j.forges) {
    if (f.doneAt === null) { console.log(`        still forging "${f.job.hint?.name ?? f.job.fighterId}"`); continue; }
    const during = fold(f.during);
    const waits = during.map((s, i) => ({ s, name: practice(during, i) ? "practice" : label(s.screen) })).filter(({ s }) => s.ms >= 1000).map(({ s, name }) => `${name} ${dur(s.ms)}`).join(" → ");
    console.log(`        while "${f.job.hint?.name ?? f.job.result?.name ?? f.job.fighterId}" forged: ${waits || "nowhere in the game"}`);
  }
}
console.log(`\n${list.length} visitor(s) since ${new Date(since).toISOString().slice(0, 16)}Z; times are from their first page load, clock in ${timeZone}`);
