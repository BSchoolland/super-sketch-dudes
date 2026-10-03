import { inkRect, PENCIL } from "../render/paper";
import type { LibraryEntry } from "../../../shared/account";
import { INK, title } from "./ui";
import { drawImageIn } from "./images";
import { wrapped } from "./text";
import { drawFighterPortrait } from "./portrait";
import { fighterLoad } from "../gen";
import { roster } from "../../../shared/fighters/index";

export const RED = "#c0392b";

export type ArtSource = Pick<LibraryEntry, "id" | "status" | "bundleUrl" | "drawingUrl">;

/**
 * The drawing, or once the forge is done the fighter itself idling (big enough, with the original
 * drawing pinned to its corner). Until its bundle has loaded, a ready character shows its drawing.
 */
export function drawCharacterArt(ctx: CanvasRenderingContext2D, ch: ArtSource | null, x: number, y: number, size: number, t: number, picked = false): void {
  if (!ch) { drawImageIn(ctx, null, x, y, size, "—"); inkRect(ctx, x, y, size, size, PENCIL, 1.2); return; }
  const load = ch.status === "ready" && ch.bundleUrl ? fighterLoad(ch.bundleUrl) : null;
  const def = load?.state === "ready" ? roster[ch.id] : null;
  if (def) {
    drawImageIn(ctx, null, x, y, size);
    const pad = size * 0.08;
    drawFighterPortrait(ctx, def, `art@${Math.round(x)},${Math.round(y)}`, { x: x + pad, y: y + pad, w: size - pad * 2, h: size - pad * 2 }, { picked });
  } else drawImageIn(ctx, ch.drawingUrl, x, y, size, ch.status === "failed" ? "no drawing" : "");
  inkRect(ctx, x, y, size, size, INK, 1.6);
  if (def && size >= 200) {
    const inset = Math.round(size * 0.27);
    ctx.save();
    ctx.translate(x - size * 0.07, y - size * 0.07);
    ctx.rotate(-0.04);
    drawImageIn(ctx, ch.drawingUrl, 0, 0, inset);
    inkRect(ctx, 0, 0, inset, inset, INK, 1.6);
    ctx.restore();
  }
  if (ch.status === "generating" || ch.status === "queued") {
    // a pencil sweeping across while the forge works
    const band = size * 0.3, bx = x - band + ((t * 0.4) % 1) * (size + band);
    const g = ctx.createLinearGradient(bx, 0, bx + band, 0);
    g.addColorStop(0, "rgba(119,114,103,0)"); g.addColorStop(0.5, "rgba(119,114,103,0.16)"); g.addColorStop(1, "rgba(119,114,103,0)");
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, size, size); ctx.clip();
    ctx.fillStyle = g;
    ctx.fillRect(bx, y, band, size);
    ctx.restore();
  }
}

/**
 * The forge's steps as the player sees them: what's happening in plain words, and where on the
 * progress bar the step starts. Starts are the median share of the whole forge each step begins
 * at, from the forge worker's timestamps over real forges (about 280 s from claim to done: the poses
 * are drawn by ~45 s, the moves written by ~145 s, testing runs until ~260 s).
 */
const FORGE_STEPS: { stage: RegExp; label: string; start: number }[] = [
  { stage: /line/, label: "Waiting in line", start: 0 },
  { stage: /reading the drawing/, label: "Looking at your drawing", start: 0.005 },
  { stage: /agent is making it/, label: "Looking at your drawing", start: 0.01 },
  { stage: /designing the moves/, label: "Adding moves", start: 0.17 },
  { stage: /drawing the (sheet|animation)|designing the moveset/, label: "Animating your character", start: 0.02 },
  { stage: /cutting out/, label: "Animating your character", start: 0.1 },
  { stage: /writing the fighter/, label: "Finalizing attacks", start: 0.52 },
  { stage: /balance testing/, label: "Testing character", start: 0.55 },
  { stage: /final checks|upload/, label: "Finishing touches", start: 0.93 },
];

/** A typical forge from claim to done, in seconds: progress and ETAs pace each step against it. */
export const FORGE_S = 420;

/** When each forging character moved onto the step it's on, as this page saw it. */
const stepSince = new Map<string, { stage: string; at: number }>();

/**
 * Seconds until a forging character is likely done: what's left after the step it's on, plus
 * what's left of that step going by how long the page has watched it. Null unless it's being
 * forged: waiting in line has no honest ETA.
 */
export function forgeEta(e: Pick<LibraryEntry, "id" | "status" | "stage">): number | null {
  if (e.status !== "generating") return null;
  const stage = e.stage || "reading the drawing";
  const now = performance.now() / 1000;
  let seen = stepSince.get(e.id);
  if (!seen || seen.stage !== stage) { seen = { stage, at: now }; stepSince.set(e.id, seen); }
  const step = forgeStep(stage);
  const inStep = (step.end - step.start) * FORGE_S - (now - seen.at);
  return (1 - step.end) * FORGE_S + Math.max(inStep, 5);
}

/** An ETA in words: "about 3 min left", "under a minute left". */
export function etaWords(s: number): string {
  return s < 60 ? "under a minute left" : `about ${Math.round(s / 60)} min left`;
}

/** Where a forge stage sits: its words, and the progress-bar span it covers. */
export function forgeStep(stage: string): { label: string; start: number; end: number } {
  const i = FORGE_STEPS.findIndex((s) => s.stage.test(stage));
  if (i < 0) return { label: stage, start: 0, end: 0.05 };
  const start = FORGE_STEPS[i].start;
  const end = Math.min(1, ...FORGE_STEPS.filter((s) => s.start > start).map((s) => s.start));
  return { label: FORGE_STEPS[i].label, start, end };
}

/** What the forge is doing with it, in words; null once it's a fighter. */
export function characterStatus(ch: Pick<LibraryEntry, "status" | "stage" | "error">, t: number): { text: string; color: string } | null {
  const dots = ".".repeat(1 + (Math.floor(t * 2) % 3));
  if (ch.status === "ready") return null;
  if (ch.status === "failed") return { text: ch.error ?? "couldn't be made", color: RED };
  if (ch.status === "queued") return { text: `${forgeStep(ch.stage || "waiting in line").label}${dots}`, color: PENCIL };
  return { text: `${forgeStep(ch.stage || "reading the drawing").label}${dots}`, color: INK };
}

/** One character as MY CHARACTERS shows it: the art, its name (or what the forge is doing) under it, a box when focused. */
export function drawCharacterCell(ctx: CanvasRenderingContext2D, e: ArtSource & Pick<LibraryEntry, "name" | "stage" | "error">, x: number, y: number, size: number, t: number, focused: boolean): void {
  drawCharacterArt(ctx, e, x, y, size, t, focused);
  if (focused) {
    ctx.save(); ctx.strokeStyle = INK; ctx.lineWidth = Math.max(4, size / 40);
    ctx.strokeRect(x - 8, y - 8, size + 16, size + 16);
    ctx.restore();
  }
  const cx = x + size / 2, ty = y + size + Math.round(size * 0.16);
  const status = characterStatus(e, t);
  if (!status) { title(ctx, e.name ?? "?", cx, ty, Math.round(size * 0.136), INK, "center", size + 20); return; }
  const eta = forgeEta(e);
  const lines = wrapped(ctx, e.status === "failed" ? "failed" : status.text, cx, ty, size + 20, Math.round(size * 0.096), status.color, eta === null ? 2 : 1);
  if (eta !== null) wrapped(ctx, etaWords(eta), cx, ty + lines + Math.round(size * 0.02), size + 20, Math.round(size * 0.08), PENCIL, 1);
}
