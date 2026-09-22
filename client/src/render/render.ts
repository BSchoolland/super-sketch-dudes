import type { Fighter, State } from "../../../shared/types";
import { roster } from "../../../shared/fighters/index";
import { defOf, currentMove } from "../../../shared/fighter";
import { hitboxWorld, hurtbox, shieldCircle } from "../../../shared/hits";
import { stageOf } from "../../../shared/sim";
import { Camera, VIEW_H, VIEW_W } from "./camera";
import { Fx } from "./fx";
import { animFor, drawRig, poseAt, resolvePose, tintColors, type ResolvedPose } from "./rig";
import { drawBackdrop, drawShadow, drawStage } from "./stage";
import { SLOT_COLORS, createHud, drawHud, type HudState } from "./hud";

interface Ghost { x: number; y: number; facing: number; rp: ResolvedPose; age: number; colors: Record<string, string> }

export class Renderer {
  cam = new Camera();
  fx: Fx;
  hud: HudState;
  ghosts: Ghost[] = [];
  time = 0;
  showHitboxes = false;
  names: string[];
  private prevPos: { x: number; y: number }[] = [];
  private curPos: { x: number; y: number }[] = [];
  private prevProj: Map<number, { x: number; y: number }> = new Map();
  private curProj: Map<number, { x: number; y: number }> = new Map();

  constructor(state: State, names: string[]) {
    this.fx = new Fx(SLOT_COLORS);
    this.hud = createHud(state.fighters.length);
    this.names = names;
    this.snapshot(state);
    this.prevPos = this.curPos.map((p) => ({ ...p }));
  }

  /** Call after every sim step. */
  snapshot(state: State): void {
    this.prevPos = this.curPos;
    this.curPos = state.fighters.map((f) => ({ x: f.x, y: f.y }));
    this.prevProj = this.curProj;
    this.curProj = new Map(state.projectiles.map((p) => [p.id, { x: p.x, y: p.y }]));
    // afterimages for fast moves
    state.fighters.forEach((f, i) => {
      const mv = f.action === "attack" ? currentMove(f) : null;
      const fast = (mv?.fx === "trail") || f.action === "dash" || f.action === "roll" || (f.action === "air" && Math.abs(f.vx) > 9) || f.action === "airDodge";
      if (fast && state.frame % 2 === 0) {
        const def = defOf(f);
        const a = animFor(f, def);
        const rp = resolvePose(def, poseAt(a.keys, a.frame, a.loop));
        this.ghosts.push({ x: f.x, y: f.y, facing: f.facing, rp, age: 0, colors: tintColors(def, i, SLOT_COLORS) });
      }
    });
  }

  draw(ctx: CanvasRenderingContext2D, state: State, alpha: number, dt: number): void {
    this.time += dt;
    const stage = stageOf(state);
    const interp = state.fighters.map((f, i) => {
      const a = this.prevPos[i] ?? f, b = this.curPos[i] ?? f;
      // don't interpolate across respawn teleports
      if (Math.abs(b.x - a.x) > 400 || Math.abs(b.y - a.y) > 400) return { x: b.x, y: b.y };
      return { x: a.x + (b.x - a.x) * alpha, y: a.y + (b.y - a.y) * alpha };
    });
    this.cam.solve(state, stage, interp);
    this.cam.update(dt);
    this.fx.update(dt);
    for (const g of this.ghosts) g.age += dt;
    this.ghosts = this.ghosts.filter((g) => g.age < 0.22);

    ctx.save();
    drawBackdrop(ctx, stage, this.cam, this.time);
    ctx.save();
    this.cam.apply(ctx);
    drawStage(ctx, state, stage);
    // shadows
    state.fighters.forEach((f, i) => { if (f.action !== "dead") drawShadow(ctx, state, stage, interp[i].x, interp[i].y, defOf(f).stats.width * 0.8); });
    // ghosts
    for (const g of this.ghosts) {
      ctx.save();
      ctx.translate(g.x, g.y);
      ctx.scale(g.facing, 1);
      drawRig(ctx, g.rp, g.colors, "rgba(255,255,255,0)", { alpha: 0.35 * (1 - g.age / 0.22), flash: "#ffffff", outlineWidth: 0 });
      ctx.restore();
    }
    // projectiles
    for (const p of state.projectiles) {
      const a = this.prevProj.get(p.id) ?? p, b = this.curProj.get(p.id) ?? p;
      const x = a.x + (b.x - a.x) * alpha, y = a.y + (b.y - a.y) * alpha;
      drawProjectile(ctx, p.kind, x, y, p.vx, p.vy, p.hb.r, SLOT_COLORS[p.owner] ?? "#fff", this.time);
    }
    // fighters, back to front by slot (the one who was hit last draws on top)
    const order = state.fighters.map((f) => f).sort((a, b) => a.lastHitFrame - b.lastHitFrame);
    for (const f of order) this.drawFighter(ctx, state, f, interp[f.slot]);
    this.fx.drawWorld(ctx);
    if (this.showHitboxes) this.drawBoxes(ctx, state);
    ctx.restore();
    this.fx.drawScreen(ctx, VIEW_W, VIEW_H, this.cam);
    drawHud(ctx, state, this.hud, dt, this.names);
    ctx.restore();
  }

  private drawFighter(ctx: CanvasRenderingContext2D, state: State, f: Fighter, pos: { x: number; y: number }): void {
    if (f.action === "dead") return;
    const def = roster[f.id];
    const a = animFor(f, def);
    const pose = poseAt(a.keys, a.frame, a.loop);
    const rp = resolvePose(def, pose);
    const colors = tintColors(def, f.slot, SLOT_COLORS);
    ctx.save();
    let jx = 0, jy = 0;
    if (f.hitlag > 0 && f.pending) { jx = (Math.random() - 0.5) * 8; jy = (Math.random() - 0.5) * 6; }
    ctx.translate(pos.x + jx, pos.y + jy);
    // smash charge: vibrate and glow
    if (f.action === "smashCharge") {
      const c = f.charge / 60;
      ctx.translate((Math.random() - 0.5) * 6 * c, 0);
      ctx.save();
      ctx.globalAlpha = 0.25 + c * 0.35;
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.ellipse(0, -def.stats.height / 2, def.stats.width + 30 * c, def.stats.height * 0.65 + 30 * c, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    ctx.scale(f.facing, 1);
    const dodging = f.action === "airDodge" || f.action === "spotDodge" || f.action === "roll" || f.action === "getupRoll" || f.action === "techRoll" || f.action === "ledgeRoll";
    const blink = f.invuln > 0 && !dodging && f.action !== "respawn" && (state.frame >> 2) % 2 === 0;
    const alpha = f.action === "respawn" ? 0.8 : dodging && f.invuln > 0 ? 0.45 : blink ? 0.7 : 1;
    const flash = f.hitlag > 0 && f.pending ? "#ffffff" : undefined;
    drawRig(ctx, rp, colors, def.palette.outline, { alpha, flash, outlineWidth: 3 });
    ctx.restore();
    // shield bubble
    if (f.shieldHeld || f.action === "shieldStun") {
      const sc = shieldCircle(f);
      ctx.save();
      ctx.globalAlpha = 0.45;
      const c = SLOT_COLORS[f.slot] ?? "#fff";
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.arc(pos.x + (sc.x - f.x), pos.y + (sc.y - f.y), sc.r, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();
    }
    // charge bar for specials with a charge
    if (f.special.charge > 0 && f.action === "attack") {
      ctx.save();
      ctx.fillStyle = "#12101a"; ctx.fillRect(pos.x - 32, pos.y - def.stats.height - 30, 64, 8);
      ctx.fillStyle = "#fff"; ctx.fillRect(pos.x - 30, pos.y - def.stats.height - 28, 60 * Math.min(1, f.special.charge / 60), 4);
      ctx.restore();
    }
    // slot marker above the head
    ctx.save();
    ctx.fillStyle = SLOT_COLORS[f.slot] ?? "#fff";
    ctx.strokeStyle = "#12101a"; ctx.lineWidth = 3;
    const my = pos.y - def.stats.height - 22 - Math.sin(this.time * 6 + f.slot) * 3;
    ctx.beginPath(); ctx.moveTo(pos.x - 9, my - 12); ctx.lineTo(pos.x + 9, my - 12); ctx.lineTo(pos.x, my); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.font = "900 14px 'Trebuchet MS', sans-serif"; ctx.textAlign = "center"; ctx.lineWidth = 3;
    ctx.strokeText(`P${f.slot + 1}`, pos.x, my - 18); ctx.fillText(`P${f.slot + 1}`, pos.x, my - 18);
    ctx.restore();
  }

  private drawBoxes(ctx: CanvasRenderingContext2D, state: State): void {
    ctx.save();
    ctx.lineWidth = 2;
    for (const f of state.fighters) {
      if (f.action === "dead") continue;
      const h = hurtbox(f);
      ctx.strokeStyle = f.invuln > 0 ? "#4dff88" : "#ffe066";
      ctx.fillStyle = "rgba(255,224,102,0.18)";
      capsulePath(ctx, h.x1, h.y1, h.x2, h.y2, h.r); ctx.fill(); ctx.stroke();
      const mv = f.action === "attack" ? currentMove(f) : null;
      if (mv) for (const hb of mv.hitboxes) {
        if (f.frame < hb.frames[0] || f.frame > hb.frames[1]) continue;
        const c = hitboxWorld(f, hb);
        ctx.strokeStyle = hb.grab ? "#c77dff" : "#ff3b3b";
        ctx.fillStyle = hb.grab ? "rgba(199,125,255,0.3)" : hb.priority === 0 ? "rgba(255,255,255,0.4)" : "rgba(255,59,59,0.3)";
        capsulePath(ctx, c.x1, c.y1, c.x2, c.y2, c.r); ctx.fill(); ctx.stroke();
      }
    }
    for (const p of state.projectiles) { ctx.strokeStyle = "#ff3b3b"; ctx.beginPath(); ctx.arc(p.x, p.y, p.hb.r, 0, Math.PI * 2); ctx.stroke(); }
    ctx.restore();
  }
}

function capsulePath(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, r: number): void {
  ctx.beginPath();
  if (x1 === x2 && y1 === y2) { ctx.arc(x1, y1, r, 0, Math.PI * 2); return; }
  const ang = Math.atan2(y2 - y1, x2 - x1);
  ctx.arc(x1, y1, r, ang + Math.PI / 2, ang - Math.PI / 2);
  ctx.arc(x2, y2, r, ang - Math.PI / 2, ang + Math.PI / 2);
  ctx.closePath();
}

export function drawProjectile(ctx: CanvasRenderingContext2D, kind: string, x: number, y: number, vx: number, vy: number, r: number, color: string, time: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.atan2(vy, vx));
  ctx.fillStyle = "#12101a";
  ctx.beginPath(); ctx.ellipse(0, 0, r + 4, r * 0.7 + 4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.ellipse(0, 0, r, r * 0.7, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.beginPath(); ctx.ellipse(r * 0.3, -r * 0.2, r * 0.4, r * 0.25, 0, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.moveTo(-r, 0); ctx.lineTo(-r * 3 - Math.sin(time * 40) * 4, -r * 0.5); ctx.lineTo(-r * 3, r * 0.5); ctx.closePath(); ctx.fill();
  ctx.restore();
  void kind;
}
