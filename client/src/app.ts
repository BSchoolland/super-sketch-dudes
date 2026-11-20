import { setSpriteScale } from "./render/sprite";
import { FramePacer } from "./render/pacing";
import "./style.css";
import { VIEW_H, VIEW_W } from "./render/camera";
import { PAPER } from "./render/paper";
import { connectedPads, endInputFrame, readMenu, type DeviceId, type MenuInput } from "./input/devices";
import { attachPointer, endPointerFrame, endPointerTick, pointer, setPointerTransform } from "./input/pointer";
import { attachTouch, pad, touchInUse, touchLive, touchShown } from "./input/touch";
import { OnlineScreen } from "./screens/online";
import { NetVersusScreen } from "./screens/netversus";
import { VersusScreen } from "./screens/versus";
import { SheetScreen } from "./screens/sheet";
import { SignInScreen } from "./screens/signin";
import { WaitScreen } from "./screens/loading";
import { menus, signInScreen } from "./screens/flow";
import { loadSettings, settings, takeHandoff, type Screen } from "./screens/ui";
import { music, setMusicVolume, setVolume } from "./audio/audio";
import { watchAudio } from "./audio/health";
import { classTime, watchClassTime } from "./classtime";
import { ClassScreen, FeedbackScreen, SketchScreen } from "./screens/classtime";
import { FeedbackDetailScreen, FeedbackListScreen } from "./screens/feedbacklist";
import { everywhere, noteActivity, noteCrazyGames, noteScreen, noteView, sessionTrace, startTelemetry } from "./telemetry/events";
import { loadGeneratedFighter } from "./gen";
import { activitySignIn, devSignIn, finishSignIn, guestSignIn, keepAccountApart, loadAccount, markPlayed, signedIn, unfinishedSignIn } from "./account";
import { activityLaunch, discordCode, startActivity } from "./activity";
import { crazyGames, crazyGamesLaunch, crazyGamesLoggedIn, crazyGamesPlayer, followPlay, onCrazyGamesInvite, onCrazyGamesLogin, showRoom, startCrazyGames, takeFirstRoom } from "./crazygames";
import { CreateScreen } from "./screens/create";
import { ForgeScreen } from "./screens/forging";
import { forgetLibrary, refreshLibrary } from "./fighters";
import { forgetMaps, refreshMaps } from "./maps";
import { loadFighters, quickMatch } from "./quick";
import { site, setSiteBase } from "./base";
import { swap, type Handoff } from "./handoff";
import { TitleScreen } from "./screens/title";
import { closeAbout } from "./about";
import { sharedIdOf, sharing } from "./share";
import { startBars } from "./bars";
import { onStage, stageSize, turned } from "./turn";
import { tourButtons, tourCardUp, tourDraw, tourSaw, tourTick, tourUpdate } from "./screens/tour";

const NO_MENU: MenuInput = { up: false, down: false, left: false, right: false, confirm: false, back: false, start: false, any: false, from: null };

export interface MountOptions {
  canvas: HTMLCanvasElement;
  /** URL prefix of the site (its /api and /ws), e.g. "/". */
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

/** The match is over and someone playing on this computer won it (or their team did). */
function wonHere(v: VersusScreen): boolean {
  const st = v.match.state;
  return st.winner >= 0 && v.match.sources.some((s, i) => !!s.device && (st.rules.teams ? st.fighters[i].team === st.winner : i === st.winner));
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
  const launch = activityLaunch(opts.params, location.host, import.meta.env.DEV);
  const crazyLaunch = launch ? null : crazyGamesLaunch(opts.params, location.pathname, site.base, import.meta.env.DEV);
  // no links out of CrazyGames' frame
  sharing.shown = !crazyLaunch;
  const stopTelemetry = startTelemetry({ canvas, bundle: swap.hash, continues: opts.resume?.session, ...(launch ? { launch: "discord-activity" } : crazyLaunch ? { launch: "crazygames" } : {}) });
  // the website's own page: not the Activity, not CrazyGames, not the swappable shell (it would start them again at every swap)
  if (!launch && !crazyLaunch && !shellSwap) startBars(canvas);
  const stopClassTime = watchClassTime();
  loadSettings();
  setVolume(settings.volume);
  setMusicVolume(settings.music);

  const ctx = canvas.getContext("2d", { alpha: false })!;
  let scale = 1, offX = 0, offY = 0;
  const pacer = new FramePacer(() => resize());
  function resize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1) * pacer.quality;
    const { w, h } = stageSize();
    canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr);
    scale = Math.min(w / VIEW_W, h / VIEW_H) * dpr;
    offX = (canvas.width - VIEW_W * scale) / 2;
    offY = (canvas.height - VIEW_H * scale) / 2;
    setPointerTransform(scale / dpr, offX / dpr, offY / dpr);
    setSpriteScale(scale);
    noteView({ w, h, turned: turned(), dpr, canvasW: canvas.width, canvasH: canvas.height, scale, quality: pacer.quality });
  }
  const detachPointer = attachPointer(canvas);
  // after the pointer's listeners: a finger the controls take is claimed from the taps
  const detachTouch = attachTouch(canvas);
  const stopStage = onStage(resize);
  resize();

  function allDevices(): DeviceId[] {
    return ["kb1", "kb2", ...connectedPads().map((i) => `pad${i}` as DeviceId)];
  }

  const nav = menus();
  const params = opts.params;
  if (crazyLaunch) {
    const environment = await startCrazyGames(crazyLaunch, params);
    noteCrazyGames({ environment, accounts: !!crazyGames?.accounts, invited: !!crazyGames?.invite, instant: !!crazyGames?.instant });
    if (crazyGames) keepAccountApart("crazygames");
  }
  const restored = loadAccount();
  let signInError = "";
  /** A CrazyGames invite accepted while the game runs: opened once no match is on. */
  let invitedTo: string | null = null;
  if (launch) {
    // the Activity signs in from Discord on every launch, whatever this browser kept: storage in Discord's iframe is
    // partitioned and may not last, and the Discord account in the client may not be the one that signed in before
    noteActivity(await startActivity(launch, params));
    try { await activitySignIn(await discordCode()); } catch (error) { console.error(error); signInError = error instanceof Error ? error.message : String(error); }
  } else if (crazyGames) {
    // the CrazyGames user if they're logged in to CrazyGames, else this browser's guest; never a Discord, Google or email account
    try { await crazyGamesPlayer(); } catch (error) { console.error(error); signInError = error instanceof Error ? error.message : String(error); }
    onCrazyGamesLogin(() => crazyGamesLoggedIn().then(() => { void refreshLibrary(); void refreshMaps(); }, (error: unknown) => console.error("signing in the CrazyGames login failed", error)));
    onCrazyGamesInvite((room) => { invitedTo = room; });
  } else {
    // back from Discord or Google (a token, a refusal, or nothing: the trip died), or ?dev=<name> against a DEV_LOGIN server
    let fresh = false;
    try { fresh = await finishSignIn(); } catch (error) { console.error(error); signInError = error instanceof Error ? error.message : String(error); }
    const unfinished = unfinishedSignIn();
    if (unfinished) { everywhere("warn", "sign-in", unfinished); signInError = unfinished; }
    if (!signedIn() && params.get("dev")) await devSignIn(params.get("dev")!);
    // a fresh sign-in already told the server; a 401 here signs a stale session out
    if (restored && !fresh) await markPlayed().catch((error: unknown) => everywhere("warn", "played", `marking this visit failed: ${error instanceof Error ? error.message : String(error)}`));
    if (!signedIn()) await guestSignIn().catch((error: unknown) => { console.error("guest sign-in failed", error); signInError = error instanceof Error ? error.message : String(error); });
  }
  /** A character's page (`<base>c/<id>`, a share link): the game opens on that character, once. */
  let landing = launch || crazyLaunch ? null : sharedIdOf(location.pathname, site.base);
  // the Activity opens on the voice channel's room; the website on the title, or once on why a sign-in didn't work, or
  // on the character a link was to; CrazyGames on the room of the invite it was opened from, or a fresh private room
  // for instant multiplayer
  const home = (): Screen => {
    if (launch) return signedIn() ? nav.call() : signInScreen(nav, signInError);
    const error = signInError;
    signInError = "";
    if (error) return signInScreen(nav, error);
    if (landing && signedIn()) { const id = landing; landing = null; return nav.community(id); }
    const first = signedIn() ? takeFirstRoom() : undefined;
    if (first !== undefined) return nav.room(first);
    return signedIn() ? nav.title() : nav.guest();
  };

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
  const stopAudioWatch = watchAudio(() => screen.constructor.name);

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
    if (screen instanceof VersusScreen) screen.armControls();
    // a tour card takes the input; the screen under it keeps ticking (a lobby stays connected)
    const carded = tourCardUp(screen);
    let next = (carded ? tourUpdate(menu, nav) : null) ?? screen.update(dt, carded ? NO_MENU : menu) ?? takeHandoff();
    // signed out (a 401 anywhere): a fresh guest on the website, the door in the Activity, except mid-match or on a no-account page
    const current = next ?? screen;
    // class time takes over anywhere but a match in progress
    if (classTime.blocked && !(current instanceof VersusScreen || current instanceof ClassScreen || current instanceof FeedbackScreen || current instanceof SketchScreen || current instanceof FeedbackListScreen || current instanceof FeedbackDetailScreen)) {
      current.abandon?.();
      next = new ClassScreen(() => nav.title());
    }
    const settled: Screen = next ?? screen;
    if (invitedTo && !(settled instanceof VersusScreen || settled instanceof ClassScreen)) {
      settled.abandon?.();
      next = nav.room(invitedTo);
      invitedTo = null;
    }
    const shown = next ?? screen;
    if (!signedIn() && !(shown instanceof SignInScreen || shown instanceof WaitScreen || shown instanceof VersusScreen || shown instanceof SheetScreen || shown instanceof ClassScreen || shown instanceof FeedbackScreen || shown instanceof SketchScreen)) {
      shown.abandon?.();
      forgetLibrary();
      forgetMaps();
      next = launch ? signInScreen(nav) : nav.guest();
    }
    if (next) { tourSaw(screen, next); screen = next; screen.enter?.(); noteScreen(screen.constructor.name); }
    tourTick(dt, screen);
    if (!(screen instanceof TitleScreen)) closeAbout();
    music.follow(screen instanceof VersusScreen ? screen : null);
    if (crazyGames) {
      const v = screen instanceof VersusScreen ? screen : null;
      const cheer = v && v.match.state.ended && wonHere(v) ? v : screen instanceof ForgeScreen && screen.entry.status === "ready" ? screen : null;
      followPlay((!!v && !v.match.paused && !v.match.state.ended) || screen instanceof CreateScreen, cheer);
      showRoom(screen instanceof OnlineScreen || screen instanceof NetVersusScreen ? screen.invitable() : null);
    }
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
    // a match on touch draws to the screen's edges, where its controls are
    const seen = screen instanceof VersusScreen ? screen.renderer.cam.seen() : { x1: 0, y1: 0, x2: VIEW_W, y2: VIEW_H };
    ctx.beginPath(); ctx.rect(seen.x1, seen.y1, seen.x2 - seen.x1, seen.y2 - seen.y1); ctx.clip();
    // under a tour card the screen sees no pointer: its own buttons can't be hovered or clicked through the card
    const carded = tourCardUp(screen), present = pointer.present, clicked = pointer.clicked;
    if (carded) { pointer.present = false; pointer.clicked = false; }
    screen.draw(ctx, Math.min(0.1, sinceDraw / 1000));
    if (carded) { pointer.present = present; pointer.clicked = clicked; }
    tourDraw(ctx, screen);
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
      stopStage();
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pageshow", onPageShow);
      detachPointer();
      detachTouch();
      stopTelemetry();
      stopAudioWatch();
      stopClassTime();
    },
  };
  (window as any).sketchbattle = {
    get screen() { return screen; }, get preview() { return (screen as VersusScreen).preview ?? null; }, build: site.build, hash: swap.hash,
    get touch() { return { layout: pad.layout, live: touchLive(), shown: touchShown(), inUse: touchInUse() }; },
    get tourCard() { return tourButtons(screen); },
  };
  return controller;
}
