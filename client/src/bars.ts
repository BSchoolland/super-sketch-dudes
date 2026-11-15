import { aboutOpen } from "./about";
import { mobileNote } from "./mobilenote";
import { site } from "./base";
import { inMatch } from "./input/touch";
import { everywhere, sessionList } from "./telemetry/events";
import { turnUpright, turned } from "./turn";

/**
 * The browser's bars out of the game's way on phones and tablets (the website only, never inside another page).
 * Held upright, the game is drawn turned (turn.ts). Android and iPads have a Fullscreen API: a tap on the game
 * outside a match goes fullscreen and locks landscape. An iPhone's browsers have none, and their bars collapse only
 * when a finger scrolls the page: there the page is taller than the screen, a "swipe" card covers the game until the
 * viewport has grown, and after that nothing but the about sections may scroll the page, or the bars come back. From
 * the home screen (the manifest, apple-mobile-web-app-capable) there are no bars at all.
 */
const IPHONE = /iPhone|iPod/.test(navigator.userAgent);
const root = document.documentElement;
/** How long the card waits before offering a way past it, for a browser whose bars a swipe doesn't move. */
const PATIENCE_MS = 6000;
/** Bars back this soon after tucking count as a bounce; some browsers (the Google app) won't keep them down, and the card retires after two. */
const BOUNCE_MS = 1500, BOUNCES = 2;

let started = false;

function note(...entry: unknown[]): void {
  sessionList("bars", [...entry, Math.round(performance.now() / 100) / 10], 30);
}

function standalone(): boolean {
  return matchMedia("(display-mode: standalone)").matches || matchMedia("(display-mode: fullscreen)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

export function startBars(canvas: HTMLCanvasElement): void {
  if (started) throw new Error("startBars ran twice");
  started = true;
  // embedded (a game portal's iframe), the page around the game owns the screen
  if (window.top !== window.self) return;
  if (!matchMedia("(pointer: coarse)").matches) return;
  root.classList.add("handheld");
  turnUpright();
  mobileNote();
  // only here: a desktop browser offered to install the site would be a change on the desktop
  const manifest = document.createElement("link");
  manifest.rel = "manifest";
  manifest.href = `${site.base}manifest.webmanifest`;
  document.head.append(manifest);
  if (standalone()) { note("standalone"); return; }
  if (IPHONE) swipeGate();
  else fullscreenOnTap(canvas);
}

type Prefixed = HTMLElement & { webkitRequestFullscreen?: () => void };

function fullscreenOnTap(canvas: HTMLCanvasElement): void {
  const el = root as Prefixed;
  const request = el.requestFullscreen ? () => el.requestFullscreen() : el.webkitRequestFullscreen ? () => { el.webkitRequestFullscreen!(); return Promise.resolve(); } : null;
  if (!request) { note("no fullscreen api"); return; }
  note("fullscreen");
  const fullscreen = () => document.fullscreenElement ?? (document as { webkitFullscreenElement?: Element | null }).webkitFullscreenElement ?? null;
  const refused = (error: unknown) => everywhere("warn", "fullscreen", `fullscreen refused: ${error instanceof Error ? error.message : String(error)}`);
  document.addEventListener("webkitfullscreenerror", refused);
  // A finger lifting is a user gesture. Never mid-match, where the layout would jump under the thumbs, and not when
  // the tap opened the about sections: they're a web page, and fullscreen Chrome won't let a reader zoom them. The
  // title opens them on its next frame, so the request waits for that (inside the gesture's few seconds).
  canvas.addEventListener("pointerup", (e) => {
    if (e.pointerType !== "touch" || fullscreen() || inMatch() || aboutOpen()) return;
    setTimeout(() => {
      if (fullscreen() || aboutOpen()) return;
      request().then(() => {
        note("fullscreen on");
        const orientation = screen.orientation as ScreenOrientation & { lock?: (o: "landscape") => Promise<void> };
        // iPads have no orientation lock
        return orientation.lock?.("landscape").catch((error: unknown) => everywhere("warn", "landscape", `landscape lock refused: ${error instanceof Error ? error.message : String(error)}`));
      }, refused);
    }, 100);
  });
  // opened from fullscreen, the sections leave it, and land where the taller page now has them
  const doc = document as Document & { webkitExitFullscreen?: () => void };
  const exit = doc.exitFullscreen ? () => doc.exitFullscreen() : () => { doc.webkitExitFullscreen!(); return Promise.resolve(); };
  let leaving = false;
  window.addEventListener("scroll", () => {
    if (leaving || !aboutOpen() || !fullscreen()) return;
    leaving = true;
    exit().then(
      () => document.getElementById("about")!.scrollIntoView({ block: "start" }),
      (error: unknown) => everywhere("warn", "fullscreen", `leaving fullscreen failed: ${error instanceof Error ? error.message : String(error)}`),
    ).finally(() => { leaving = false; });
  }, { passive: true });
}

function gateCard(): { gate: HTMLElement; way: HTMLElement; through: HTMLButtonElement } {
  const gate = document.createElement("div");
  gate.id = "swipe";
  gate.hidden = true;
  gate.innerHTML = `<div><svg viewBox="0 0 60 96" aria-hidden="true"><path d="M30.5 88 C29 70 31.5 52 29.6 34 C29.2 27 30.4 20 30 12"/><path d="M12.5 31.5 C19 25 24.5 18.5 30 11.5 C35.5 18 41 24.5 47.5 30.5"/></svg><b>SWIPE <span>UP</span> TO PLAY</b><small>it tucks the browser bars away</small><button type="button" hidden>tap to play anyway</button></div>`;
  document.body.append(gate);
  return { gate, way: gate.querySelector("span")!, through: gate.querySelector("button")! };
}

function swipeGate(): void {
  note("swipe");
  root.classList.add("swipe");
  const { gate, way, through } = gateCard();
  let shownAt = 0, tuckedAt = -Infinity, bounces = 0, gaveUp = false;
  /** The viewport's height with the bars out, at this width: a browser whose bars collapse to a strip never reaches the screen's. */
  let low = { w: 0, h: 0 };
  const typing = () => document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement;

  function update(): void {
    const w = innerWidth, h = innerHeight;
    // the keyboard shrinks the viewport too; that's not the bars
    if (!typing() && (low.w !== w || h < low.h)) low = { w, h };
    // upright, the status bar stays, and so does a strip of the browser's
    const full = w > h ? Math.min(screen.width, screen.height) - 24 : Math.max(screen.width, screen.height) - 110;
    const tucked = h >= full || h >= low.h + 40;
    // never over a match: one that came back mid-match (a turn of the phone) waits for the match to end
    const show = !tucked && !typing() && !aboutOpen() && !gaveUp && !inMatch();
    // turned with the game, the finger's swipe up the screen runs to the game's left
    way.textContent = turned() ? "LEFT" : "UP";
    if (show && gate.hidden && performance.now() - tuckedAt < BOUNCE_MS && ++bounces >= BOUNCES) {
      gaveUp = true;
      note("bars bounce back", w, h);
      return;
    }
    if (show && gate.hidden) {
      gate.hidden = false;
      shownAt = performance.now();
      // the swipe needs room to scroll
      window.scrollTo({ top: 0, behavior: "instant" });
      note("gate", w, h, screen.width, screen.height);
    } else if (!show && !gate.hidden) {
      gate.hidden = true;
      if (tucked) tuckedAt = performance.now();
      note(tucked ? "tucked" : gaveUp ? "gave up" : "gate down", w, h);
    }
    through.hidden = !(show && performance.now() - shownAt > PATIENCE_MS);
  }

  through.addEventListener("click", () => { gaveUp = true; update(); });
  for (const type of ["resize", "scroll", "orientationchange", "focusin", "focusout"]) window.addEventListener(type, update, { passive: true });
  window.visualViewport?.addEventListener("resize", update);
  // the about sections open and close, the escape appears, a browser that resizes late
  setInterval(update, 500);
  update();

  // Once the bars are tucked, the page must not scroll again or they come back: no finger moves anything but the
  // gate's swipe, the about sections, or a text box with more to show. That goes for pinches too.
  const hold = (e: Event) => {
    if (!gate.hidden || aboutOpen()) return;
    const t = e.target;
    if (e.type === "touchmove" && t instanceof HTMLTextAreaElement && t.scrollHeight > t.clientHeight) return;
    if (e.cancelable) e.preventDefault();
  };
  document.addEventListener("touchmove", hold, { passive: false });
  document.addEventListener("gesturestart", hold, { passive: false });
}
