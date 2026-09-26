import "./style.css";
import { VIEW_H, VIEW_W } from "./render/camera";
import { PAPER } from "./render/paper";
import { connectedPads, endInputFrame, readMenu, type DeviceId } from "./input/devices";
import { attachPointer, endPointerFrame, setPointerTransform } from "./input/pointer";
import { roster, rosterList } from "../../shared/fighters/index";
import { TitleScreen, type Mode } from "./screens/title";
import { SelectScreen, type SlotPick } from "./screens/select";
import { StageScreen } from "./screens/stage";
import { OnlineScreen } from "./screens/online";
import { DrawScreen } from "./screens/draw/screen";
import { SettingsScreen } from "./screens/settings";
import { VersusScreen } from "./screens/versus";
import { loadSettings, settings, takeHandoff, type Screen } from "./screens/ui";
import { SheetScreen } from "./screens/sheet";
import { setVolume } from "./audio/audio";
import { logClient } from "./telemetry";
import { loadGeneratedFighter } from "./gen";
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

  let lastPicks: SlotPick[] | null = null;
  let lastSetup: { stage: string; stocks: number; time: number } | null = null;
  let lastTraining = false;

  function startMatch(picks: SlotPick[], setup: { stage: string; stocks: number; time: number }, training: boolean): Screen {
    lastPicks = picks; lastSetup = setup; lastTraining = training;
    const filled = picks.filter((p) => p.device || p.cpu);
    const cfg = { stage: setup.stage, players: filled.map((p) => ({ fighter: rosterList[p.fighter].id, cpu: p.cpu })), rules: { stocks: setup.stocks, time: setup.time }, seed: (Math.random() * 0xffffffff) >>> 0 };
    const sources = filled.map((p) => ({ device: p.device, cpu: p.cpu }));
    return new VersusScreen(cfg, sources, () => titleScreen(), () => startMatch(lastPicks!, lastSetup!, lastTraining), training);
  }

  function titleScreen(): Screen {
    return new TitleScreen((mode: Mode) => {
      if (mode === "settings") return new SettingsScreen(() => titleScreen());
      if (mode === "online") return new OnlineScreen(() => titleScreen());
      if (mode === "draw") return new DrawScreen(() => titleScreen());
      const training = mode === "training";
      return new SelectScreen((picks) => new StageScreen((setup) => startMatch(picks, setup, training), () => titleScreen(), training), () => titleScreen(), training);
    });
  }

  // URL quick start for screenshots and testing: ?quick=1&p2=cpu&cpu=9&f=sable,sable&stage=proving&seed=3
  const params = opts.params;
  // ?gen=<bundle url>[,<bundle url>] loads drawn fighters before the quick start / sheet below.
  const genUrls = (params.get("gen") ?? "").split(",").filter(Boolean);
  for (const u of genUrls) await loadGeneratedFighter(u);
  let screen: Screen;
  if (opts.resume) {
    screen = OnlineScreen.resume(() => titleScreen(), opts.resume);
  } else if (params.get("sheet")) {
    screen = new SheetScreen(params.get("sheet")!, Number(params.get("page") ?? 0));
  } else if (params.get("quick")) {
    const p2 = params.get("p2") ?? "cpu";
    const fighters = (params.get("f") ?? "sable,sable").split(",").map((f) => (roster[f] ? f : "sable"));
    const cpu = Number(params.get("cpu") ?? 6);
    const p1 = (params.get("p1") ?? "kb1") as DeviceId;
    const p1cpu = params.get("p1") === "cpu";
    const picks: SlotPick[] = fighters.map((f, i) => ({ device: i === 0 ? (p1cpu ? null : p1) : i === 1 && p2 !== "cpu" ? "kb2" : null, cpu: (i === 0 && !p1cpu) || (i === 1 && p2 !== "cpu") ? 0 : cpu, fighter: rosterList.findIndex((d) => d.id === f), ready: true }));
    while (picks.length < 4) picks.push({ device: null, cpu: 0, fighter: 0, ready: false });
    screen = startMatch(picks, { stage: params.get("stage") ?? "proving", stocks: Number(params.get("stocks") ?? 3), time: 0 }, params.get("training") === "1");
    const v = screen as VersusScreen;
    v.countdown = 0;
    if (params.get("seed")) v.match.state.seed = Number(params.get("seed"));
    if (params.get("boxes") === "1") v.renderer.showHitboxes = true;
  } else {
    screen = titleScreen();
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
    const next = screen.update(dt, menu) ?? takeHandoff();
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
  (window as any).sketchbattle = { get screen() { return screen; }, build: site.build, hash: swap.hash };
  return controller;
}
