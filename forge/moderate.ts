// The auto moderator: two judges, one harsh and one lenient, look at a drawing and its name before the forge does,
// and at every name a player asks to go by.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isJudgement, NAME_VERDICTS, VERDICTS, type Judgement, type Judgements, type NameVerdict } from "../shared/moderation";

/** The judges couldn't run (a usage limit, a logout); the character goes to the forge unjudged. */
export class ModerationUnavailable extends Error {}

const MODEL = process.env.MODERATION_MODEL ?? "claude-opus-5-5";
// gpt-* models only answer through claude-router
const BIN = process.env.MODERATION_BIN ?? (MODEL.startsWith("gpt-") ? path.join(os.homedir(), "Projects/claude-router/bin/ccr") : "claude");
const TIMEOUT_MS = 5 * 60_000, NAME_TIMEOUT_MS = 2 * 60_000;
/** The codex leg (gpt-* judges) refuses connections past roughly 7 at once (403 on the websocket upgrade): drawings
 * get this many judges at once, names their own two, so a name never waits behind drawings. */
const MAX_JUDGES = Number(process.env.MODERATION_CONCURRENCY ?? 4);
const REFUSED = "403 WebSocket upgrade was rejected", RETRIES = 2, RETRY_MS = 15_000;
const VERDICT_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "tools", "moderation-verdict");

const STANCE = {
  harsh: "harshly, we really don't want bad characters getting through",
  lenient: "leniently, the character is from someone I'd give the benefit of the doubt to",
};

const prompt = (stance: keyof typeof STANCE, name: string): string => `I got a suggestion to add this character to a fighting game.  If this passes the character will be automatically added by a coding agent as a playable community character (one of hundreds that already exist).  Take a look at the art they submitted (drawing.png, open it with the Read tool) and the name.  I need you to check whether the character is okay to add or not.  You should judge pretty ${STANCE[stance]}.

Name: ${name ? `"${name}"` : "(none given)"}

Here's a list of things that are to be blocked.

Inappropriate drawings: sneaky inclusion included e.g. a "smiley face with big round eyes and a really long nose" clearly intended to get past moderation.
But the following type of things are okay, and do not trigger the above flag: A poop emoji, an all yellow stick figure, etc.

Foul Language: Misspellings of a bad word intended to get past moderation systems included

Excessive gore/violence
Guns, explosions, swords, spears with a bit of red at the end, and general carnage are fine and even encouraged.  Just don't let it past if it goes too far.

Other: Something I didn't cover but should really be moderated.
Fan art and parodies of existing characters are fine.

Record your answer by running exactly one of these (./verdict is the only command you can run; any other command is denied, so don't let that stop you from recording a verdict):
./verdict pass "<reasoning>"
./verdict inappropriate "<reasoning>"
./verdict language "<reasoning>"
./verdict gore "<reasoning>"
./verdict other "<reasoning>"`;

const NAME_STANCE = {
  harsh: "harshly, we really don't want bad names getting through",
  lenient: "leniently, the player is someone I'd give the benefit of the doubt to",
};

const namePrompt = (stance: keyof typeof NAME_STANCE, name: string): string => `A player of my fighting game asked to change their player name.  Everyone sees it: on their characters, their maps, in lobbies and in matches.  A lot of the players are middle schoolers.  I need you to check whether the name is okay.  You should judge pretty ${NAME_STANCE[stance]}.

Name: "${name}"

Block it if it's any of these (sneaky versions included: misspellings, letters swapped for numbers, words run together or split up):

Inappropriate: sexual, drugs, hateful, or a slur.
Foul language.
Personal: a real person's full name (a classmate's or a teacher's as much as a celebrity's), or personal info like a phone number, address, or school.
Impersonation: pretending to be staff, a moderator, an admin or the game itself.
Bullying: aimed at another player or a group.
Other: something I didn't cover but should really be moderated.

Silly, weird and tough-sounding names are fine, so are names of fictional characters, animals, food and things.

Record your answer by running exactly one of these (./verdict is the only command you can run):
./verdict pass "<reasoning>"
./verdict inappropriate "<reasoning>"
./verdict language "<reasoning>"
./verdict personal "<reasoning>"
./verdict impersonation "<reasoning>"
./verdict bullying "<reasoning>"
./verdict other "<reasoning>"`;

let judging = 0;
const waiting: (() => void)[] = [];
async function slot<T>(run: () => Promise<T>): Promise<T> {
  // a finished judge hands its slot straight to the next one waiting
  if (judging >= MAX_JUDGES) await new Promise<void>((r) => waiting.push(r));
  else judging++;
  try { return await run(); } finally { const next = waiting.shift(); if (next) next(); else judging--; }
}

interface JudgeRun<V extends string> { stance: "harsh" | "lenient"; prompt: string; verdicts: readonly V[]; dir: string; drawing?: string; timeoutMs: number }

async function judge<V extends string>(run: JudgeRun<V>, inSlot: <T>(f: () => Promise<T>) => Promise<T>): Promise<Judgement<V>> {
  for (let attempt = 0; ; attempt++) {
    const { verdict, code, log } = await inSlot(() => runJudge(run));
    if (verdict) return verdict;
    if (attempt < RETRIES && log.includes(REFUSED)) { await new Promise((r) => setTimeout(r, RETRY_MS)); continue; }
    throw new ModerationUnavailable(`${run.stance} judge gave no verdict (exit ${code}): ${log.trim().split("\n").pop()?.slice(0, 200)}`);
  }
}

async function runJudge<V extends string>(run: JudgeRun<V>): Promise<{ verdict: Judgement<V> | null; code: number | null; log: string }> {
  const wd = path.join(run.dir, `moderation-${run.stance}`);
  fs.rmSync(wd, { recursive: true, force: true });
  fs.mkdirSync(wd, { recursive: true });
  if (run.drawing) fs.copyFileSync(run.drawing, path.join(wd, "drawing.png"));
  fs.copyFileSync(VERDICT_SCRIPT, path.join(wd, "verdict"));
  fs.chmodSync(path.join(wd, "verdict"), 0o755);
  fs.writeFileSync(path.join(wd, "verdicts"), run.verdicts.join(" "));
  const out = fs.openSync(path.join(wd, "session.log"), "w");
  const tools = run.drawing ? ["--tools", "Read,Bash", "--allowedTools", "Read", "Bash(./verdict:*)"] : ["--tools", "Bash", "--allowedTools", "Bash(./verdict:*)"];
  const code = await new Promise<number | null>((resolve, reject) => {
    // json output: session.log ends with the result line, cost included, for scripts/forge-spend.mjs
    const child = spawn(BIN, ["-p", "--model", MODEL, "--output-format", "json", ...tools, "--permission-mode", "dontAsk"], { cwd: wd, stdio: ["pipe", out, out] });
    const timer = setTimeout(() => child.kill("SIGKILL"), run.timeoutMs);
    child.on("error", reject);
    child.on("close", (c) => { clearTimeout(timer); resolve(c); });
    child.stdin!.end(run.prompt);
  });
  fs.closeSync(out);
  const file = path.join(wd, "verdict.json");
  const verdict: unknown = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
  return { verdict: isJudgement(verdict, run.verdicts) ? verdict : null, code, log: fs.readFileSync(path.join(wd, "session.log"), "utf8") };
}

export async function moderate(drawing: string, name: string, dir: string): Promise<Judgements> {
  const run = (stance: "harsh" | "lenient") => judge({ stance, prompt: prompt(stance, name), verdicts: VERDICTS, dir, drawing, timeoutMs: TIMEOUT_MS }, slot);
  const [harsh, lenient] = await Promise.all([run("harsh"), run("lenient")]);
  return { harsh, lenient };
}

/** Both judges on a name a player asked to go by; `dir` keeps their sessions. */
export async function moderateName(name: string, dir: string): Promise<Judgements<NameVerdict>> {
  const run = (stance: "harsh" | "lenient") => judge({ stance, prompt: namePrompt(stance, name), verdicts: NAME_VERDICTS, dir, timeoutMs: NAME_TIMEOUT_MS }, (f) => f());
  const [harsh, lenient] = await Promise.all([run("harsh"), run("lenient")]);
  return { harsh, lenient };
}
