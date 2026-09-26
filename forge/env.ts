import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Fills process.env from forge/.env, then ~/.config/sketch-forge/env; variables already set win. */
export function loadForgeEnv(): void {
  for (const file of [new URL("./.env", import.meta.url).pathname, path.join(os.homedir(), ".config/sketch-forge/env")]) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const m = /^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
    }
  }
}
