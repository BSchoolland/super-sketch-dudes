import "./style.css";
import { LocalMatch } from "./match";
import { Renderer } from "./render/render";
import { VIEW_H, VIEW_W } from "./render/camera";
import { drawBanner, SLOT_COLORS } from "./render/hud";
import { connectedPads, endInputFrame } from "./input/devices";
import { roster } from "../../shared/fighters/index";

const canvas = document.getElementById("game") as HTMLCanvasElement;
const ctx = canvas.getContext("2d", { alpha: false })!;
let scale = 1, offX = 0, offY = 0;
function resize(): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = window.innerWidth, h = window.innerHeight;
  canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr);
  scale = Math.min(w / VIEW_W, h / VIEW_H) * dpr;
  offX = (canvas.width - VIEW_W * scale) / 2;
  offY = (canvas.height - VIEW_H * scale) / 2;
}
window.addEventListener("resize", resize);
resize();

// Quick-start harness while the screens are being built: P1 keyboard 1 (or pad 0), P2 CPU or keyboard 2.
const params = new URLSearchParams(location.search);
const p2 = params.get("p2") ?? "cpu";
const cpuLevel = Number(params.get("cpu") ?? 6);
const fighters = (params.get("f") ?? "sable,sable").split(",");
const pads = connectedPads();
const match = new LocalMatch(
  { stage: params.get("stage") ?? "proving", players: fighters.map((f, i) => ({ fighter: roster[f] ? f : "sable", cpu: i === 1 && p2 === "cpu" ? cpuLevel : 0 })), seed: Number(params.get("seed") ?? 1) },
  fighters.map((_, i) => (i === 0 ? { device: pads.length ? `pad${pads[0]}` as const : "kb1", cpu: 0 } : i === 1 && p2 === "cpu" ? { device: null, cpu: cpuLevel } : { device: i === 1 ? (pads.length > 1 ? `pad${pads[1]}` as const : "kb2") : null, cpu: i > 1 ? cpuLevel : 0 })),
);
const renderer = new Renderer(match.state, fighters.map((_, i) => (match.sources[i].cpu ? `CPU` : `P${i + 1}`)));
renderer.showHitboxes = params.get("boxes") === "1";
window.addEventListener("keydown", (e) => { if (e.code === "F2") { renderer.showHitboxes = !renderer.showHitboxes; e.preventDefault(); } });

const STEP = 1000 / 60;
let acc = 0, last = performance.now();
let bannerT = 0;
function frame(now: number): void {
  const dtMs = Math.min(100, now - last);
  last = now;
  const slow = match.state.slowmo > 0 ? 0.25 : 1;
  acc += dtMs * slow;
  let stepped = 0;
  while (acc >= STEP && stepped < 4) {
    if (match.tick()) renderer.snapshot(match.state);
    acc -= STEP;
    stepped++;
  }
  endInputFrame();
  renderer.fx.consume(match.state, match.takeEvents(), renderer.cam);
  const alpha = match.paused ? 1 : Math.min(1, acc / STEP);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(scale, 0, 0, scale, offX, offY);
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, VIEW_W, VIEW_H); ctx.clip();
  renderer.draw(ctx, match.state, alpha, dtMs / 1000);
  if (match.state.ended) {
    bannerT += dtMs / 1000;
    const w = match.state.winner;
    drawBanner(ctx, w >= 0 ? "GAME!" : "DRAW", w >= 0 ? `${renderer.names[w]} wins` : "", w >= 0 ? SLOT_COLORS[w] : "#fff", bannerT);
  } else if (match.paused) {
    drawBanner(ctx, "PAUSED", "", "#fff", 1);
  }
  ctx.restore();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// debug handle
(window as any).ringout = { match, renderer };
