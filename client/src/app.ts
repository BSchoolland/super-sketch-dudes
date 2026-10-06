import { setSpriteScale } from "./render/sprite";
import { FramePacer } from "./render/pacing";
import "./style.css";
import { VIEW_H, VIEW_W } from "./render/camera";
import { PAPER } from "./render/paper";
import { connectedPads, endInputFrame, readMenu, type DeviceId } from "./input/devices";
import { attachPointer, endPointerFrame, endPointerTick, setPointerTransform } from "./input/pointer";
import { OnlineScreen } from "./screens/online";
import { NetVersusScreen } from "./screens/netversus";
import { VersusScreen } from "./screens/versus";
import { SheetScreen } from "./screens/sheet";
import { SignInScreen } from "./screens/signin";
import { menus, signInScreen } from "./screens/flow";
import { loadSettings, settings, takeHandoff, type Screen } from "./screens/ui";
import { music, setMusicVolume, setVolume } from "./audio/audio";
import { classTime, watchClassTime } from "./classtime";
import { ClassScreen, FeedbackScreen, SketchScreen } from "./screens/classtime";
import { FeedbackDetailScreen, FeedbackListScreen } from "./screens/feedbacklist";
import { everywhere, noteScreen, noteView, sessionTrace, startTelemetry } from "./telemetry/events";
import { loadGeneratedFighter } from "./gen";
import { devSignIn, finishSignIn, loadAccount, markPlayed, signedIn, unfinishedSignIn } from "./account";
import { forgetLibrary } from "./fighters";
import { forgetMaps } from "./maps";
import { loadFighters, quickMatch } from "./quick";
import { site, setSiteBase } from "./base";
import { swap, type Handoff } from "./handoff";

export interface MountOptions {
  canvas: HTMLCanvasElement;
  /** URL prefix of the site (its /api and /ws), e.g. "/sketch-battle/". */
  base: string;
  params: URLSearchParams;
  /** This bundle's hash, "" for the classic single-build page. */
  hash?: string;
  /** Called when the room switches bundles: load `hash` and mount it with `handoff`. */
  swap?: (hash: string, handoff: Handoff) => void;
  /** Continue where another bundle left off. */
  resume?: Handoff;
}
export interface AppController {
  stop(): void;
  readonly screen: Screen;
}

/**
 * The whole game, mountable on a canvas. index.html mounts it once; shell.html mounts whichever
 * bundle the room is on and remounts the next one, mid-match, when the room switches.
 */
export async function mount(opts: MountOptions): Promise<AppController> {
  setSiteBase(opts.base);
  swap.hash = opts.hash ?? "";
  const shellSwap = opts.swap;
  if (shellSwap) swap.request = (hash, handoff) => shellSwap(hash, { ...handoff, session: sessionTrace() });
  const canvas = opts.canvas;
  const stopTelemetry = startTelemetry({ canvas, bundle: swap.hash, continues: opts.resume?.session });
  const stopClassTime = watchClassTime();
  loadSettings();
  setVolume(settings.volume);
  setMusicVolume(settings.music);

  const ctx = canvas.getContext("2d", { alpha: false })!;
  let scale = 1, offX = 0, offY = 0;
  const pacer = new FramePacer(() => resize());
  function resize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1) * pacer.quality;
    const w = window.innerWidth, h = window.innerHeight;
    canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr);
    scale = Math.min(w / VIEW_W, h / VIEW_H) * dpr;
    offX = (canvas.width - VIEW_W * scale) / 2;
    offY = (canvas.height - VIEW_H * scale) / 2;
    setPointerTransform(scale / dpr, offX / dpr, offY / dpr);
    setSpriteScale(scale);
    noteView({ w, h, dpr, canvasW: canvas.width, canvasH: canvas.height, scale, quality: pacer.quality });
  }
  const detachPointer = attachPointer(canvas);
  window.addEventListener("resize", resize);
  resize();

  function allDevices(): DeviceId[] {
    return ["kb1", "kb2", ...connectedPads().map((i) => `pad${i}` as DeviceId)];
  }

  const nav = menus();
  const params = opts.params;
  // back from Discord or Google (a token, a refusal, or nothing: the trip died), or ?dev=<name> against a DEV_LOGIN server
  const restored = loadAccount();
  let signInError = "", fresh = false;
  try { fresh = await finishSignIn(); } catch (error) { console.error(error); signInError = error instanceof Error ? error.message : String(error); }
  const unfinished = unfinishedSignIn();
  if (unfinished) { everywhere("warn", "sign-in", unfinished); signInError = unfinished; }
  if (!signedIn() && params.get("dev")) await devSignIn(params.get("dev")!);
  // a fresh sign-in already told the server; a 401 here signs a stale session out
  if (restored && !fresh) await markPlayed().catch((error: unknown) => everywhere("warn", "played", `marking this visit failed: ${error instanceof Error ? error.message : String(error)}`));
  const home = (): Screen => (signedIn() ? nav.title() : signInScreen(nav, signInError));

  // ?gen=<bundle url>[,<bundle url>] loads drawn fighters before the quick start / sheet below.
  for (const u of (params.get("gen") ?? "").split(",").filter(Boolean)) await loadGeneratedFighter(u);
  let screen: Screen;
  if (opts.resume) {
    for (const u of opts.resume.match?.bundles ?? []) if (u) await loadGeneratedFighter(u);
    screen = OnlineScreen.resume(() => home(), opts.resume);
  } else if (params.get("sheet")) {
    await loadFighters([params.get("sheet")!]);
    screen = new SheetScreen(params.get("sheet")!, Number(params.get("page") ?? 0));
  } else if (params.get("quick")) {
    screen = await quickMatch(params, () => home());
  } else {
    screen = home();
  }
  screen.enter?.();
  noteScreen(screen.constructor.name);

  const onKey = (e: KeyboardEvent) => {
    if (e.code === "F2") { const v = screen as VersusScreen; if (v.renderer) v.renderer.showHitboxes = !v.renderer.showHitboxes; e.preventDefault(); }
  };
  window.addEventListener("keydown", onKey);
  // Back from Discord or Google restores this page from the back/forward cache: mount doesn't run again
  const onPageShow = (e: PageTransitionEvent) => {
    const unfinished = e.persisted && unfinishedSignIn();
    if (!unfinished) return;
    everywhere("warn", "sign-in", unfinished);
    if (screen instanceof SignInScreen) screen.error = unfinished;
  };
  window.addEventListener("pageshow", onPageShow);

  let running = true;
  let last = performance.now();
  /** One tick of the current screen. False once the shell took over (a bundle swap). */
  function update(now: number): boolean {
    // up to a quarter second of catch-up after a hitch: an online client that dropped sim time would drag the match
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    const menu = readMenu(allDevices());
    let next = screen.update(dt, menu) ?? takeHandoff();
    // signed out (a 401 anywhere, or SIGN OUT): back to the door, except mid-match or on a no-account page
    const current = next ?? screen;
    // class time takes over anywhere but a match in progress
    if (classTime.blocked && !(current instanceof VersusScreen || current instanceof ClassScreen || current instanceof FeedbackScreen || current instanceof SketchScreen || current instanceof FeedbackListScreen || current instanceof FeedbackDetailScreen)) {
      current.abandon?.();
      next = new ClassScreen(() => nav.title());
    }
    const shown = next ?? screen;
    if (!signedIn() && !(shown instanceof SignInScreen || shown instanceof VersusScreen || shown instanceof SheetScreen || shown instanceof ClassScreen || shown instanceof FeedbackScreen || shown instanceof SketchScreen)) {
      shown.abandon?.();
      forgetLibrary();
      forgetMaps();
      next = signInScreen(nav);
    }
    if (next) { screen = next; screen.enter?.(); noteScreen(screen.constructor.name); }
    music.follow(screen instanceof VersusScreen ? screen : null);
    endInputFrame();
    endPointerTick();
    return running;
  }

  // The sim clock is a worker's 60 Hz timer, not requestAnimationFrame: paint rate and sim rate are separate,
  // so a machine that paints 10 frames a second still simulates 60 and keeps up with an online match, and a
  // hidden tab (where rAF stops and the page's own timers are throttled) keeps ticking, so the other players
  // never stall on it. The frame loop only draws.
  const TICK_MS = 1000 / 60;
  const ticker = new Worker(URL.createObjectURL(new Blob([`setInterval(() => postMessage(0), ${TICK_MS})`], { type: "text/javascript" })));
  ticker.onmessage = () => {
    if (!running) { ticker.terminate(); return; }
    // hidden, a menu can wait; a match can't
    if (document.visibilityState === "hidden" && !(screen instanceof NetVersusScreen)) return;
    if (!update(performance.now())) ticker.terminate();
  };

  // Draws are capped near the sim's 60 Hz: a 144 Hz screen would otherwise draw 2.4x the work for the same
  // motion. The refresh interval is the median of recent frame gaps, so a draw lands on whichever frame is
  // closest to 1/60 s. The pacer watches the draws and steps the resolution down on a machine that can't keep up.
  const DRAW_MS = TICK_MS;
  const gaps: number[] = [];
  let refresh = DRAW_MS, lastFrame = 0, lastDraw = 0;
  function frame(now: number): void {
    if (!running) return;
    if (lastFrame) gaps.push(now - lastFrame);
    lastFrame = now;
    if (gaps.length > 30) gaps.shift();
    if (gaps.length === 30) refresh = [...gaps].sort((a, b) => a - b)[15];
    const sinceDraw = now - lastDraw;
    if (sinceDraw + refresh / 2 < DRAW_MS) { requestAnimationFrame(frame); return; }
    pacer.drew(now);
    lastDraw = now;
    document.body.style.cursor = "default";
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = PAPER;
    // only the letterbox bars: every screen paints the whole view, and a full-canvas fill is the priciest thing a potato does per frame
    if (offX > 0) { ctx.fillRect(0, 0, Math.ceil(offX), canvas.height); ctx.fillRect(canvas.width - Math.ceil(offX), 0, Math.ceil(offX), canvas.height); }
    if (offY > 0) { ctx.fillRect(0, 0, canvas.width, Math.ceil(offY)); ctx.fillRect(0, canvas.height - Math.ceil(offY), canvas.width, Math.ceil(offY)); }
    ctx.setTransform(scale, 0, 0, scale, offX, offY);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, VIEW_W, VIEW_H); ctx.clip();
    screen.draw(ctx, Math.min(0.1, sinceDraw / 1000));
    ctx.restore();
    endPointerFrame();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  const controller: AppController = {
    get screen() { return screen; },
    stop() {
      running = false;
      ticker.terminate();
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pageshow", onPageShow);
      detachPointer();
      stopTelemetry();
      stopClassTime();
    },
  };
  (window as any).sketchbattle = { get screen() { return screen; }, get preview() { return (screen as VersusScreen).preview ?? null; }, build: site.build, hash: swap.hash };
  return controller;
}
