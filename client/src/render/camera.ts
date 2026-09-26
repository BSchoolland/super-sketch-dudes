import type { Stage, State } from "../../../shared/types";
import { defOf } from "../../../shared/fighter";

export const VIEW_W = 1920, VIEW_H = 1080;

export class Camera {
  x = 0; y = -150; zoom = 0.8;
  tx = 0; ty = 0; tz = 0.8;
  trauma = 0;
  shakeX = 0; shakeY = 0;
  /** World units are view pixels and nothing moves the camera (the title screen's brawl). */
  fixed = false;
  private seed = 1;

  solve(state: State, stage: Stage, interp: { x: number; y: number }[]): void {
    if (this.fixed) { this.x = this.tx = VIEW_W / 2; this.y = this.ty = VIEW_H / 2; this.zoom = this.tz = 1; return; }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, n = 0;
    state.fighters.forEach((f, i) => {
      if (f.action === "dead" || f.stocks <= 0) return;
      const p = interp[i] ?? f;
      const h = defOf(f).stats.height;
      minX = Math.min(minX, p.x - 60); maxX = Math.max(maxX, p.x + 60);
      minY = Math.min(minY, p.y - h - 40); maxY = Math.max(maxY, p.y + 30);
      n++;
    });
    if (!n) { minX = -400; maxX = 400; minY = -400; maxY = 100; }
    // always keep some of the main platform in frame so the ground reads
    const main = stage.platforms[0];
    minY = Math.min(minY, main.y - 200);
    maxY = Math.max(maxY, main.y + 60);
    const padX = 280, padY = 200;
    minX -= padX; maxX += padX; minY -= padY; maxY += padY;
    let w = Math.max(maxX - minX, stage.camera.minWidth);
    let h = Math.max(maxY - minY, stage.camera.minWidth * (VIEW_H / VIEW_W));
    let zoom = Math.min(VIEW_W / w, VIEW_H / h);
    zoom = Math.max(0.42, Math.min(1.25, zoom));
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    // clamp to camera bounds
    const halfW = VIEW_W / zoom / 2, halfH = VIEW_H / zoom / 2;
    const b = stage.camera;
    const zoomMin = Math.max(VIEW_W / (b.right - b.left), VIEW_H / (b.bottom - b.top));
    zoom = Math.max(zoom, zoomMin);
    this.tx = Math.min(Math.max(cx, b.left + halfW), b.right - halfW);
    this.ty = Math.min(Math.max(cy, b.top + halfH), b.bottom - halfH);
    this.tz = zoom;
  }

  update(dt: number): void {
    const k = 1 - Math.pow(0.001, dt); // frame-rate independent ease
    this.x += (this.tx - this.x) * k * 0.9;
    this.y += (this.ty - this.y) * k * 0.9;
    this.zoom += (this.tz - this.zoom) * k * 0.6;
    this.trauma = this.fixed ? 0 : Math.max(0, this.trauma - dt * 1.6);
    const s = this.trauma * this.trauma;
    this.seed = (this.seed * 16807) % 2147483647;
    const r1 = (this.seed / 2147483647) * 2 - 1;
    this.seed = (this.seed * 16807) % 2147483647;
    const r2 = (this.seed / 2147483647) * 2 - 1;
    this.shakeX = r1 * s * 28;
    this.shakeY = r2 * s * 22;
  }

  addTrauma(t: number): void { this.trauma = Math.min(1, this.trauma + t); }

  apply(ctx: CanvasRenderingContext2D): void {
    ctx.translate(VIEW_W / 2, VIEW_H / 2);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.x + this.shakeX, -this.y + this.shakeY);
  }

  toScreen(x: number, y: number): { x: number; y: number } {
    return { x: (x - this.x + this.shakeX) * this.zoom + VIEW_W / 2, y: (y - this.y + this.shakeY) * this.zoom + VIEW_H / 2 };
  }
}
