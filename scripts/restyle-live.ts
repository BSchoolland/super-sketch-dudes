// Restyles live characters and publishes each as a new version of itself: download its bundle and cells, run
// forge/restyle.ts (which keeps the result only if it plays the same on every frame), study it for the CPU, and
// POST it to /api/characters/:id/source. Four at a time.
// Usage: npx tsx scripts/restyle-live.ts <outdir> <fighterId>=<bundleUrl> ... [--dry]   (--dry: restyle, don't publish)
// SITE and FORGE_TOKEN come from the forge's env (forge/env.ts).
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { loadForgeEnv } from "../forge/env";

loadForgeEnv();
const args = process.argv.slice(2);
const dry = args.includes("--dry");
const [outRoot, ...pairs] = args.filter((a) => a !== "--dry");
const site = process.env.SITE, token = process.env.FORGE_TOKEN;
if (!outRoot || !pairs.length || !pairs.every((p) => p.includes("="))) { console.error("usage: npx tsx scripts/restyle-live.ts <outdir> <fighterId>=<bundleUrl> ... [--dry]"); process.exit(2); }
if (!site || !token) throw new Error("SITE and FORGE_TOKEN must be set (~/.config/sketch-forge/env)");
const origin = new URL(site).origin;

const get = async (url: string): Promise<Buffer> => {
  const r = await fetch(new URL(url, origin));
  if (!r.ok) throw new Error(`GET ${url}: HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
};
const run = (cmd: string, a: string[], log: string): Promise<void> => new Promise((resolve, reject) => {
  const out = fs.openSync(log, "a");
  const child = spawn(cmd, a, { stdio: ["ignore", out, out] });
  child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`${cmd} ${a[1] ?? ""} exited ${code}; see ${log}`)));
});

async function restyle(id: string, bundleUrl: string): Promise<string> {
  const dir = path.resolve(outRoot, id), src = path.join(dir, "live");
  fs.mkdirSync(src, { recursive: true });
  const bundle = JSON.parse((await get(bundleUrl)).toString("utf8"));
  const sp = bundle.sprite;
  for (const [c, url] of Object.entries(sp.cells as Record<string, string>)) fs.writeFileSync(path.join(src, `${c}.png`), await get(url));
  fs.writeFileSync(path.join(src, "cells.json"), JSON.stringify({ px: sp.px, feetPx: sp.feetPx, heightPx: sp.heightPx, cells: Object.fromEntries(Object.keys(sp.cells).map((c) => [c, {}])) }));
  fs.writeFileSync(path.join(src, "bundle.json"), JSON.stringify(bundle));
  const log = path.join(dir, "restyle.log");
  await run("npx", ["tsx", "forge/restyle.ts", path.join(src, "bundle.json"), path.join(dir, "out")], log);
  const restyled = { ...bundle, source: fs.readFileSync(path.join(dir, "out", "fighter.js"), "utf8"), cpu: undefined };
  const file = path.join(dir, "restyled-bundle.json");
  fs.writeFileSync(file, JSON.stringify(restyled));
  await run("npx", ["tsx", "forge/tools/study.ts", file], log);
  if (dry) return "restyled (not published)";
  const { source, cpu } = JSON.parse(fs.readFileSync(file, "utf8"));
  const r = await fetch(`${site}/api/characters/${id}/source`, { method: "POST", headers: { "content-type": "application/json", "x-forge-token": token! }, body: JSON.stringify({ source, cpu }) });
  if (!r.ok) throw new Error(`publish: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  const { character } = await r.json();
  return `published ${character.bundleUrl}`;
}

const queue = pairs.map((p) => { const i = p.indexOf("="); return [p.slice(0, i), p.slice(i + 1)] as const; });
const results: string[] = [];
await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
  for (let next = queue.shift(); next; next = queue.shift()) {
    const [id, url] = next, t0 = Date.now();
    const line = await restyle(id, url).then((r) => `${id}: ${r}`, (e: Error) => `${id}: FAILED ${e.message}`);
    results.push(`${line} (${((Date.now() - t0) / 60000).toFixed(1)} min)`);
    console.log(results[results.length - 1]);
  }
}));
fs.writeFileSync(path.join(outRoot, "results.txt"), results.join("\n") + "\n");
