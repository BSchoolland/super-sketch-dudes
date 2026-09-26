import "./style.css";
import { VIEW_H, VIEW_W } from "./render/camera";
import { PAPER } from "./render/paper";
import { connectedPads, endInputFrame, readMenu, type DeviceId } from "./input/devices";
import { attachPointer, endPointerFrame, setPointerTransform } from "./input/pointer";
import { OnlineScreen } from "./screens/online";
import { VersusScreen } from "./screens/versus";
import { SheetScreen } from "./screens/sheet";
import { SignInScreen } from "./screens/signin";
import { menus, signInScreen } from "./screens/flow";
import { loadSettings, settings, takeHandoff, type Screen } from "./screens/ui";
import { setMusicVolume, setVolume } from "./audio/audio";
import { logClient } from "./telemetry";
import { loadGeneratedFighter } from "./gen";
import { devSignIn, finishSignIn, loadAccount, signedIn } from "./account";
import { forgetLibrary } from "./fighters";
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
  if (opts.swap) swap.request = opts.swap;
  loadSettings();
  setVolume(settings.volume);
  setMusicVolume(settings.music);
  logClient("start", { ua: navigator.userAgent, w: innerWidth, h: innerHeight, dpr: devicePixelRatio, pads: connectedPads().length, resumed: !!opts.resume });

  const canvas = opts.canvas;
  const ctx = canvas.getContext("2d", { alpha: false })!;
  let scale = 1, offX = 0, offY = 0;
  function resize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = window.innerWidth, h = window.innerHeight;
    canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr);
    scale = Math.min(w / VIEW_W, h / VIEW_H) * dpr;
    offX = (canvas.width - VIEW_W * scale) / 2;
    offY = (canvas.height - VIEW_H * scale) / 2;
    setPointerTransform(scale / dpr, offX / dpr, offY / dpr);
  }
  const detachPointer = attachPointer(canvas);
  window.addEventListener("resize", resize);
  resize();

  function allDevices(): DeviceId[] {
    return ["kb1", "kb2", ...connectedPads().map((i) => `pad${i}` as DeviceId)];
  }

  const nav = menus();
  const params = opts.params;
  // back from Discord with a token in the fragment, or ?dev=<name> against a DEV_LOGIN server
  loadAccount();
  let signInError = "";
  if (location.hash.includes("access_token")) {
    try { await finishSignIn(); } catch (error) { console.error(error); signInError = error instanceof Error ? error.message : String(error); }
  }
  if (!signedIn() && params.get("dev")) await devSignIn(params.get("dev")!);
  const home = (): Screen => (signedIn() ? nav.title() : signInScreen(signInError));

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

  const onKey = (e: KeyboardEvent) => {
    if (e.code === "F2") { const v = screen as VersusScreen; if (v.renderer) v.renderer.showHitboxes = !v.renderer.showHitboxes; e.preventDefault(); }
  };
  window.addEventListener("keydown", onKey);

  let running = true;
  let last = performance.now();
  function frame(now: number): void {
    if (!running) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const menu = readMenu(allDevices());
    document.body.style.cursor = "default";
    let next = screen.update(dt, menu) ?? takeHandoff();
    // signed out (a 401 anywhere, or SIGN OUT): back to the door, except mid-match or on a no-account page
    const current = next ?? screen;
    if (!signedIn() && !(current instanceof SignInScreen || current instanceof VersusScreen || current instanceof SheetScreen)) {
      current.abandon?.();
      forgetLibrary();
      next = signInScreen();
    }
    if (next) { screen = next; screen.enter?.(); }
    endInputFrame();
    if (!running) return; // the screen asked the shell for another bundle
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(scale, 0, 0, scale, offX, offY);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, VIEW_W, VIEW_H); ctx.clip();
    screen.draw(ctx, dt);
    ctx.restore();
    endPointerFrame();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  const controller: AppController = {
    get screen() { return screen; },
    stop() {
      running = false;
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", onKey);
      detachPointer();
    },
  };
  (window as any).sketchbattle = { get screen() { return screen; }, get preview() { return (screen as VersusScreen).preview ?? null; }, build: site.build, hash: swap.hash };
  return controller;
}
