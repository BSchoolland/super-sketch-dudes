import "./style.css";
import { VIEW_H, VIEW_W } from "./render/camera";
import { PAPER } from "./render/paper";
import { connectedPads, endInputFrame, readMenu, type DeviceId } from "./input/devices";
import { attachPointer, endPointerFrame, setPointerTransform } from "./input/pointer";
import { OnlineScreen } from "./screens/online";
import { NetVersusScreen } from "./screens/netversus";
import { VersusScreen } from "./screens/versus";
import { SheetScreen } from "./screens/sheet";
import { SignInScreen } from "./screens/signin";
import { menus, signInScreen } from "./screens/flow";
import { loadSettings, settings, takeHandoff, type Screen } from "./screens/ui";
import { music, setMusicVolume, setVolume } from "./audio/audio";
import { noteScreen, noteView, sessionTrace, startTelemetry } from "./telemetry/events";
import { loadGeneratedFighter } from "./gen";
import { devSignIn, finishSignIn, loadAccount, signedIn } from "./account";
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
  loadSettings();
  setVolume(settings.volume);
  setMusicVolume(settings.music);

  const ctx = canvas.getContext("2d", { alpha: false })!;
  let scale = 1, offX = 0, offY = 0;
  // canvas pixels per CSS pixel, capped; a machine that can't keep up steps down the cap (see judgeFrames)
  const DPR_CAPS = [2, 1.5, 1, 0.75];
  let quality = 0;
  function resize(): void {
    const dpr = Math.min(DPR_CAPS[quality], window.devicePixelRatio || 1);
    const w = window.innerWidth, h = window.innerHeight;
    canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr);
    scale = Math.min(w / VIEW_W, h / VIEW_H) * dpr;
    offX = (canvas.width - VIEW_W * scale) / 2;
    offY = (canvas.height - VIEW_H * scale) / 2;
    setPointerTransform(scale / dpr, offX / dpr, offY / dpr);
    noteView({ w, h, dpr, canvasW: canvas.width, canvasH: canvas.height, scale });
  }
  const detachPointer = attachPointer(canvas);
  window.addEventListener("resize", resize);
  resize();

  function allDevices(): DeviceId[] {
    return ["kb1", "kb2", ...connectedPads().map((i) => `pad${i}` as DeviceId)];
  }

  const nav = menus();
  const params = opts.params;
  // back from Discord or Google with a token in the fragment, or ?dev=<name> against a DEV_LOGIN server
  loadAccount();
  let signInError = "";
  if (/(access|id)_token=/.test(location.hash)) {
    try { await finishSignIn(); } catch (error) { console.error(error); signInError = error instanceof Error ? error.message : String(error); }
  }
  if (!signedIn() && params.get("dev")) await devSignIn(params.get("dev")!);
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

  let running = true;
  let last = performance.now();
  /** One tick of the current screen. False once the shell took over (a bundle swap). */
  function update(now: number): boolean {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const menu = readMenu(allDevices());
    let next = screen.update(dt, menu) ?? takeHandoff();
    // signed out (a 401 anywhere, or SIGN OUT): back to the door, except mid-match or on a no-account page
    const current = next ?? screen;
    if (!signedIn() && !(current instanceof SignInScreen || current instanceof VersusScreen || current instanceof SheetScreen)) {
      current.abandon?.();
      forgetLibrary();
      forgetMaps();
      next = signInScreen(nav);
    }
    if (next) { screen = next; screen.enter?.(); noteScreen(screen.constructor.name); }
    music.follow(screen instanceof VersusScreen ? screen : null);
    endInputFrame();
    return running;
  }

  // Draws are capped near the sim's 60 Hz: a 144 Hz screen would otherwise draw 2.4x the work for the same
  // motion. The refresh interval is the median of recent frame gaps, so a draw lands on whichever frame is
  // closest to 1/60 s. Frame gaps also judge the machine: too many long gaps between draws, and the
  // canvas steps down a resolution cap (never back up: a session that struggled once keeps the headroom).
  const DRAW_MS = 1000 / 60;
  const gaps: number[] = [];
  let refresh = DRAW_MS, lastDraw = 0, judgeFrom = 0, slowDraws = 0, judgedDraws = 0;
  function judgeFrames(now: number, gap: number): void {
    if (gap > DRAW_MS * 1.6) slowDraws++;
    judgedDraws++;
    if (now - judgeFrom < 2000) return;
    if (judgedDraws >= 10 && slowDraws / judgedDraws > 0.3 && quality < DPR_CAPS.length - 1) { quality++; resize(); }
    judgeFrom = now; slowDraws = 0; judgedDraws = 0;
  }
  function frame(now: number): void {
    if (!running) return;
    gaps.push(now - last);
    if (gaps.length > 30) gaps.shift();
    if (gaps.length === 30) refresh = [...gaps].sort((a, b) => a - b)[15];
    if (!update(now)) return; // the screen asked the shell for another bundle
    const sinceDraw = now - lastDraw;
    if (sinceDraw + refresh / 2 < DRAW_MS) { requestAnimationFrame(frame); return; }
    if (lastDraw) judgeFrames(now, sinceDraw);
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

  // requestAnimationFrame stops in a hidden tab, and an online player who stops ticking stalls everyone else's
  // match. A worker's timer isn't throttled the way the page's are, so while the tab is hidden it keeps the
  // match ticking (inputs out, nothing drawn) until the tab is visible and the frame loop takes over again.
  let ticker: Worker | null = null;
  function stopTicker(): void { ticker?.terminate(); ticker = null; }
  function onVisibility(): void {
    if (document.visibilityState !== "hidden") { stopTicker(); return; }
    if (ticker || !(screen instanceof NetVersusScreen)) return;
    ticker = new Worker(URL.createObjectURL(new Blob([`setInterval(() => postMessage(0), ${DRAW_MS})`], { type: "text/javascript" })));
    ticker.onmessage = () => {
      if (!running || document.visibilityState !== "hidden" || !(screen instanceof NetVersusScreen)) { stopTicker(); return; }
      update(performance.now());
    };
  }
  document.addEventListener("visibilitychange", onVisibility);

  const controller: AppController = {
    get screen() { return screen; },
    stop() {
      running = false;
      stopTicker();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", onKey);
      detachPointer();
      stopTelemetry();
    },
  };
  (window as any).sketchbattle = { get screen() { return screen; }, get preview() { return (screen as VersusScreen).preview ?? null; }, build: site.build, hash: swap.hash };
  return controller;
}
