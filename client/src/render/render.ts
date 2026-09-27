import { FONT, INK, PENCIL, inkArc, inkLine } from "./paper";
import type { Fighter, State } from "../../../shared/types";
import { defOf, currentMove } from "../../../shared/fighter";
import { hitboxWorld, hurtbox, shieldCircle } from "../../../shared/hits";
import { stageOf } from "../../../shared/sim";
import { Camera, VIEW_H, VIEW_W } from "./camera";
import { Fx } from "./fx";
import { animFor, poseAt } from "./rig";
import { drawSprite, FLOOR_ANIMS, restOnFloor, stillSprites, stillTilt } from "./sprite";
import { cellFor } from "../../../shared/gen/sprite";
import type { FighterDef, Look, Pose } from "../../../shared/types";
import { drawBackdrop, drawShadow, drawStage } from "./stage";
import { SLOT_COLORS, createHud, drawHud, type HudState } from "./hud";
import { drawStrikes, inWindup } from "./strikes";
import { drawLook, lookColor, lookOf, type LookAt } from "./looks";
import type { Projectile } from "../../../shared/types";

interface Ghost { x: number; y: number; facing: number; age: number; def: FighterDef; cell: string; flip: boolean; pose: Pose; spinAround: "feet" | "middle" }
interface ProjGhost { def: FighterDef; look: Look; at: LookAt; age: number }

export class Renderer {
  cam = new Camera();
  fx: Fx;
  hud: HudState;
  ghosts: Ghost[] = [];
  projGhosts: ProjGhost[] = [];
  time = 0;
  showHitboxes = false;
  /** Backdrop, HUD and the slot markers over heads; the title screen's brawl draws fighters only. */
  chrome = true;
  names: string[];
  /** Runs once the world layer is on the canvas, before screen effects and the HUD. */
  afterWorld: ((ctx: CanvasRenderingContext2D) => void) | null = null;
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
    for (const p of state.projectiles) {
      if (p.dead) continue;
      const def = defOf(state.fighters[p.from]);
      const look = lookOf(def, p.kind);
      if (!look) continue;
      const trail = look.trail ?? (look.cell ? "none" : "streak");
      const color = lookColor(look, SLOT_COLORS[p.owner] ?? "#fff");
      const ang = Math.atan2(p.vy, p.vx);
      if (trail === "ghost" && state.frame % 2 === 0) this.projGhosts.push({ def, look, at: this.projAt(p, p.x, p.y, true), age: 0 });
      else if (trail === "streak") this.fx.streak(p.x, p.y, ang, Math.hypot(p.vx, p.vy) * 3, color);
      else if (trail === "smoke") this.fx.dust(p.x, p.y + 4, 1, 0);
      else if (trail === "sparks" && state.frame % 2 === 0) this.fx.spark(p.x, p.y, 2, 140, color, 3, 0.3);
    }
    // afterimages for fast moves
    state.fighters.forEach((f) => {
      const mv = f.action === "attack" ? currentMove(f) : null;
      const striking = !!mv && !mv.throwFrame && mv.hitboxes.some((h) => !h.grab && f.frame >= h.frames[0] && f.frame <= h.frames[1]);
      const fast = (mv?.fx === "trail") || striking || f.action === "dash" || f.action === "roll" || (f.action === "air" && Math.abs(f.vx) > 9) || f.action === "airDodge";
      if (fast && state.frame % 2 === 0) {
        const def = defOf(f);
        const a = animFor(f, def);
        const c = cellFor(f, def, a.name);
        const pose = poseAt(a.keys, a.frame, a.loop);
        this.ghosts.push({ x: f.x, y: f.y, facing: f.facing, age: 0, def, ...c, pose: FLOOR_ANIMS.has(a.name) ? restOnFloor(def, c.cell, pose) : pose, spinAround: !f.grounded && !FLOOR_ANIMS.has(a.name) ? "middle" : "feet" });
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
    for (const g of this.projGhosts) g.age += dt;
    this.projGhosts = this.projGhosts.filter((g) => g.age < 0.22);
    this.ghosts = this.ghosts.filter((g) => g.age < 0.22);

    ctx.save();
    if (this.chrome) drawBackdrop(ctx, stage, this.cam);
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
      drawSprite(ctx, g.def, g.cell, g.pose, { alpha: 0.35 * (1 - g.age / 0.22), ghost: true, flip: g.flip, spinAround: g.spinAround });
      ctx.restore();
    }
    // projectiles
    for (const g of this.projGhosts) drawLook(ctx, g.def, g.look, { ...g.at, alpha: 0.35 * (1 - g.age / 0.22) });
    for (const p of state.projectiles) {
      const a = this.prevProj.get(p.id) ?? p, b = this.curProj.get(p.id) ?? p;
      const x = a.x + (b.x - a.x) * alpha, y = a.y + (b.y - a.y) * alpha;
      const def = defOf(state.fighters[p.from]);
      const look = lookOf(def, p.kind);
      if (look) drawLook(ctx, def, look, this.projAt(p, x, y));
      else drawProjectile(ctx, x, y, p.vx, p.vy, p.hb.r, SLOT_COLORS[p.owner] ?? "#fff");
    }
    // fighters, back to front by slot (the one who was hit last draws on top)
    const order = state.fighters.map((f) => f).sort((a, b) => a.lastHitFrame - b.lastHitFrame);
    for (const f of order) this.drawFighter(ctx, state, f, interp[f.slot]);
    for (const f of order) if (f.action === "attack") drawStrikes(ctx, f, interp[f.slot], SLOT_COLORS[f.slot] ?? "#fff", this.time);
    this.fx.drawWorld(ctx);
    if (this.showHitboxes) this.drawBoxes(ctx, state);
    ctx.restore();
    this.afterWorld?.(ctx);
    this.fx.drawScreen(ctx, VIEW_W, VIEW_H, this.cam);
    if (this.chrome) drawHud(ctx, state, this.hud, dt, this.names);
    ctx.restore();
  }

  private projAt(p: Projectile, x: number, y: number, ghost = false): LookAt {
    return { x, y, angle: Math.atan2(p.vy, p.vx), r: p.hb.r, len: 0, facing: p.facing, frame: p.age, ghost };
  }

  private drawFighter(ctx: CanvasRenderingContext2D, state: State, f: Fighter, pos: { x: number; y: number }): void {
    if (f.action === "dead") return;
    const def = defOf(f);
    const a = animFor(f, def);
    const pose = poseAt(a.keys, a.frame, a.loop);
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
      inkArc(ctx, 0, -def.stats.height / 2, def.stats.height * 0.65 + 30 * c, 0, Math.PI * 2, INK, 1.5);
      ctx.restore();
    }
    ctx.scale(f.facing, 1);
    const vis = def.visual?.(f);
    if (vis?.glow) {
      ctx.save();
      ctx.globalAlpha = 0.18 + vis.glow * 0.3;
      inkArc(ctx, 0, -def.stats.height / 2, def.stats.width * (0.8 + vis.glow), 0, Math.PI * 1.8, PENCIL, 1);
      ctx.restore();
    }
    if (vis?.scale) ctx.scale(vis.scale, vis.scale);
    const mvNow = f.action === "attack" ? currentMove(f) : null;
    if (mvNow && !mvNow.throwFrame) {
      if (inWindup(f, mvNow)) {
        // windup: coil back and glow so the strike is announced
        const k = Math.min(1, f.frame / 6);
        ctx.scale(1 - 0.08 * k, 1 + 0.06 * k);
        ctx.save();
        ctx.globalAlpha = 0.18 + 0.22 * k;
        inkArc(ctx, 0, -def.stats.height / 2, def.stats.height * 0.6, -1, 1, INK, 1.5);
        ctx.restore();
      } else if (mvNow.hitboxes.some((h) => !h.grab && f.frame >= h.frames[0] && f.frame <= h.frames[0] + 2)) {
        ctx.scale(1.1, 0.94);
      }
    }
    const dodging = f.action === "airDodge" || f.action === "spotDodge" || f.action === "roll" || f.action === "getupRoll" || f.action === "techRoll" || f.action === "ledgeRoll";
    const blink = f.invuln > 0 && !dodging && f.action !== "respawn" && (state.frame >> 2) % 2 === 0;
    const alpha = f.action === "respawn" ? 0.8 : dodging && f.invuln > 0 ? 0.45 : blink ? 0.7 : 1;
    const still = stillSprites.has(def.id);
    const c = still ? { cell: "idle", flip: false } : cellFor(f, def, a.name);
    const floored = FLOOR_ANIMS.has(a.name) ? restOnFloor(def, c.cell, pose) : pose;
    const seated = still ? { ...floored, rot: (floored.rot ?? 0) + stillTilt(f.action) } : floored;
    // in the air a lean is a spin about the body; on the ground it tips from the feet
    const spinAround = !f.grounded && !FLOOR_ANIMS.has(a.name) ? "middle" : "feet";
    drawSprite(ctx, def, c.cell, seated, { alpha, flash: f.hitlag > 0 && !!f.pending, flip: c.flip, spinAround });
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
      ctx.strokeStyle = INK; ctx.lineWidth = 2;
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
    if (!this.chrome) return;
    // slot marker above the head
    ctx.save();
    ctx.fillStyle = SLOT_COLORS[f.slot] ?? "#fff";
    ctx.strokeStyle = "#12101a"; ctx.lineWidth = 3;
    const my = pos.y - def.stats.height - 22 - Math.sin(this.time * 6 + f.slot) * 3;
    ctx.beginPath(); ctx.moveTo(pos.x - 9, my - 12); ctx.lineTo(pos.x + 9, my - 12); ctx.lineTo(pos.x, my); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.font = `900 18px ${FONT}`; ctx.textAlign = "center"; ctx.lineWidth = 3;
    ctx.fillText(`P${f.slot + 1}`, pos.x, my - 18);
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

export function drawProjectile(ctx: CanvasRenderingContext2D, x: number, y: number, vx: number, vy: number, r: number, color: string): void {
  ctx.save(); ctx.translate(x, y); ctx.rotate(Math.atan2(vy, vx));
  const marker = "#00bfdc";
  inkArc(ctx, 0, 0, r * 0.75, 0, Math.PI * 2, marker, Math.max(3, r * 0.5));
  inkLine(ctx, -r, 0, r, 0, color, 3, 0, true);
  for (let i = -1; i <= 1; i++) inkLine(ctx, -r * 1.4, i * r * 0.5, -r * 2.7, i * r * 0.7, marker, 1.5, i, true);
  ctx.restore();
}
