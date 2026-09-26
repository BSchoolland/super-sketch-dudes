// Drives a 2-player, 1-round DRAW BATTLE against a running server and waits for the forge to finish both characters.
// Usage: node scripts/draw-e2e.mjs <site e.g. http://localhost:3011/sketch-battle> <password> <a.png> <b.png>
import { readFileSync } from "node:fs";
import WebSocket from "ws";

const [site, password, pngA, pngB] = process.argv.slice(2);
const wsUrl = site.replace(/^http/, "ws") + "/ws";
const origin = new URL(site).origin;

class Peer {
  constructor(name) {
    this.name = name; this.inbox = []; this.draw = null;
    this.ws = new WebSocket(wsUrl);
    this.ws.on("message", (m) => { const j = JSON.parse(String(m)); if (j.t === "draw") this.draw = j.room; if (j.t === "error") console.log(`${name}: error ${j.error}`); this.inbox.push(j); });
  }
  open() { return new Promise((r, x) => { this.ws.once("open", r); this.ws.once("error", x); }); }
  send(m) { this.ws.send(JSON.stringify(m)); }
  async until(pred, ms, what) {
    const t0 = Date.now();
    while (!pred()) { if (Date.now() - t0 > ms) throw new Error(`${this.name}: timed out waiting for ${what}`); await new Promise((r) => setTimeout(r, 50)); }
  }
}

const a = new Peer("Ann"), b = new Peer("Bob");
await a.open(); await b.open();
for (const p of [a, b]) p.send({ t: "drawAuth", password });
await a.until(() => a.inbox.some((m) => m.t === "drawAuth" && m.ok), 3000, "auth");
const dev = async (name) => (await (await fetch(`${site}/api/auth/dev`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) })).json()).session;
a.send({ t: "drawCreate", session: await dev("Ann") });
await a.until(() => a.draw, 3000, "room");
b.send({ t: "drawJoin", code: a.draw.code, session: await dev("Bob") });
await a.until(() => a.draw.players.length === 2, 3000, "join");
a.send({ t: "drawStart", rounds: 1, drawSeconds: 20 });
await a.until(() => a.draw.phase === "draw", 3000, "draw phase");
const dataUrl = (f) => `data:image/png;base64,${readFileSync(f).toString("base64")}`;
a.send({ t: "drawSubmit", round: 1, png: dataUrl(pngA) });
b.send({ t: "drawSubmit", round: 1, png: dataUrl(pngB) });
await a.until(() => a.draw.phase === "reveal", 30000, "reveal");
console.log(`room ${a.draw.code}: both drawings in, waiting for the forge`);

const t0 = Date.now();
let last = "";
await a.until(() => {
  const line = a.draw.players.map((p) => `${p.name}: ${p.characters[0].status} ${p.characters[0].stage}`).join(" | ");
  if (line !== last) { console.log(`${((Date.now() - t0) / 1000).toFixed(0).padStart(4)}s ${line}`); last = line; }
  return a.draw.players.every((p) => ["ready", "failed"].includes(p.characters[0].status));
}, 15 * 60_000, "both characters to settle");

let ok = true;
for (const p of a.draw.players) {
  const ch = p.characters[0];
  if (ch.status !== "ready") { console.log(`${p.name}: FAILED ${ch.error}`); ok = false; continue; }
  const bundle = await (await fetch(origin + ch.bundleUrl)).json();
  const cells = await Promise.all(Object.values(bundle.sprite.cells).map((u) => fetch(origin + u).then((r) => r.status)));
  console.log(`${p.name}: ${ch.name} "${ch.tagline}" bundle ${ch.bundleUrl} (${bundle.source.length} chars, cells ${cells.join(",")})`);
  if (cells.some((s) => s !== 200)) ok = false;
}
a.ws.close(); b.ws.close();
process.exit(ok ? 0 : 1);
