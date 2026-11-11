// How far visitors got, per source; see USAGE. Bundled to dist/funnel.mjs so it runs on the server too.
import fs from "node:fs";
import path from "node:path";
import { readEvents } from "../server/eventlog";
import { funnel, STEPS, UNRECORDED, type Counts, type Step } from "../server/funnel";
import { cliArgs, dataDir, parseSince } from "./lib/cli";

const USAGE = `npm run funnel -- [--since 14d] [--tz America/Chicago] [--data <dir>]
Distinct visitors per source reaching each step, for page sessions that started since --since.
Players whose ids are listed in <data>/staff.json (a JSON array, required) are left out.
Calendar days ("came back") are in --tz, default this machine's zone.`;
const { value } = cliArgs(["--since", "--tz", "--data"], USAGE);
const sinceArg = value("--since") ?? "14d";
const since = parseSince(sinceArg);
const timeZone = value("--tz") ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
const data = dataDir(value("--data"), import.meta.url);
const staff = new Set<string>(JSON.parse(fs.readFileSync(path.join(data, "staff.json"), "utf8")));
const f = funnel(readEvents(data), since, timeZone, staff);

const HEAD: Record<Step, string> = { arrived: "arrived", guest: "as guest", drew: "drew", forged: "forged", forgeDone: "forge done", played: "played", bots: "vs bots", online: "online", touch: "on touch", signedIn: "signed in", cameBack: "came back" };
const width = Math.max(12, ...f.rows.map((r) => r.source.length));
const cells = (c: Counts): string => STEPS.map((k) => String(c[k]).padStart(HEAD[k].length)).join("  ");
const why = Object.entries(f.excluded.why).map(([k, n]) => `${k} ${n}`).join(", ");

console.log(`Funnel since ${new Date(since).toISOString().slice(0, 16)}Z (${sinceArg}) from ${data}: ${f.sessions} page sessions, calendar days in ${timeZone}`);
console.log(`A visitor is a player: a guest, or an account (a guest who signed in counts as the account). A page session with no player (before guest play,
or before its guest arrived) is its own visitor unless its tab later had a player, where the tab's source was recorded.
Guests keep their id across days; sessions with no player can't be joined across days, so "came back" only counts them when the browser's
first-ever arrival (recorded since sources were) was on an earlier day.
${UNRECORDED}: sessions from before sources were recorded; each one with no player is its own visitor, including the half of an OAuth round trip before the bounce.`);
console.log(`Excluded ${f.excluded.sessions} sessions (${f.excluded.visitors} visitors) as not human${why ? `: ${why}` : ""}`);
if (f.screenless) console.log(`${f.screenless} sessions only ever sent their opening snapshot (no screen reached the server); they count as arrived`);
if (f.orphanForges) console.log(`${f.orphanForges} players sent forge jobs in the window without a page session in it; they count for nobody`);
console.log("");
console.log(`${"source".padEnd(width)}  ${STEPS.map((k) => HEAD[k]).join("  ")}`);
for (const r of f.rows) console.log(`${r.source.padEnd(width)}  ${cells(r.counts)}`);
console.log(`${"total".padEnd(width)}  ${cells(f.total)}`);
console.log(`
as guest: played as a guest (guest-… player) · drew: opened the draw pad · forged / forge done: the player sent a forge job,
and one produced a fighter · vs bots: a local match (practice and map tests don't count) ·
online: a relay match started (either side's record) · played: either · on touch: played a match on the touch controls · signed in: made or used an account (Discord, Google, email) ·
came back: page sessions on two or more calendar days`);
