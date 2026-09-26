import { VIEW_H, VIEW_W } from "../render/camera";
import type { MenuInput } from "../input/devices";
import { rumble } from "../input/devices";
import { LocalMatch, type MatchDriver, type SlotSource } from "../match";
import { Renderer } from "../render/render";
import { drawBanner, SLOT_COLORS } from "../render/hud";
import { Music, playEvents, sfx } from "../audio/audio";
import { card, label, title, type Screen, INK, settings } from "./ui";
import { stageOf, type MatchConfig } from "../../../shared/sim";
import { B } from "../../../shared/input";
import { roster } from "../../../shared/fighters/index";
import { currentMove } from "../../../shared/fighter";
import { knockback } from "../../../shared/hits";

const STEP = 1000 / 60;

export class VersusScreen implements Screen {
  match: MatchDriver;
  renderer: Renderer;
  music = new Music();
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
  endHint = "attack: rematch · shield: back to menu";
  constructor(cfg: MatchConfig, sources: SlotSource[], private onExit: () => Screen, private onRematch: () => Screen, training = false, driver?: MatchDriver) {
    this.match = driver ?? new LocalMatch(cfg, sources);
    this.training = training;
    const names = sources.map((s, i) => (s.cpu ? "CPU" : `P${i + 1}`));
    this.renderer = new Renderer(this.match.state, names);
    this.renderer.showHitboxes = training;
    if (training) { this.match.state.fighters.forEach((f) => (f.stocks = 99)); if (this.match.sources[1]) { this.match.sources[1].cpu = 0; this.match.state.fighters[1].cpu = 0; this.renderer.names[1] = "DUMMY"; } }
  }
  enter(): void { this.music.start(stageOf(this.match.state).theme); }
  update(dt: number, m: MenuInput): Screen | null {
    let st = this.match.state;
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
      if (this.endedFor > 1.2 && (m.confirm || m.start)) { this.music.stop(); return this.onRematch(); }
      if (this.endedFor > 1.2 && m.back) { this.music.stop(); return this.onExit(); }
    }
    if (this.match.paused) {
      if (m.up || m.down) { this.pauseSel = 1 - this.pauseSel; sfx.menuMove(); }
      if (m.confirm) { if (this.pauseSel === 0) { this.match.paused = false; } else { this.music.stop(); return this.onExit(); } }
      if (m.back) this.match.paused = false;
    }
    const slow = st.slowmo > 0 ? 0.25 : 1;
    this.acc += dt * 1000 * slow;
    let n = 0;
    while (this.acc >= STEP && n < 4) {
      if (this.match.tick()) {
        this.renderer.snapshot(this.match.state);
        this.acc -= STEP;
        n++;
      } else if (this.match.stalled) {
        this.acc = Math.min(this.acc, STEP);
        break;
      } else {
        this.acc -= STEP;
        n++;
      }
    }
    st = this.match.state;
    // training helpers: reset with taunt+shield, hitboxes toggle with grab+shield
    if (this.training) {
      const inp = this.match.lastInputs[0];
      if ((inp.b & B.TAUNT) && (inp.b & B.SHIELD)) this.resetTraining();
      const d = st.fighters[1];
      if (d && (inp.b & B.TAUNT) && !(inp.b & B.SHIELD)) {
        if (inp.y <= -60) d.percent = Math.min(999, d.percent + 1);
        if (inp.y >= 60) d.percent = Math.max(0, d.percent - 1);
      }
      if (d && (inp.b & B.TAUNT) && (inp.b & B.GRAB) && !this.dummyToggled) { const on = !this.match.sources[1].cpu; this.match.sources[1].cpu = on ? 5 : 0; d.cpu = on ? 5 : 0; this.renderer.names[1] = on ? "CPU" : "DUMMY"; this.dummyToggled = true; }
      if (!((inp.b & B.TAUNT) && (inp.b & B.GRAB))) this.dummyToggled = false;
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
    playEvents(events);
    if (settings.rumble) for (const e of events) {
      if (e.t === "hit") { const s = this.match.sources[e.victim]; if (s.device) rumble(s.device, Math.min(1, e.damage / 20), 0.5, 80 + e.damage * 8); const a = this.match.sources[e.attacker]; if (a.device) rumble(a.device, 0.2, 0.6, 60); }
      if (e.t === "ko") for (const s of this.match.sources) if (s.device) rumble(s.device, 1, 1, 400);
    }
    const maxP = Math.max(0, ...st.fighters.map((f) => f.percent));
    this.music.update(dt, Math.min(1, maxP / 150 + (st.fighters.some((f) => f.stocks === 1) ? 0.3 : 0)));
    return null;
  }
  resetTraining(): void {
    const st = this.match.state;
    st.fighters.forEach((f, i) => { f.percent = 0; f.x = i === 0 ? -200 : 200; f.y = 0; f.vx = 0; f.vy = 0; f.action = "idle"; f.frame = 0; f.grounded = true; f.platform = 0; f.hitlag = 0; f.pending = null; f.hitstun = 0; f.move = null; f.ledge = -1; f.grabbing = -1; f.grabbedBy = -1; f.facing = i === 0 ? 1 : -1; });
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
  draw(ctx: CanvasRenderingContext2D, dt: number): void {
    const st = this.match.state;
    const alpha = this.match.paused || this.countdown > 0 ? 1 : Math.min(1, this.acc / STEP);
    this.renderer.draw(ctx, st, alpha, dt);
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
      if (this.training) label(ctx, "TRAINING: taunt+shield resets · taunt+up/down sets dummy % · taunt+grab toggles dummy CPU · F2 hitboxes", VIEW_W / 2, VIEW_H / 2 + 80, 22, INK);
    } else if (this.training) {
      this.drawTrainingOverlay(ctx);
    }
    if (this.suddenT > 0 && !st.ended) drawBanner(ctx, "SUDDEN DEATH", "300% · one stock · first hit wins", "#ff3b3b", Math.min(1, (2.5 - this.suddenT) * 2 + 0.2));
    if (this.hookErr && !st.ended) drawBanner(ctx, this.hookErr.text, this.hookErr.detail, "#ff4d2e", Math.min(1, this.hookErr.t * 2 + 0.2));
    if (st.ended) {
      this.bannerT += dt;
      const w = st.winner;
      drawBanner(ctx, w >= 0 ? "GAME!" : "DRAW", w >= 0 ? `${this.renderer.names[w]} wins` : "", w >= 0 ? SLOT_COLORS[w] : INK, this.bannerT);
      if (this.endedFor > 1.2) {
        // results
        const y = VIEW_H / 2 + 90;
        st.fighters.forEach((f, i) => {
          const x = VIEW_W / 2 - (st.fighters.length * 220) / 2 + i * 220;
          card(ctx, x, y, 200, 130, SLOT_COLORS[i], i === w);
          label(ctx, this.renderer.names[i], x + 100, y + 32, 22, INK, "center", 900);
          label(ctx, roster[f.id].name, x + 100, y + 56, 16, INK, "center", 700);
          label(ctx, `KOs ${f.kos}   falls ${f.falls}`, x + 100, y + 86, 18, INK);
          label(ctx, `dealt ${Math.round(f.dealt)}%`, x + 100, y + 112, 18, INK);
        });
        if (this.endHint) label(ctx, this.endHint, VIEW_W / 2, y + 180, 24, INK);
      }
    } else if (this.match.paused) {
      drawBanner(ctx, "PAUSED", "", INK, 1);
      const y = VIEW_H / 2 + 80;
      ["RESUME", "QUIT TO MENU"].forEach((t, i) => {
        card(ctx, VIEW_W / 2 - 200, y + i * 80, 400, 64, this.pauseSel === i ? "#ffc43a" : "rgba(18,16,26,0.8)", this.pauseSel === i);
        label(ctx, t, VIEW_W / 2, y + i * 80 + 44, 28, INK, "center", 900);
      });
    }
  }
}
