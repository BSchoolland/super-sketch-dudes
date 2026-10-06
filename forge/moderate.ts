// The auto moderator: two judges, one harsh and one lenient, look at a drawing and its name before the forge does.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isJudgement, type Judgement, type Judgements } from "../shared/moderation";

/** The judges couldn't run (the codex pool is out or logged out); the character goes to the forge unjudged. */
export class ModerationUnavailable extends Error {}

const MODEL = process.env.MODERATION_MODEL ?? "claude-opus-5-5";
// gpt-* models only answer through claude-router
const BIN = process.env.MODERATION_BIN ?? (MODEL.startsWith("gpt-") ? path.join(os.homedir(), "Projects/claude-router/bin/ccr") : "claude");
const TIMEOUT_MS = 5 * 60_000;
/** The codex leg (gpt-* judges) refuses connections past roughly 7 at once (403 on the websocket upgrade). */
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

let judging = 0;
const waiting: (() => void)[] = [];
async function slot<T>(run: () => Promise<T>): Promise<T> {
  // a finished judge hands its slot straight to the next one waiting
  if (judging >= MAX_JUDGES) await new Promise<void>((r) => waiting.push(r));
  else judging++;
  try { return await run(); } finally { const next = waiting.shift(); if (next) next(); else judging--; }
}

async function judge(stance: keyof typeof STANCE, drawing: string, name: string, dir: string): Promise<Judgement> {
  for (let attempt = 0; ; attempt++) {
    const { verdict, code, log } = await slot(() => runJudge(stance, drawing, name, dir));
    if (verdict) return verdict;
    if (attempt < RETRIES && log.includes(REFUSED)) { await new Promise((r) => setTimeout(r, RETRY_MS)); continue; }
    throw new ModerationUnavailable(`${stance} judge gave no verdict (exit ${code}): ${log.trim().split("\n").pop()?.slice(0, 200)}`);
  }
}

async function runJudge(stance: keyof typeof STANCE, drawing: string, name: string, dir: string): Promise<{ verdict: Judgement | null; code: number | null; log: string }> {
  const wd = path.join(dir, `moderation-${stance}`);
  fs.rmSync(wd, { recursive: true, force: true });
  fs.mkdirSync(wd, { recursive: true });
  fs.copyFileSync(drawing, path.join(wd, "drawing.png"));
  fs.copyFileSync(VERDICT_SCRIPT, path.join(wd, "verdict"));
  fs.chmodSync(path.join(wd, "verdict"), 0o755);
  const out = fs.openSync(path.join(wd, "session.log"), "w");
  const code = await new Promise<number | null>((resolve, reject) => {
    // json output: session.log ends with the result line, cost included, for scripts/forge-spend.mjs
    const child = spawn(BIN, ["-p", "--model", MODEL, "--output-format", "json", "--tools", "Read,Bash", "--allowedTools", "Read", "Bash(./verdict:*)", "--permission-mode", "dontAsk"], { cwd: wd, stdio: ["pipe", out, out] });
    const timer = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS);
    child.on("error", reject);
    child.on("close", (c) => { clearTimeout(timer); resolve(c); });
    child.stdin!.end(prompt(stance, name));
  });
  fs.closeSync(out);
  const file = path.join(wd, "verdict.json");
  const verdict: unknown = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
  return { verdict: isJudgement(verdict) ? verdict : null, code, log: fs.readFileSync(path.join(wd, "session.log"), "utf8") };
}

export async function moderate(drawing: string, name: string, dir: string): Promise<Judgements> {
  const [harsh, lenient] = await Promise.all([judge("harsh", drawing, name, dir), judge("lenient", drawing, name, dir)]);
  return { harsh, lenient };
}
