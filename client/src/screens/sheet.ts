import { drawPaper, INK } from "../render/paper";
import { VIEW_H, VIEW_W } from "../render/camera";
import type { MenuInput } from "../input/devices";
import { roster } from "../../../shared/fighters/index";
import { drawRig, poseAt, resolvePose } from "../render/rig";
import { hitboxWorld, hurtbox } from "../../../shared/hits";
import { label, type Screen } from "./ui";
import { drawStrikes } from "../render/strikes";
import type { Fighter } from "../../../shared/types";

/**
 * Debug contact sheet: every move of one fighter drawn at its first active frame (or mid-move),
 * with hitboxes. ?sheet=<fighter>&page=<n>. This is how poses get reviewed without playing.
 */
export class SheetScreen implements Screen {
  t = 0;
  constructor(private fighterId: string, private page = 0) {}
  update(_dt: number, m: MenuInput): Screen | null {
    if (m.right) this.page++;
    if (m.left) this.page = Math.max(0, this.page - 1);
    return null;
  }
  draw(ctx: CanvasRenderingContext2D, dt: number): void {
    this.t += dt;
    const def = roster[this.fighterId] ?? roster.sable;
    drawPaper(ctx, VIEW_W, VIEW_H);
    const entries: { name: string; keys: ReturnType<typeof poseAt> extends infer _ ? any : never; frame: number; loop?: number; move?: string }[] = [];
    for (const [name, keys] of Object.entries(def.rig.anims)) entries.push({ name, keys, frame: Math.floor(this.t * 60), loop: def.rig.loops[name] });
    for (const mv of Object.values(def.moves)) {
      const first = mv.hitboxes.find((h) => !h.grab) ?? mv.hitboxes[0];
      const frame = first ? first.frames[0] : Math.floor(mv.total / 2);
      entries.push({ name: mv.id, keys: mv.poses, frame, move: mv.id });
    }
    const cols = 8, rows = 4, per = cols * rows;
    const pageEntries = entries.slice(this.page * per, this.page * per + per);
    const cw = VIEW_W / cols, ch = VIEW_H / rows;
    label(ctx, `${def.name} poses · page ${this.page + 1}/${Math.ceil(entries.length / per)} (left/right)`, 16, 24, 18, INK, "left");
    pageEntries.forEach((e, i) => {
      const cx = (i % cols) * cw + cw / 2, cy = Math.floor(i / cols) * ch + ch - 40;
      ctx.save();
      ctx.strokeStyle = "rgba(41,39,34,0.15)";
      ctx.strokeRect((i % cols) * cw, Math.floor(i / cols) * ch, cw, ch);
      ctx.translate(cx, cy);
      ctx.fillStyle = "rgba(41,39,34,0.2)";
      ctx.fillRect(-cw / 2 + 10, 0, cw - 20, 2);
      const scale = 1.1;
      ctx.scale(scale, scale);
      const rp = resolvePose(def, poseAt(e.keys, e.frame, e.loop));
      drawRig(ctx, rp, def.palette.colors, def.palette.outline);
      if (e.move) {
        const mv = def.moves[e.move];
        const fake = { x: 0, y: 0, moveFacing: 1, facing: 1, frame: e.frame, action: "attack", id: def.id, move: e.move, hitlag: 0, slot: 0 } as unknown as Fighter;
        drawStrikes(ctx, fake, { x: 0, y: 0 }, "#ff4d4d", this.t);
        const hb = hurtbox({ ...fake, action: "idle" } as Fighter);
        ctx.strokeStyle = "#ffe066"; ctx.lineWidth = 1.5;
        capsule(ctx, hb.x1, hb.y1, hb.x2, hb.y2, hb.r); ctx.stroke();
        for (const h of mv.hitboxes) {
          if (e.frame < h.frames[0] || e.frame > h.frames[1]) continue;
          const c = hitboxWorld(fake, h);
          ctx.strokeStyle = h.grab ? "#c77dff" : h.priority === 0 ? "#ffffff" : "#ff3b3b";
          ctx.setLineDash([4, 4]);
          capsule(ctx, c.x1, c.y1, c.x2, c.y2, c.r); ctx.stroke();
          ctx.setLineDash([]);
        }
      }
      ctx.restore();
      label(ctx, `${e.name}${e.move ? ` f${e.frame}` : ""}`, cx, Math.floor(i / cols) * ch + 20, 14, INK);
    });
  }
}

function capsule(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, r: number): void {
  ctx.beginPath();
  if (x1 === x2 && y1 === y2) { ctx.arc(x1, y1, r, 0, Math.PI * 2); return; }
  const ang = Math.atan2(y2 - y1, x2 - x1);
  ctx.arc(x1, y1, r, ang + Math.PI / 2, ang - Math.PI / 2);
  ctx.arc(x2, y2, r, ang - Math.PI / 2, ang + Math.PI / 2);
  ctx.closePath();
}
