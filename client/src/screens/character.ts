import { inkRect, PENCIL } from "../render/paper";
import type { ForgeStanding, LibraryEntry } from "../../../shared/account";
import { myLibrary } from "../fighters";
import { INK, title } from "./ui";
import { drawImageIn } from "./images";
import { wrapped } from "./text";
import { drawFighterPortrait } from "./portrait";
import { fighterLoad } from "../gen";
import { roster } from "../../../shared/fighters/index";
import { etaWords, forgeProgress } from "./forge-progress";

export const RED = "#c0392b";

export type ArtSource = Pick<LibraryEntry, "id" | "status" | "bundleUrl" | "drawingUrl">;

/**
 * The drawing, or once the forge is done the fighter itself idling (big enough, with the original
 * drawing pinned to its corner). Until its bundle has loaded, a ready character shows its drawing.
 */
const FADE_MS = 300, LOADING_ALPHA = 0.45;

/** How many rows below what's on screen a grid starts loading fighters, so they're ready when scrolled to. */
export const PRELOAD_ROWS = 2;

/** Starts loading a card's fighter without drawing it. */
export function preloadArt(ch: ArtSource): void {
  if (ch.status === "ready" && ch.bundleUrl) fighterLoad(ch.bundleUrl);
}

export function drawCharacterArt(ctx: CanvasRenderingContext2D, ch: ArtSource | null, x: number, y: number, size: number, t: number, picked = false): void {
  if (!ch) { drawImageIn(ctx, null, x, y, size, "—"); inkRect(ctx, x, y, size, size, PENCIL, 1.2); return; }
  const load = ch.status === "ready" && ch.bundleUrl ? fighterLoad(ch.bundleUrl) : null;
  const def = load?.state === "ready" ? roster[ch.id] : null;
  const loading = !!load && load.state === "loading";
  // while its fighter loads the card shows the drawing, faint, then the fighter fades in over it rather than popping
  const shown = def ? Math.min(1, (performance.now() - load!.readyAt) / FADE_MS) : 0;
  drawImageIn(ctx, null, x, y, size);
  if (shown < 1) {
    ctx.save();
    if (loading || def) ctx.globalAlpha *= LOADING_ALPHA * (1 - shown);
    drawImageIn(ctx, ch.drawingUrl, x, y, size, ch.status === "failed" ? "no drawing" : "");
    ctx.restore();
  }
  if (def) {
    const pad = size * 0.08;
    ctx.save();
    ctx.globalAlpha *= shown;
    drawFighterPortrait(ctx, def, `art@${Math.round(x)},${Math.round(y)}`, { x: x + pad, y: y + pad, w: size - pad * 2, h: size - pad * 2 }, { picked });
    ctx.restore();
  }
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
  if (ch.status === "generating" || ch.status === "queued" || loading) {
    // a pencil sweeping across while it's being made, or while its fighter loads
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

/** When the forge opens again, in the player's own time: "Friday at 11 AM". */
export function forgeOpens(at: number): string {
  const d = new Date(at);
  const time = d.toLocaleTimeString(undefined, d.getMinutes() ? { hour: "numeric", minute: "2-digit" } : { hour: "numeric" });
  return `${d.toLocaleDateString(undefined, { weekday: "long" })} at ${time}`;
}

function soon(at: number): string {
  const min = Math.max(1, Math.ceil((at - Date.now()) / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  return `${h} hour${h === 1 ? "" : "s"}`;
}

const characters = (n: number): string => `${n} new character${n === 1 ? "" : "s"}`;

/**
 * What the forge says to a player before they draw. `short` is one line (the title menu, the library); `title` and
 * `text` are the creator's. `blocked`: they can't send one now, and `text` says when they can.
 */
export function forgeWords(st: ForgeStanding): { title: string | null; text: string; short: string; blocked: boolean } {
  const rest = !st.resting ? "" : st.resting.reason ?? `They're back ${forgeOpens(st.resting.until!)}.`;
  const restShort = st.resting?.until ? `new characters are paused until ${forgeOpens(st.resting.until)}` : "new characters are paused";
  const signIn = `Sign in and you get ${characters(st.perPlayerPerDay)} every day.`;
  switch (st.wall) {
    case "day": return {
      title: "THAT'S TODAY'S CHARACTERS", blocked: true,
      text: `You've made your ${characters(st.allowance!)} for today${st.moreAt ? `. You get another in ${soon(st.moreAt)}` : ""}. Till then: battle, or find fighters to save in COMMUNITY.`,
      short: `no new characters left today${st.moreAt ? `: another in ${soon(st.moreAt)}` : ""}`,
    };
    case "guest": return { title: "SIGN IN FOR MORE", text: `Guests get ${st.allowance === 1 ? "one new character" : characters(st.allowance!)}. ${signIn}`, short: "sign in to draw more", blocked: true };
    case "network": return { title: "SIGN IN FOR MORE", text: `Guests here have made today's characters. ${signIn}`, short: "sign in to draw more", blocked: true };
    case "waiting": return {
      title: "NEW CHARACTERS ARE PAUSED", blocked: true,
      text: `${rest} ${st.waiting === 1 ? "Your drawing is" : "Your drawings are"} waiting in line.`,
      short: `${restShort}: yours is waiting`,
    };
    case null: break;
  }
  if (st.resting) return { title: "NEW CHARACTERS ARE PAUSED", text: `${rest} Draw one now and it'll be created ${st.resting.until ? "then" : "when they're back"}.`, short: restShort, blocked: false };
  const left = st.left === null ? "" : st.kind === "guest" ? `${characters(st.left)} left as a guest` : `${characters(st.left)} left today`;
  return { title: null, text: left, short: left, blocked: false };
}

/** What the forge is doing with it, in words; null once it's a fighter. */
export function characterStatus(ch: Pick<LibraryEntry, "status" | "stage" | "stageAt" | "error">, t: number): { text: string; color: string } | null {
  const dots = ".".repeat(1 + (Math.floor(t * 2) % 3));
  if (ch.status === "ready") return null;
  if (ch.status === "failed") return { text: ch.error ?? "couldn't be made", color: RED };
  if (ch.status === "queued") return { text: `${myLibrary.forge?.resting ? "Waiting in line" : forgeProgress(ch).label}${dots}`, color: PENCIL };
  return { text: `${forgeProgress(ch).label}${dots}`, color: INK };
}

/** One character as MY CHARACTERS shows it: the art, its name (or what the forge is doing) under it, a box when focused. */
export function drawCharacterCell(ctx: CanvasRenderingContext2D, e: ArtSource & Pick<LibraryEntry, "name" | "stage" | "stageAt" | "error">, x: number, y: number, size: number, t: number, focused: boolean): void {
  drawCharacterArt(ctx, e, x, y, size, t, focused);
  if (focused) {
    ctx.save(); ctx.strokeStyle = INK; ctx.lineWidth = Math.max(4, size / 40);
    ctx.strokeRect(x - 8, y - 8, size + 16, size + 16);
    ctx.restore();
  }
  const cx = x + size / 2, ty = y + size + Math.round(size * 0.16);
  const status = characterStatus(e, t);
  if (!status) { title(ctx, e.name ?? "?", cx, ty, Math.round(size * 0.136), INK, "center", size + 20); return; }
  const eta = e.status === "generating" ? forgeProgress(e).etaS : null;
  const lines = wrapped(ctx, e.status === "failed" ? "failed" : status.text, cx, ty, size + 20, Math.round(size * 0.096), status.color, eta === null ? 2 : 1);
  if (eta !== null) wrapped(ctx, etaWords(eta), cx, ty + lines + Math.round(size * 0.02), size + 20, Math.round(size * 0.08), PENCIL, 1);
}
