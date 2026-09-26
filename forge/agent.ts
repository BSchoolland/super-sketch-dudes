import { spawn } from "node:child_process";

export const AGENT_MODEL = "claude-opus-5-5";
const TIMEOUT_MS = 4 * 60_000;

export interface Tokens { input: number; output: number; cacheRead: number; cacheWrite: number }
export interface AgentResult { sessionId: string; result: string; tokens: Tokens; ms: number }

export const noTokens = (): Tokens => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
export function addTokens(a: Tokens, b: Tokens): Tokens {
  return { input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead, cacheWrite: a.cacheWrite + b.cacheWrite };
}

/** One `claude -p` turn in `cwd`. The prompt goes over stdin; `resume` continues an earlier session. */
export function runAgent(prompt: string, cwd: string, resume?: string): Promise<AgentResult> {
  const args = ["-p", "--model", AGENT_MODEL, "--output-format", "json", "--allowedTools", "Read,Write", "--permission-mode", "acceptEdits"];
  if (resume) args.push("--resume", resume);
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "", timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, TIMEOUT_MS);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) return reject(new Error(`claude -p timed out after ${TIMEOUT_MS / 1000}s`));
      let j: any;
      try { j = JSON.parse(out); } catch { return reject(new Error(`claude -p exited ${code} without JSON: ${(err || out).trim().slice(-400)}`)); }
      if (j.is_error || code !== 0) return reject(new Error(`claude -p failed (${j.subtype ?? code}): ${String(j.result ?? err).slice(0, 400)}`));
      const u = j.usage ?? {};
      resolve({
        sessionId: j.session_id,
        result: String(j.result ?? ""),
        tokens: { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 },
        ms: Date.now() - t0,
      });
    });
    child.stdin.end(prompt);
  });
}
