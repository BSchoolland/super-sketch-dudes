import { matchTrace, type Issue, type WideEvent } from "../../../shared/wide";
import type { MatchConfig } from "../../../shared/sim";
import { roster } from "../../../shared/fighters/index";
import type { RollbackSession } from "../net/rollback";
import type { Renderer } from "../render/render";
import { VIEW_H, VIEW_W } from "../render/camera";
import { PAPER } from "../render/paper";
import { cellImages } from "../render/sprite";
import { drawHealth } from "../render/health";
import { clientEvent, finishEvent, sessionList, view } from "./events";

export interface MatchStart {
  room: { code: string; trace: string | null };
  config: MatchConfig;
  members: { id: number; name: string; slot: number }[];
  localSlot: number;
  inputDelay: number;
  bundles: string[];
  /** The frame a bundle swap handed this match over at. */
  resumedAt?: number;
}
export interface LoadOutcome { url: string; state: string; error: string; ms: number }

const FRAME_BUCKETS = [17, 25, 34, 50, 100, 1000];
const PROBE_FIRST_MS = 2000, PROBE_EVERY_MS = 10_000;
const PROBE_W = 96, PROBE_H = 54;
/** Below this share of non-paper pixels the world layer drew nothing (a normal frame is several percent). */
const BLANK_INK = 0.002;
const PAPER_RGB = [1, 3, 5].map((i) => parseInt(PAPER.slice(i, i + 2), 16));

/**
 * One client's view of one online match, on the trace every participant and the relay share.
 * Opened when the start arrives (so a fighter that never loads still leaves a record), attached
 * to the running session and renderer once the match screen exists, finished with the exit.
 */
export class MatchTelemetry {
  readonly event: WideEvent;
  private session: RollbackSession | null = null;
  private renderer: Renderer | null = null;
  private readonly net = { frames: 0, confirmed: 0, maxLead: 0, waitingMs: 0, waits: 0, longestWaitMs: 0, rtt: { min: 0, max: 0, avg: 0, n: 0 } };
  private readonly render = {
    draws: 0, frameMs: {} as Record<string, number>, maxFrameMs: 0, badCamera: 0, badView: 0, offscreenDraws: 0,
    sprites: 0, spriteLoading: 0, spriteFailed: 0, failedCells: [] as string[], probes: [] as { frame: number; ink: number }[], minInk: 1,
  };
  private attachedAt = 0;
  private lastTick = 0;
  private lastDraw = 0;
  private waitMs = 0;
  private rttSum = 0;
  private secondAt = 0;
  private offscreenRun = 0;
  private probeAt = 0;
  private probeCtx: CanvasRenderingContext2D | null = null;
  private base = { sprites: 0, loading: 0, failed: 0 };
  private finished = false;

  constructor(private start: MatchStart) {
    const { room, config, members, localSlot, bundles } = start;
    this.event = clientEvent("match", matchTrace(room.code, config.seed))
      .set("match", { room: room.code, roomTrace: room.trace, seed: config.seed, stage: config.stage, rules: config.rules, inputDelay: start.inputDelay, localSlot, resumedAt: start.resumedAt ?? null })
      .set("members", members.map((m) => ({ ...m, fighter: config.players[m.slot]?.fighter ?? null, bundle: bundles[m.slot] ?? "", local: m.slot === localSlot })))
      .set("net", this.net)
      .set("render", this.render);
    sessionList("matches", this.event.trace, 50);
  }

  get trace(): string { return this.event.trace; }

  issue(level: Issue["level"], code: string, message: string): void {
    this.event.issue(level, code, message);
  }

  /** A remote player left mid-match: `dropped` when they were already out and the match carries on. */
  left(slot: number, dropped: boolean): void {
    const frame = this.session?.state.frame ?? -1;
    const list = (this.event.business.left ??= []) as unknown[];
    list.push({ slot, frame, dropped });
    if (!dropped) this.issue("warn", "left", `slot ${slot} left mid-fight at frame ${frame}: match over`);
  }

  loading(urls: string[]): void {
    this.event.set("loads", urls.map((url) => ({ url, state: "loading" })));
  }

  loaded(outcomes: LoadOutcome[]): void {
    this.event.set("loads", outcomes);
    for (const o of outcomes) if (o.state === "failed") this.issue("error", "load", `fighter bundle didn't load: ${o.url}: ${o.error}`);
  }

  /** The match screen is up: from here on the session and renderer are watched. */
  attach(session: RollbackSession, renderer: Renderer): void {
    this.session = session;
    this.renderer = renderer;
    this.attachedAt = performance.now();
    this.probeAt = this.attachedAt + PROBE_FIRST_MS;
    this.base = { sprites: drawHealth.sprites, loading: drawHealth.loading, failed: drawHealth.failed };
    this.event.set("rollback", session.stats).set("view", { ...view });
    if (!(view.scale > 0) || !Number.isFinite(view.scale)) this.issue("error", "view", `canvas scale is ${view.scale} (window ${view.w}x${view.h}, canvas ${view.canvasW}x${view.canvasH})`);
    this.event.set("sprites", this.start.config.players.map((p, slot) => {
      const cells = Object.values(roster[p.fighter]?.sprite?.cells ?? {}).map(cellImages);
      return { slot, fighter: p.fighter, cells: cells.length, loaded: cells.filter((c) => c.base).length, failed: cells.filter((c) => c.failed).length };
    }));
    renderer.afterWorld = (ctx) => { if (performance.now() >= this.probeAt) this.probe(ctx); };
  }

  /** Every update: frames, confirmation, WAITING time (`stalled`: waiting on remote inputs, not on a failure banner), round trip. */
  tick(rtt: number, stalled: boolean): void {
    const s = this.session;
    if (!s) return;
    const now = performance.now();
    const ms = this.lastTick ? now - this.lastTick : 0;
    this.lastTick = now;
    this.net.frames = s.state.frame;
    this.net.confirmed = s.confirmedThrough;
    this.net.maxLead = Math.max(this.net.maxLead, s.frameLead());
    if (stalled) this.waitMs += ms;
    else if (this.waitMs > 0) this.endWait();
    if (now - this.secondAt < 1000) return;
    this.secondAt = now;
    this.summarize(s.state.ended ? "ended" : "playing");
    if (rtt > 0) {
      const r = this.net.rtt;
      r.min = r.n ? Math.min(r.min, rtt) : rtt;
      r.max = Math.max(r.max, rtt);
      this.rttSum += rtt;
      r.n++;
      r.avg = Math.round(this.rttSum / r.n);
    }
  }

  private endWait(): void {
    this.net.waits++;
    this.net.waitingMs = Math.round(this.net.waitingMs + this.waitMs);
    this.net.longestWaitMs = Math.max(this.net.longestWaitMs, Math.round(this.waitMs));
    if (this.waitMs > 3000) this.issue("warn", "waiting", "a WAITING stall longer than 3 s");
    this.waitMs = 0;
  }

  /** Every draw: frame time, whether the camera and canvas can show anything, what the sprites drew. */
  drew(): void {
    const r = this.renderer, s = this.session;
    if (!r || !s) return;
    const now = performance.now();
    const render = this.render;
    if (this.lastDraw) {
      const ms = now - this.lastDraw;
      const bucket = FRAME_BUCKETS.find((b) => ms <= b);
      const key = bucket ? `${bucket}` : "more";
      render.frameMs[key] = (render.frameMs[key] ?? 0) + 1;
      render.maxFrameMs = Math.max(render.maxFrameMs, Math.round(ms));
    }
    this.lastDraw = now;
    render.draws++;
    const state = s.state, cam = r.cam;
    if (![cam.x, cam.y, cam.zoom].every(Number.isFinite) || cam.zoom <= 0) {
      if (!render.badCamera++) {
        this.event.set("firstBadCamera", { frame: state.frame, cam: { x: cam.x, y: cam.y, zoom: cam.zoom, tx: cam.tx, ty: cam.ty, tz: cam.tz }, fighters: state.fighters.map((f) => ({ x: f.x, y: f.y, action: f.action, stocks: f.stocks })) });
        this.issue("error", "camera", `the camera went non-finite or zero-zoom at frame ${state.frame}`);
        this.probeAt = 0;
      }
    }
    if (!(view.scale > 0) || !Number.isFinite(view.scale) || !view.canvasW || !view.canvasH) {
      if (!render.badView++) {
        this.event.set("firstBadView", { frame: state.frame, ...view });
        this.issue("error", "view", `canvas ${view.canvasW}x${view.canvasH} at scale ${view.scale} (window ${view.w}x${view.h}) from frame ${state.frame}`);
        this.probeAt = 0;
      }
    }
    const live = state.fighters.filter((f) => f.stocks > 0 && f.action !== "dead");
    const seen = live.some((f) => { const p = cam.toScreen(f.x, f.y); return p.x > -100 && p.x < VIEW_W + 100 && p.y > -100 && p.y < VIEW_H + 300; });
    if (live.length && !seen) {
      render.offscreenDraws++;
      if (++this.offscreenRun === 180) this.issue("warn", "offscreen", "no live fighter on screen for 180 draws in a row");
    } else this.offscreenRun = 0;
    render.sprites = drawHealth.sprites - this.base.sprites;
    render.spriteLoading = drawHealth.loading - this.base.loading;
    render.spriteFailed = drawHealth.failed - this.base.failed;
    if (drawHealth.failedCells.size !== render.failedCells.length) render.failedCells = [...drawHealth.failedCells].slice(0, 12);
    if (render.spriteFailed) this.issue("warn", "sprites", "sprite cells that failed to load are drawn as nothing");
    if (drawHealth.loading > this.base.loading && now - this.attachedAt > 6000) this.issue("warn", "sprites", "a fighter is still a loading placeholder 3 s into the fight");
  }

  /** Reads back a thumbnail of the world layer: all paper means the world drew nothing. */
  private probe(ctx: CanvasRenderingContext2D): void {
    this.probeAt = performance.now() + PROBE_EVERY_MS;
    const frame = this.session?.state.frame ?? -1;
    try {
      if ((ctx as CanvasRenderingContext2D & { isContextLost?: () => boolean }).isContextLost?.()) this.issue("error", "canvas", `the canvas context is lost at frame ${frame}`);
      if (!this.probeCtx) {
        const c = document.createElement("canvas");
        c.width = PROBE_W; c.height = PROBE_H;
        this.probeCtx = c.getContext("2d", { willReadFrequently: true })!;
      }
      if (!ctx.canvas.width || !ctx.canvas.height) {
        this.render.probes.push({ frame, ink: 0 });
        this.render.minInk = 0;
        this.issue("error", "blank", `the canvas is ${ctx.canvas.width}x${ctx.canvas.height}: nothing can show`);
        return;
      }
      const p = this.probeCtx;
      p.drawImage(ctx.canvas, 0, 0, PROBE_W, PROBE_H);
      const d = p.getImageData(0, 0, PROBE_W, PROBE_H).data;
      let ink = 0;
      for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - PAPER_RGB[0]) + Math.abs(d[i + 1] - PAPER_RGB[1]) + Math.abs(d[i + 2] - PAPER_RGB[2]) > 12) ink++;
      const share = Math.round((ink / (PROBE_W * PROBE_H)) * 1000) / 1000;
      const probes = this.render.probes;
      if (probes.length >= 30) probes.splice(1, 1);
      probes.push({ frame, ink: share });
      this.render.minInk = Math.min(this.render.minInk, share);
      if (share < BLANK_INK) this.issue("error", "blank", "the world layer drew nothing but paper");
    } catch (error) {
      // a probe that can't read the canvas says so on the event and stops; it must not take the frame loop down
      this.issue("error", "probe", error instanceof Error ? error.message : String(error));
      this.probeAt = Infinity;
    }
  }

  finish(exit: string): void {
    if (this.finished) { console.error(`match event ${this.trace} finished twice (${exit})`); return; }
    this.finished = true;
    if (this.waitMs > 0) this.endWait();
    if (this.renderer) this.renderer.afterWorld = null;
    const st = this.session?.state;
    if (st?.ended) this.event.set("result", { winner: st.winner, stocks: st.fighters.map((f) => f.stocks) });
    this.summarize(exit);
    finishEvent(this.event, exit);
  }

  private summarize(state: string): void {
    const waited = this.net.waitingMs ? ` · waited ${(this.net.waitingMs / 1000).toFixed(1)} s` : "";
    this.event.set("summary", { message: `${this.start.config.players.length}p ${this.start.config.stage} · slot ${this.start.localSlot} · ${this.net.frames} frames · ${state}${waited}` });
  }
}
