// A run's timeline as a PNG: one panel per player, its round trip over the match, the moments it was frozen in
// WAITING, and the network episodes the lab put on that player's own connection.
// Usage: node netlab/timeline.mjs <run dir>   (writes <run dir>/timeline.png; run.mjs calls it after every run)
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const W = 1400, PAD_L = 290, PAD_R = 24, PANEL_H = 120, STRIP_H = 14, GAP = 34, TOP = 96, RTT_MAX = 600;
const C = { surface: "#fcfcfb", ink: "#0b0b0b", ink2: "#52514e", muted: "#8a8984", grid: "#e6e5e1", rtt: "#2a78d6", frozen: "#d03b3b", spike: "#e4e2dc", blackout: "#bdbab1" };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export async function renderTimeline(runDir) {
  const report = JSON.parse(fs.readFileSync(path.join(runDir, "report.json"), "utf8"));
  const names = report.players.map((p) => p.name);
  const lab = report.lab[0];
  const spanMs = report.minutes * 60_000;
  const x = (ms) => PAD_L + (Math.min(ms, spanMs) / spanMs) * (W - PAD_L - PAD_R);
  const H = TOP + names.length * (PANEL_H + STRIP_H + GAP) + 20;
  const parts = [];
  const text = (tx, ty, s, o = {}) => parts.push(`<text x="${tx}" y="${ty}" font-size="${o.size ?? 13}" fill="${o.fill ?? C.ink2}" text-anchor="${o.anchor ?? "start"}" font-weight="${o.weight ?? 400}">${esc(s)}</text>`);

  text(24, 34, `netlab · ${report.scenario} · ${report.commit} · seed ${report.seed}`, { size: 20, fill: C.ink, weight: 600 });
  text(24, 58, `${lab.waitSPerMin} s/min frozen, ${lab.waitsPerMin} waits/min, longest ${lab.longestWaitMs} ms (lab, ${report.minutes} min)`, { size: 14 });
  // legend
  let lx = W - PAD_R - 560;
  const swatch = (kind, label) => {
    if (kind === "line") parts.push(`<line x1="${lx}" y1="${76}" x2="${lx + 18}" y2="${76}" stroke="${C.rtt}" stroke-width="2"/>`);
    else parts.push(`<rect x="${lx}" y="${70}" width="18" height="12" rx="2" fill="${kind}"/>`);
    text(lx + 24, 80, label); lx += 24 + label.length * 7 + 22;
  };
  swatch("line", "round trip (ms)"); swatch(C.frozen, "frozen (WAITING)"); swatch(C.spike, "wifi spike"); swatch(C.blackout, "blackout");

  names.forEach((name, i) => {
    const top = TOP + i * (PANEL_H + STRIP_H + GAP);
    const bottom = top + PANEL_H;
    const y = (rtt) => bottom - (Math.min(rtt, RTT_MAX) / RTT_MAX) * PANEL_H;
    const row = lab.players.find((p) => p.name === name);
    const player = report.players.find((p) => p.name === name);
    // episodes on this player's own link, both directions
    for (const dir of ["up", "down"]) for (const e of report.episodes[`${name}/${dir}`] ?? []) {
      parts.push(`<rect x="${x(e.atMs)}" y="${top}" width="${Math.max(1, x(e.endMs) - x(e.atMs))}" height="${PANEL_H}" fill="${e.type === "blackout" ? C.blackout : C.spike}"/>`);
    }
    for (const g of [0, 200, 400, 600]) {
      parts.push(`<line x1="${PAD_L}" x2="${W - PAD_R}" y1="${y(g)}" y2="${y(g)}" stroke="${C.grid}" stroke-width="1"/>`);
      text(PAD_L - 6, y(g) + 4, g === RTT_MAX ? `≥${g}` : g, { anchor: "end", size: 11, fill: C.muted });
    }
    const samples = report.timeline[name] ?? [];
    const pts = samples.filter((s) => s[3] > 0).map((s) => `${x(s[0]).toFixed(1)},${y(s[3]).toFixed(1)}`);
    if (pts.length) parts.push(`<polyline points="${pts.join(" ")}" fill="none" stroke="${C.rtt}" stroke-width="2" stroke-linejoin="round"/>`);
    // frozen strip under the plot
    const strip = bottom + 4;
    parts.push(`<rect x="${PAD_L}" y="${strip}" width="${W - PAD_L - PAD_R}" height="${STRIP_H}" fill="${C.grid}" opacity="0.5"/>`);
    let run = null;
    const flush = (end) => { if (run !== null) parts.push(`<rect x="${x(run)}" y="${strip}" width="${Math.max(1.5, x(end) - x(run))}" height="${STRIP_H}" fill="${C.frozen}"/>`); run = null; };
    for (const s of samples) { if (s[2] && run === null) run = s[0]; else if (!s[2]) flush(s[0]); }
    flush(samples.at(-1)?.[0] ?? 0);
    // who this player was frozen waiting on
    const on = {};
    for (const s of samples) if (s[2]) for (const n of (s[4] || "the game").split("+")) on[n] = (on[n] ?? 0) + 1;
    const total = Object.values(on).reduce((a, b) => a + b, 0);
    const onText = total ? Object.entries(on).sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n} ${Math.round((100 * c) / total)}%`).join(", ") : "nobody";
    text(24, top + 18, name, { size: 16, fill: C.ink, weight: 600 });
    text(24, top + 38, player.net);
    text(24, top + 58, row ? `${row.waitSPerMin} s/min frozen` : "no telemetry");
    text(24, top + 76, row ? `${row.waitsPerMin} waits/min` : "");
    // "waiting on X": X's input hadn't arrived, which is X's uplink or this player's own downlink
    text(24, top + 96, `missing input from: ${onText}`, { size: 12, fill: C.muted });
  });
  // time axis
  const axisY = H - 16;
  for (let s = 0; s <= report.minutes * 60; s += 30) text(x(s * 1000), axisY, `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`, { anchor: "middle", size: 11, fill: C.muted });

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="Inter, system-ui, sans-serif"><rect width="${W}" height="${H}" fill="${C.surface}"/>${parts.join("")}</svg>`;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1.5 });
    await page.setContent(`<body style="margin:0">${svg}</body>`);
    const out = path.join(runDir, "timeline.png");
    await page.screenshot({ path: out });
    return out;
  } finally { await browser.close(); }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2];
  if (!dir) throw new Error("usage: node netlab/timeline.mjs <run dir>");
  console.log(await renderTimeline(path.resolve(dir)));
}
