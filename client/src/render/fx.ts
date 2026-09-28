import { inkArc, inkLine, INK, PENCIL } from "./paper";
import type { GameEvent, State } from "../../../shared/types";
import type { Camera } from "./camera";
import { defOf } from "../../../shared/fighter";
import { lookColor, lookOf } from "./looks";
import { markerOf } from "./strikes";

interface Particle { x: number; y: number; vx: number; vy: number; life: number; age: number; size: number; color: string; kind: "spark" | "dust" | "ring" | "line" | "star" | "ember" | "flame"; grav: number; ang?: number; len?: number; drag: number }
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
  /** Tongues of fire that rise, flicker and shrink; `color` is the body, the core is always yellow. */
  flame(x: number, y: number, n: number, color: string, scale = 1): void {
    for (let i = 0; i < n; i++) {
      this.particles.push({ x: x + this.rnd(-12, 12) * scale, y: y + this.rnd(-4, 4), vx: this.rnd(-30, 30), vy: this.rnd(-200, -90) * Math.sqrt(scale), life: this.rnd(0.28, 0.5), age: 0, size: this.rnd(7, 13) * scale, color, kind: "flame", grav: -140, drag: 2 });
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
  streak(x: number, y: number, ang: number, len: number, color: string): void {
    this.particles.push({ x, y, vx: 0, vy: 0, life: 0.12, age: 0, size: 2, color, kind: "line", grav: 0, drag: 0, ang, len });
  }

  consume(state: State, events: GameEvent[], cam: Camera): void {
    for (const e of events) {
      switch (e.t) {
        case "hit": {
          const def = e.attacker >= 0 ? defOf(state.fighters[e.attacker]) : null;
          const look = def ? lookOf(def, e.fx) : null;
          const family = e.fx === "fire" ? "#ffc43a" : e.fx === "energy" && def ? markerOf(def) : e.fx === "slash" || e.fx === "tip" ? "#f4f0ff" : null;
          const c = look ? lookColor(look, this.colors[e.attacker] ?? "#fff") : family ?? this.colors[e.attacker] ?? "#fff";
          const big = e.damage >= 12;
          const flame = e.fx === "fire" || look?.texture === "flame";
          const energy = e.fx === "energy" || look?.texture === "glow";
          if (flame) for (let i = 0; i < 6; i++) this.particles.push({ x: e.x, y: e.y, vx: this.rnd(-80, 80), vy: this.rnd(-260, -80), life: this.rnd(0.3, 0.6), age: 0, size: this.rnd(6, 12), color: look?.color ?? "#ff4d2e", kind: "ember", grav: -120, drag: 2 });
          if (energy) { this.ring(e.x, e.y, 90, c, 0.3); this.lineBurst(e.x, e.y, 0, 6, c, 90); }
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
        case "fx": {
          const c = e.color ?? this.colors[e.slot] ?? "#fff";
          if (e.kind === "sparks") this.spark(e.x, e.y, e.n, 260, c, 3, 0.3);
          else if (e.kind === "flame") this.flame(e.x, e.y, e.n, e.color ?? "#ff8a2a", e.size ?? 1);
          else if (e.kind === "smoke") this.dust(e.x, e.y, e.n, 0);
          else if (e.kind === "shake") cam.holdTrauma(e.size ?? 0.3);
          else this.ring(e.x, e.y, 30 + e.n * 10, c, 0.3);
          break;
        }
        default: break;
      }
    }
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
      const t = p.age / p.life, a = 1 - t;
      const color = p.color.includes("255,255,255") || p.color === "#fff" || p.color === "#ffffff" || p.color === "#f4f0ff" ? INK : p.color;
      ctx.globalAlpha = a;
      if (p.kind === "ring") {
        inkArc(ctx, p.x, p.y, p.size * (0.3 + t * 0.9), 0.1, Math.PI * 1.95, color, Math.max(1.5, 4 * a));
        inkArc(ctx, p.x + 2, p.y - 1, p.size * (0.3 + t * 0.9) + 4, 0.5, 2.4, color, 1);
      } else if (p.kind === "line") {
        const len = (p.len ?? 40) * (1 - t * 0.5);
        inkLine(ctx, p.x, p.y, p.x - Math.cos(p.ang!) * len, p.y - Math.sin(p.ang!) * len, color, p.size * a + 1);
      } else if (p.kind === "flame") {
        const h = p.size * (1.8 - t * 1.2), w = p.size * (1 - t * 0.4);
        const wob = Math.sin(p.age * 28 + p.x * 0.1) * w * 0.35;
        const tongue = (s: number, fill: string) => {
          ctx.beginPath();
          ctx.moveTo(p.x - w * s * 0.5, p.y);
          ctx.quadraticCurveTo(p.x - w * s * 0.55 + wob * 0.4, p.y - h * s * 0.5, p.x + wob * s, p.y - h * s);
          ctx.quadraticCurveTo(p.x + w * s * 0.55 + wob * 0.4, p.y - h * s * 0.5, p.x + w * s * 0.5, p.y);
          ctx.closePath();
          ctx.fillStyle = fill; ctx.fill();
        };
        tongue(1, t < 0.6 ? p.color : "#c93a1c");
        tongue(0.55, "#ffd84a");
        ctx.globalAlpha = a * 0.5;
        ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.stroke();
      } else if (p.kind === "dust") {
        ctx.globalAlpha *= 0.5;
        inkArc(ctx, p.x, p.y, p.size * (0.6 + t * 0.8), Math.PI * 1.05, Math.PI * 1.9, PENCIL, 1);
      } else {
        const r = p.size * (1 - t * 0.6);
        ctx.beginPath();
        ctx.moveTo(p.x - r, p.y); ctx.lineTo(p.x - r * 0.3, p.y - r); ctx.lineTo(p.x + r * 0.8, p.y - r * 0.6); ctx.lineTo(p.x + r, p.y + r); ctx.lineTo(p.x, p.y + r * 0.4); ctx.closePath();
        ctx.fillStyle = color; ctx.fill();
        if (p.kind === "ember") inkLine(ctx, p.x - r, p.y, p.x + r, p.y - r, "#ffc43a", 2);
      }
    }
    for (const b of this.bursts) {
      const t = b.age / b.life, r = 60 + t * 500;
      ctx.globalAlpha = 1 - t;
      inkArc(ctx, b.x, b.y, r, 0, Math.PI * 2, b.color, 8 * (1 - t) + 2);
      inkArc(ctx, b.x + 3, b.y - 2, r * 0.7, 0, Math.PI * 2, INK, 2);
      for (let i = 0; i < 14; i++) {
        const a = i * Math.PI / 7;
        inkLine(ctx, b.x + Math.cos(a) * r, b.y + Math.sin(a) * r, b.x + Math.cos(a) * (r + 35), b.y + Math.sin(a) * (r + 35), b.color, 4);
      }
    }
    ctx.restore();
  }

  /** Screen-space effects (call outside the camera transform). */
  drawScreen(ctx: CanvasRenderingContext2D, w: number, h: number, cam: Camera): void {
    for (const f of this.flashes) {
      const t = f.age / f.life;
      ctx.globalAlpha = f.alpha * (1 - t);
      ctx.fillStyle = "#ffffff";
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
      ctx.fillStyle = INK;
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
