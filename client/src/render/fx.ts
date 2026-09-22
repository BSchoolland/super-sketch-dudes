import type { GameEvent, State } from "../../../shared/types";
import type { Camera } from "./camera";

interface Particle { x: number; y: number; vx: number; vy: number; life: number; age: number; size: number; color: string; kind: "spark" | "dust" | "ring" | "line" | "star" | "ember"; grav: number; ang?: number; len?: number; drag: number }
interface Flash { life: number; age: number; color: string; alpha: number }
interface SlashLine { x: number; y: number; ang: number; life: number; age: number }
interface KoBurst { x: number; y: number; side: string; life: number; age: number; color: string }

export class Fx {
  particles: Particle[] = [];
  flashes: Flash[] = [];
  lines: SlashLine[] = [];
  bursts: KoBurst[] = [];
  hitFreeze = 0;
  private colors: string[];

  constructor(colors: string[]) { this.colors = colors; }

  private rnd(a: number, b: number): number { return a + Math.random() * (b - a); }

  spark(x: number, y: number, n: number, speed: number, color: string, size = 4, life = 0.35): void {
    for (let i = 0; i < n; i++) {
      const a = this.rnd(0, Math.PI * 2), s = this.rnd(speed * 0.3, speed);
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: this.rnd(life * 0.6, life), age: 0, size: this.rnd(size * 0.5, size), color, kind: "spark", grav: 500, drag: 3 });
    }
  }
  dust(x: number, y: number, n: number, dir: number, color = "rgba(255,255,255,0.55)"): void {
    for (let i = 0; i < n; i++) {
      this.particles.push({ x: x + this.rnd(-10, 10), y: y - this.rnd(0, 6), vx: -dir * this.rnd(40, 160) + this.rnd(-40, 40), vy: -this.rnd(20, 90), life: this.rnd(0.25, 0.5), age: 0, size: this.rnd(6, 14), color, kind: "dust", grav: -60, drag: 4 });
    }
  }
  ring(x: number, y: number, size: number, color: string, life = 0.25): void {
    this.particles.push({ x, y, vx: 0, vy: 0, life, age: 0, size, color, kind: "ring", grav: 0, drag: 0 });
  }
  lineBurst(x: number, y: number, ang: number, n: number, color: string, len = 40): void {
    for (let i = 0; i < n; i++) {
      const a = ang + this.rnd(-0.5, 0.5);
      const s = this.rnd(300, 900);
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: this.rnd(0.15, 0.3), age: 0, size: 3, color, kind: "line", grav: 0, drag: 6, ang: a, len });
    }
  }
  flash(color: string, alpha: number, life: number): void { this.flashes.push({ life, age: 0, color, alpha }); }

  consume(state: State, events: GameEvent[], cam: Camera): void {
    for (const e of events) {
      switch (e.t) {
        case "hit": {
          const family = e.fx === "fire" ? "#ffc43a" : e.fx === "energy" ? "#35e0ff" : e.fx === "slash" || e.fx === "tip" ? "#f4f0ff" : null;
          const c = family ?? this.colors[e.attacker] ?? "#fff";
          const big = e.damage >= 12;
          if (e.fx === "fire") for (let i = 0; i < 6; i++) this.particles.push({ x: e.x, y: e.y, vx: this.rnd(-80, 80), vy: this.rnd(-260, -80), life: this.rnd(0.3, 0.6), age: 0, size: this.rnd(6, 12), color: "#ff4d2e", kind: "ember", grav: -120, drag: 2 });
          if (e.fx === "energy") { this.ring(e.x, e.y, 90, "#35e0ff", 0.3); this.lineBurst(e.x, e.y, 0, 6, "#35e0ff", 90); }
          const ang = Math.atan2(-Math.sin(e.angle * Math.PI / 180), Math.cos(e.angle * Math.PI / 180) * e.facing);
          this.spark(e.x, e.y, Math.min(26, 6 + e.damage * 1.2), 300 + e.damage * 30, "#fff", 5, 0.3);
          this.spark(e.x, e.y, Math.min(18, 4 + e.damage), 200 + e.damage * 20, c, 4, 0.4);
          this.ring(e.x, e.y, 30 + e.damage * 3, e.fx === "tip" ? "#ffffff" : c, 0.22);
          if (e.fx === "tip") { this.ring(e.x, e.y, 70, "#fff", 0.18); this.lineBurst(e.x, e.y, ang, 8, "#fff", 70); }
          if (big) { this.lineBurst(e.x, e.y, ang, 10, "#fff", 50); this.flash("#fff", 0.12, 0.08); }
          if (e.kb > 140) this.lineBurst(e.x, e.y, ang, 14, c, 120);
          cam.addTrauma(Math.min(0.75, 0.12 + e.damage * 0.03 + (e.kb > 120 ? 0.2 : 0)));
          break;
        }
        case "shieldHit":
          this.ring(e.x, e.y, 60, "#8fd3ff", 0.2);
          this.spark(e.x, e.y, 6, 200, "#8fd3ff", 3, 0.25);
          cam.addTrauma(0.08 + e.damage * 0.01);
          break;
        case "parry":
          this.ring(e.x, e.y, 110, "#fff", 0.3);
          this.ring(e.x, e.y, 60, "#fff", 0.2);
          this.lineBurst(e.x, e.y, 0, 16, "#fff", 60);
          this.flash("#fff", 0.2, 0.1);
          break;
        case "land":
          this.dust(e.x, e.y, e.hard ? 12 : 5, 0);
          if (e.hard) cam.addTrauma(0.15);
          break;
        case "jump":
          this.dust(e.x, e.y, e.double ? 8 : 4, 0, e.double ? "rgba(255,255,255,0.8)" : "rgba(255,255,255,0.5)");
          if (e.double) this.ring(e.x, e.y - 20, 40, "rgba(255,255,255,0.8)", 0.18);
          break;
        case "dash":
          this.dust(e.x, e.y, 5, e.facing);
          break;
        case "tech":
          this.ring(e.x, e.y - 30, 70, "#9fffcf", 0.25);
          this.spark(e.x, e.y - 30, 8, 250, "#9fffcf", 3, 0.3);
          break;
        case "ledge":
          this.spark(e.x, e.y - 90, 5, 150, "#fff", 3, 0.25);
          break;
        case "grab":
          this.ring(e.x, e.y, 40, "#ffd166", 0.2);
          break;
        case "throw":
          this.spark(e.x, e.y - 40, 8, 250, "#ffd166", 4, 0.3);
          break;
        case "shieldBreak":
          this.ring(e.x, e.y - 60, 160, "#8fd3ff", 0.5);
          this.spark(e.x, e.y - 60, 30, 500, "#8fd3ff", 5, 0.6);
          this.flash("#8fd3ff", 0.3, 0.15);
          cam.addTrauma(0.6);
          break;
        case "ko": {
          const c = this.colors[e.slot] ?? "#fff";
          this.flash("#fff", 0.55, 0.16);
          const ang = e.side === "left" ? Math.PI : e.side === "right" ? 0 : e.side === "top" ? -Math.PI / 2 : Math.PI / 2;
          this.lines.push({ x: e.x, y: e.y, ang, life: 0.5, age: 0 });
          this.bursts.push({ x: e.x, y: e.y, side: e.side, life: 0.9, age: 0, color: c });
          cam.addTrauma(0.9);
          break;
        }
        case "respawn":
          this.ring(e.x, e.y - 60, 120, "#fff", 0.4);
          break;
        case "projectile":
          this.spark(e.x, e.y, 6, 200, this.colors[e.slot] ?? "#fff", 3, 0.2);
          break;
        default: break;
      }
    }
    void state;
  }

  update(dt: number): void {
    for (const p of this.particles) {
      p.age += dt;
      p.vy += p.grav * dt;
      p.vx -= p.vx * p.drag * dt;
      p.vy -= p.vy * p.drag * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.particles = this.particles.filter((p) => p.age < p.life);
    for (const f of this.flashes) f.age += dt;
    this.flashes = this.flashes.filter((f) => f.age < f.life);
    for (const l of this.lines) l.age += dt;
    this.lines = this.lines.filter((l) => l.age < l.life);
    for (const b of this.bursts) b.age += dt;
    this.bursts = this.bursts.filter((b) => b.age < b.life);
  }

  /** World-space effects (call inside the camera transform). */
  drawWorld(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    for (const p of this.particles) {
      const t = p.age / p.life;
      const a = 1 - t;
      if (p.kind === "ring") {
        ctx.globalAlpha = a * 0.9;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = Math.max(2, 10 * (1 - t));
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.3 + t * 0.9), 0, Math.PI * 2); ctx.stroke();
      } else if (p.kind === "line") {
        ctx.globalAlpha = a;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.size * (1 - t) + 1;
        ctx.lineCap = "round";
        const len = (p.len ?? 40) * (1 - t * 0.5);
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - Math.cos(p.ang!) * len, p.y - Math.sin(p.ang!) * len); ctx.stroke();
      } else if (p.kind === "ember") {
        ctx.globalAlpha = a;
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.ellipse(p.x, p.y, p.size * 0.5 * (1 - t * 0.5), p.size * (1 - t * 0.5), 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#ffc43a";
        ctx.beginPath(); ctx.ellipse(p.x, p.y + 2, p.size * 0.25, p.size * 0.5, 0, 0, Math.PI * 2); ctx.fill();
      } else if (p.kind === "dust") {
        ctx.globalAlpha = a * 0.7;
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.6 + t * 0.8), 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.globalAlpha = a;
        ctx.fillStyle = p.color;
        const s = p.size * (1 - t * 0.6);
        ctx.beginPath(); ctx.arc(p.x, p.y, s, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    for (const b of this.bursts) {
      const t = b.age / b.life;
      ctx.globalAlpha = 1 - t;
      ctx.strokeStyle = b.color;
      ctx.lineWidth = 14 * (1 - t) + 2;
      const r = 60 + t * 500;
      ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 6 * (1 - t) + 1;
      ctx.strokeStyle = "#fff";
      ctx.beginPath(); ctx.arc(b.x, b.y, r * 0.7, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  /** Screen-space effects (call outside the camera transform). */
  drawScreen(ctx: CanvasRenderingContext2D, w: number, h: number, cam: Camera): void {
    for (const f of this.flashes) {
      const t = f.age / f.life;
      ctx.globalAlpha = f.alpha * (1 - t);
      ctx.fillStyle = f.color;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.globalAlpha = 1;
    for (const l of this.lines) {
      const t = l.age / l.life;
      const p = cam.toScreen(l.x, l.y);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(l.ang);
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = "#fff";
      const len = 2600 * Math.min(1, t * 4);
      const thick = 26 * (1 - t) + 2;
      ctx.beginPath();
      ctx.moveTo(-len, 0); ctx.lineTo(0, -thick); ctx.lineTo(len, 0); ctx.lineTo(0, thick); ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
}
