import { VIEW_H, VIEW_W } from "../render/camera";
import type { PreviewApi } from "../preview";
import type { MenuInput } from "../input/devices";
import { rumble } from "../input/devices";
import { armTouch, pad, touchLive, touchShown } from "../input/touch";
import { drawTouchControls } from "../render/touchcontrols";
import { viewBleed, viewScale } from "../input/pointer";
import { noteTouchMatch } from "../telemetry/events";
import { LocalMatch, type MatchDriver, type SlotSource } from "../match";
import { Renderer } from "../render/render";
import { drawBanner, TEAM_COLORS, TEAM_NAMES } from "../render/hud";
import { music, StateSounds, playEvents, sfx } from "../audio/audio";
import { card, label, title, button, goTo, type Screen, INK, settings } from "./ui";
import type { MatchConfig } from "../../../shared/sim";
import type { Fighter } from "../../../shared/types";
import { B } from "../../../shared/input";
import { roster } from "../../../shared/fighters/index";
import { currentMove } from "../../../shared/fighter";
import { knockback } from "../../../shared/hits";
import { DEFAULT_TIER } from "../../../shared/cpu-skill";

type Rect = { x: number; y: number; w: number; h: number };

const STEP = 1000 / 60;
/** On touch, the HUD's percent and names are drawn at least this many CSS pixels per view pixel's worth. */
const HUD_CSS = 0.48;
/** Seconds after the match ends before the touch REMATCH / MENU take a tap. */
const END_TAPS_AFTER = 2;

export class VersusScreen implements Screen {
  match: MatchDriver;
  renderer: Renderer;
  stateSounds = new StateSounds();
  acc = 0;
  countdown = 3.2;
  bannerT = 0;
  endedFor = 0;
  pauseSel = 0;
  training: boolean;
  suddenT = 0;
  dummyToggled = false;
  /** A generated fighter's hook threw: shown for a few seconds. */
  hookErr: { text: string; detail: string; t: number } | null = null;
  /** Preview tooling: the clock doesn't tick; frames advance only through debugStep. */
  frozen = false;
  preview: PreviewApi | null = null;
  /** REMATCH / MENU on the result screen; a mode that moves on by itself turns them off. */
  endButtons = true;
  private touchNoted = false;
  /** This match shows the touch controls (keyboard 1 plays in it and is on the touchscreen). */
  protected touchView = false;
  constructor(cfg: MatchConfig, sources: SlotSource[], private onExit: () => Screen, private onRematch: () => Screen, training = false, driver?: MatchDriver) {
    this.match = driver ?? new LocalMatch(cfg, sources);
    this.training = training;
    const names = sources.map((s, i) => (s.cpu ? "CPU" : `P${i + 1}`));
    this.renderer = new Renderer(this.match.state, names);
    this.renderer.showHitboxes = training;
    if (training) {
      this.match.state.fighters.forEach((f) => (f.stocks = 99));
      if (this.match.sources[1]) { this.match.sources[1].cpu = 0; this.match.state.fighters[1].cpu = 0; this.renderer.names[1] = "DUMMY"; }
      this.resetTraining();
    }
  }
  /** Whether the match is running for this client: online adds the connection's say. */
  protected running(): boolean {
    return !this.match.paused && !this.match.state.ended;
  }

  /** The touch controls for this tick, before update: up while the match runs, for keyboard 1 (whom they play as). */
  armControls(): void {
    this.touchView = touchShown() && this.match.sources.some((s) => s.device === "kb1");
    armTouch(this.touchView && this.running(), this.match instanceof LocalMatch);
    // the controls sit at the screen's edges, so the fight fills it too
    this.renderer.cam.bleed = this.touchView ? viewBleed() : { x: 0, y: 0 };
  }

  update(dt: number, m: MenuInput): Screen | null {
    let st = this.match.state;
    if (!this.touchNoted && touchLive() && pad.touched) { this.touchNoted = true; noteTouchMatch(); }
    if (this.countdown > 0) {
      const before = Math.ceil(this.countdown);
      this.countdown -= dt;
      if (Math.ceil(this.countdown) !== before && this.countdown > 0) sfx.countdown();
      if (this.countdown <= 0) sfx.go();
      // let players move during the countdown? No: hold them, but keep the renderer alive.
      this.renderer.fx.update(dt);
      return null;
    }
    if (st.ended) {
      this.endedFor += dt;
      if (this.endedFor > 1.2 && (m.confirm || m.start)) { return this.onRematch(); }
      if (this.endedFor > 1.2 && m.back) { return this.onExit(); }
    }
    if (this.match.paused) {
      const items = this.pauseItems();
      if (m.up || m.down) { this.pauseSel = (this.pauseSel + (m.up ? items.length - 1 : 1)) % items.length; sfx.menuMove(); }
      if (m.confirm) { const next = items[this.pauseSel].act(); if (next) return next; }
      if (m.back) this.match.paused = false;
    }
    const slow = st.slowmo > 0 ? 0.25 : 1;
    this.acc += dt * 1000 * slow;
    let n = 0;
    // after a hitch the sim catches up, to a quarter second: dropped sim time would put an online client behind the match
    while (!this.frozen && this.acc >= STEP && n < 15) {
      const ticked = this.match.tick();
      const corrections = this.match.takeCorrections?.();
      if (corrections?.length) this.renderer.correct(corrections);
      if (ticked) {
        this.renderer.snapshot(this.match.state);
        this.acc -= STEP;
        n++;
      } else if (this.match.stalled) {
        // waiting on a remote: keep the owed time (bounded) so the sim catches up to the shared clock once it arrives
        this.acc = Math.min(this.acc, 15 * STEP);
        break;
      } else {
        this.acc -= STEP;
        n++;
      }
    }
    st = this.match.state;
    // training helpers: reset with practice+shield, dummy CPU toggles with practice+special
    if (this.training) {
      const inp = this.match.lastInputs[0];
      if ((inp.b & B.PRACTICE) && (inp.b & B.SHIELD)) this.resetTraining();
      const d = st.fighters[1];
      if (d && (inp.b & B.PRACTICE) && !(inp.b & B.SHIELD)) {
        if (inp.y <= -60) d.percent = Math.min(999, d.percent + 1);
        if (inp.y >= 60) d.percent = Math.max(0, d.percent - 1);
      }
      if (d && (inp.b & B.PRACTICE) && (inp.b & B.SPECIAL) && !this.dummyToggled) { this.toggleDummy(); this.dummyToggled = true; }
      if (!((inp.b & B.PRACTICE) && (inp.b & B.SPECIAL))) this.dummyToggled = false;
    }
    const events = this.match.takeEvents();
    if (events.some((e) => e.t === "suddenDeath")) this.suddenT = 2.5;
    for (const e of events) if (e.t === "hookError") {
      console.error(`hook error in ${roster[st.fighters[e.slot].id].name}.${e.move}: ${e.error}`);
      this.hookErr = { text: `${roster[st.fighters[e.slot].id].name}'S ${e.move.toUpperCase()} EXPLODED`, detail: e.error.slice(0, 90), t: 0 };
    }
    if (this.hookErr) { this.hookErr.t += dt; if (this.hookErr.t > 4) this.hookErr = null; }
    this.suddenT = Math.max(0, this.suddenT - dt);
    this.renderer.fx.consume(st, events, this.renderer.cam);
    playEvents(st, events);
    if (!this.match.paused) this.stateSounds.update(dt, st);
    if (settings.rumble) for (const e of events) {
      if (e.t === "hit") {
        // victim -1: the attacker batted a projectile back
        const v = e.victim >= 0 ? this.match.sources[e.victim] : null;
        if (v?.device) rumble(v.device, Math.min(1, e.damage / 20), 0.5, 80 + e.damage * 8);
        const a = this.match.sources[e.attacker];
        if (a.device) rumble(a.device, 0.2, 0.6, 60);
      }
      if (e.t === "ko") for (const s of this.match.sources) if (s.device) rumble(s.device, 1, 1, 400);
    }
    music.muffle(this.match.paused || st.ended);
    return null;
  }
  /**
   * The pause menu. On touch, practice's helpers live here: there is no practice key on a touchscreen.
   * An item's act returns the screen to go to, if it leaves.
   */
  private pauseItems(): { text: string; act: () => Screen | null }[] {
    const resume = { text: "RESUME", act: () => { this.match.paused = false; return null; } };
    const quit = { text: "QUIT TO MENU", act: () => this.onExit() };
    if (!(this.training && this.touchView)) return [resume, quit];
    const dummy = this.match.sources[1];
    return [
      resume,
      { text: "RESET POSITIONS", act: () => { this.resetTraining(); this.match.paused = false; return null; } },
      { text: dummy.cpu ? "DUMMY: FIGHTS BACK" : "DUMMY: STANDS STILL", act: () => { this.toggleDummy(); return null; } },
      quit,
    ];
  }
  private toggleDummy(): void {
    const on = !this.match.sources[1].cpu, d = this.match.state.fighters[1];
    this.match.sources[1].cpu = on ? DEFAULT_TIER : 0;
    d.cpu = on ? DEFAULT_TIER : 0;
    this.renderer.names[1] = on ? "CPU" : "DUMMY";
  }
  resetTraining(): void {
    const st = this.match.state;
    st.fighters.forEach((f, i) => { f.percent = 0; f.x = i === 0 ? -250 : 0; f.y = 0; f.vx = 0; f.vy = 0; f.action = "idle"; f.frame = 0; f.grounded = true; f.platform = 0; f.hitlag = 0; f.pending = null; f.hitstun = 0; f.move = null; f.ledge = -1; f.grabbing = -1; f.grabbedBy = -1; f.facing = i === 0 ? 1 : -1; });
    st.projectiles = [];
  }
  private drawTrainingOverlay(ctx: CanvasRenderingContext2D): void {
    const st = this.match.state;
    const f = st.fighters[0], d = st.fighters[1];
    if (!f || !d) return;
    const mv = f.action === "attack" ? currentMove(f) : null;
    const lines = [
      `${roster[f.id].name}  ${f.action}${f.move ? ` · ${f.move}` : ""}  frame ${f.frame}${mv ? `/${mv.total}` : ""}`,
      mv ? `active ${mv.hitboxes.filter((h) => !h.grab).map((h) => `${h.frames[0]}-${h.frames[1]}`).join(", ") || "none"} · iasa ${mv.iasa ?? mv.total + 1}${mv.landingLag ? ` · landing lag ${mv.landingLag}` : ""}` : `vx ${f.vx.toFixed(1)} vy ${f.vy.toFixed(1)}${f.grounded ? " grounded" : " airborne"}${f.hitlag ? ` hitlag ${f.hitlag}` : ""}`,
      `dummy ${roster[d.id].name} ${d.percent}%  ${d.action}${d.hitstun && (d.action === "hitstun" || d.action === "tumble") ? ` hitstun ${d.hitstun - d.frame}` : ""}${d.shieldHeld ? ` shield ${d.shield.toFixed(0)}` : ""}`,
      mv && mv.hitboxes.length && !mv.hitboxes[0].grab ? `${mv.hitboxes[0].damage} dmg · kb at ${d.percent}%: ${knockback(d.percent + mv.hitboxes[0].damage, mv.hitboxes[0].damage, roster[d.id].stats.weight, mv.hitboxes[0].growth, mv.hitboxes[0].base).toFixed(0)}` : "",
    ];
    ctx.save();
    ctx.fillStyle = "rgba(244,239,228,0.95)";
    ctx.beginPath(); ctx.roundRect(20, 20, 620, 26 + lines.length * 26, 10); ctx.fill();
    lines.forEach((t, i) => label(ctx, t, 36, 46 + i * 26, 18, INK, "left", 600));
    ctx.restore();
  }
  /** Advance n sim frames right now, feeding the events to the renderer, regardless of the frame clock. */
  debugStep(n: number): void {
    for (let i = 0; i < n; i++) if (this.match.tick()) this.renderer.snapshot(this.match.state);
    this.acc = STEP;
    const st = this.match.state;
    const events = this.match.takeEvents();
    for (const e of events) if (e.t === "hookError") this.hookErr = { text: `${roster[st.fighters[e.slot].id].name}'S ${e.move.toUpperCase()} EXPLODED`, detail: e.error.slice(0, 90), t: 0 };
    this.renderer.fx.consume(st, events, this.renderer.cam);
  }

  draw(ctx: CanvasRenderingContext2D, dt: number): void {
    const st = this.match.state;
    const alpha = this.match.paused || this.countdown > 0 ? 1 : Math.min(1, this.acc / STEP);
    const touch = touchLive();
    // on touch the HUD keeps between the controls, paused too, and is drawn up to a readable size on a small screen
    this.renderer.hudBand = this.touchView ? pad.layout.free : null;
    this.renderer.hudScale = this.touchView ? Math.max(1, HUD_CSS / viewScale()) : 1;
    this.renderer.draw(ctx, st, alpha, dt);
    if (touch) drawTouchControls(ctx, { layout: pad.layout, stick: pad.stickView(), held: (b) => pad.held(b), pause: pad.pauseable ? pad.pauseHeld : null });
    if (this.countdown > 0) {
      const n = Math.ceil(this.countdown - 0.2);
      const text = n >= 1 ? `${n}` : "GO!";
      const frac = 1 - ((this.countdown - 0.2) % 1);
      ctx.save();
      ctx.translate(VIEW_W / 2, VIEW_H / 2 - 60);
      const s = 1.6 - frac * 0.5;
      ctx.scale(s, s);
      title(ctx, text, 0, 40, 140, INK);
      ctx.restore();
      if (this.training) label(ctx, this.touchView ? "PRACTICE: pause to reset or wake the dummy" : "PRACTICE: T+shield resets · T+up/down sets dummy % · T+special toggles dummy CPU · F2 hitboxes + frame data", VIEW_W / 2, VIEW_H / 2 + 80, this.touchView ? 40 : 22, INK);
    } else if (this.training && this.renderer.showHitboxes) {
      this.drawTrainingOverlay(ctx);
    }
    if (this.training && !this.touchView && !this.match.paused && !st.ended && button(ctx, 40, VIEW_H - 100, 200, 64, "BACK", { size: 26 })) { sfx.menuBack(); goTo(this.onExit()); }
    if (this.suddenT > 0 && !st.ended) drawBanner(ctx, "SUDDEN DEATH", "300% · one stock · first hit wins", "#ff3b3b", Math.min(1, (2.5 - this.suddenT) * 2 + 0.2));
    if (this.hookErr && !st.ended) drawBanner(ctx, this.hookErr.text, this.hookErr.detail, "#ff4d2e", Math.min(1, this.hookErr.t * 2 + 0.2));
    if (st.ended) {
      this.bannerT += dt;
      // a team battle's winner is a team
      const w = st.winner, teams = st.rules.teams, colors = this.renderer.colors;
      const won = (f: Fighter): boolean => w >= 0 && (teams ? f.team === w : f.slot === w);
      const who = teams ? `${TEAM_NAMES[w]} TEAM` : this.renderer.names[w];
      drawBanner(ctx, w >= 0 ? "GAME!" : "DRAW", w >= 0 ? `${who} wins` : "", w >= 0 ? (teams ? TEAM_COLORS[w] : colors[w]) : INK, this.bannerT);
      if (this.endedFor > 1.2) {
        // results; on touch bigger, as wide as six cards allow
        const y = VIEW_H / 2 + 90, n = st.fighters.length;
        const k = this.touchView ? Math.min(1.35, (VIEW_W - 80) / (n * 220)) : 1, cw = 200 * k, step = 220 * k;
        st.fighters.forEach((f, i) => {
          const x = VIEW_W / 2 - (n * step) / 2 + i * step + (this.touchView ? (step - cw) / 2 : 0);
          card(ctx, x, y, cw, 130 * k, colors[i], won(f));
          label(ctx, this.renderer.names[i], x + cw / 2, y + 32 * k, 22 * k, INK, "center", 900, cw - 16);
          label(ctx, roster[f.id].name, x + cw / 2, y + 56 * k, 16 * k, INK, "center", 700, cw - 16);
          label(ctx, `KOs ${f.kos}   falls ${f.falls}`, x + cw / 2, y + 86 * k, 18 * k, INK);
          label(ctx, `dealt ${Math.round(f.dealt)}%`, x + cw / 2, y + 112 * k, 18 * k, INK);
        });
        if (this.endButtons) this.drawEndButtons(ctx);
      }
    } else if (this.match.paused) {
      const items = this.pauseItems();
      drawBanner(ctx, "PAUSED", "", INK, 1);
      if (this.touchView) {
        // finger-sized, two to a row past two
        const cols = items.length > 2 ? 2 : 1, h = 112, gap = 18, w = cols > 1 ? 600 : 640, top = VIEW_H / 2 + 80;
        items.forEach((item, i) => {
          const x = VIEW_W / 2 - (cols * w + (cols - 1) * gap) / 2 + (i % cols) * (w + gap), y = top + Math.floor(i / cols) * (h + gap);
          if (button(ctx, x, y, w, h, item.text, { focused: this.pauseSel === i, size: 40 })) { const next = item.act(); if (next) goTo(next); }
        });
      } else {
        const y = VIEW_H / 2 + 80;
        items.forEach((item, i) => {
          if (button(ctx, VIEW_W / 2 - 200, y + i * 80, 400, 64, item.text, { focused: this.pauseSel === i, size: 26, key: i === 0 ? "Esc" : undefined })) { const next = item.act(); if (next) goTo(next); }
        });
      }
    }
  }

  /**
   * REMATCH and MENU. On touch they're where the thumbs already are, MENU under the stick and REMATCH under ATTACK,
   * finger-sized, with no keys written on them, and they take a tap only once the result has been up a moment: a
   * thumb still mashing ATTACK as the last stock goes is no vote for a rematch.
   */
  private drawEndButtons(ctx: CanvasRenderingContext2D): void {
    const { rematch, menu } = this.endButtonRects();
    if (!this.touchView) {
      if (button(ctx, rematch.x, rematch.y, rematch.w, rematch.h, "REMATCH", { key: "Enter", size: 28 })) goTo(this.onRematch());
      if (button(ctx, menu.x, menu.y, menu.w, menu.h, "MENU", { key: "Esc", size: 28 })) goTo(this.onExit());
      return;
    }
    const disabled = this.endedFor < END_TAPS_AFTER;
    if (button(ctx, rematch.x, rematch.y, rematch.w, rematch.h, "REMATCH", { size: 52, disabled })) goTo(this.onRematch());
    if (button(ctx, menu.x, menu.y, menu.w, menu.h, "MENU", { size: 52, disabled })) goTo(this.onExit());
  }

  /** Where REMATCH and MENU are on the result screen, in view pixels. */
  endButtonRects(): { rematch: Rect; menu: Rect } {
    if (!this.touchView) {
      const y = VIEW_H / 2 + 90 + 160;
      return { rematch: { x: VIEW_W / 2 - 330, y, w: 300, h: 70 }, menu: { x: VIEW_W / 2 + 30, y, w: 300, h: 70 } };
    }
    const l = pad.layout, w = 440, h = 150, y = l.buttons.attack.y - h / 2;
    return {
      menu: { x: Math.max(l.stick.x - l.stick.r, l.stick.x - w / 2), y, w, h },
      rematch: { x: Math.min(l.buttons.attack.x + l.buttons.attack.r, l.buttons.attack.x + w / 2) - w, y, w, h },
    };
  }
}
