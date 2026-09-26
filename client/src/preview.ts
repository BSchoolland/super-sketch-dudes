import type { VersusScreen } from "./screens/versus";
import { defOf, setAction, startMove } from "../../shared/fighter";
import { stageOf } from "../../shared/sim";

/**
 * What forge/tools/preview.ts drives through window.sketchbattle.preview: place the fighters, start a
 * move, step frames, ask where things are on screen. Only exists with ?quick=1&preview=1.
 */
export interface PreviewApi {
  moves(slot: number): Record<string, { total: number; first: number | null; last: number | null; aerial: boolean }>;
  stage(): { floorY: number; cx: number };
  pose(slot: number, x: number, y: number, facing: 1 | -1, airborne: boolean): void;
  start(slot: number, move: string): void;
  step(n: number): void;
  fighter(slot: number): { x: number; y: number; sx: number; sy: number; action: string; frame: number; move: string | null; hookErr: string | null };
}

export function previewApi(v: VersusScreen): PreviewApi {
  const st = () => v.match.state;
  return {
    moves(slot) {
      const def = defOf(st().fighters[slot]);
      const out: ReturnType<PreviewApi["moves"]> = {};
      for (const [id, mv] of Object.entries(def.moves)) {
        const hbs = mv.hitboxes.filter((h) => !h.grab && !mv.throwFrame);
        out[id] = { total: mv.total, first: hbs.length ? Math.min(...hbs.map((h) => h.frames[0])) : null, last: hbs.length ? Math.max(...hbs.map((h) => h.frames[1])) : null, aerial: !!mv.aerial };
      }
      return out;
    },
    stage() {
      const s = stageOf(st());
      const main = s.platforms.find((p) => p.solid) ?? s.platforms[0];
      return { floorY: main.y, cx: (main.x1 + main.x2) / 2 };
    },
    pose(slot, x, y, facing, airborne) {
      const s = st(), f = s.fighters[slot];
      const main = stageOf(s).platforms.findIndex((p) => p.solid);
      f.x = x; f.y = y; f.vx = 0; f.vy = 0; f.facing = facing; f.moveFacing = facing;
      f.grounded = !airborne; f.platform = airborne ? -1 : Math.max(0, main);
      f.percent = 0; f.hitlag = 0; f.hitstun = 0; f.invuln = 0; f.jumpsLeft = defOf(f).stats.jumps; f.usedUpSpecial = false;
      setAction(f, airborne ? "air" : "idle");
      s.projectiles.length = 0;
      v.hookErr = null;
      v.renderer.snapshot(s); v.renderer.snapshot(s);
    },
    start(slot, move) { startMove(st(), st().fighters[slot], move); },
    step(n) { v.debugStep(n); },
    fighter(slot) {
      const f = st().fighters[slot];
      const p = v.renderer.cam.toScreen(f.x, f.y);
      return { x: f.x, y: f.y, sx: p.x, sy: p.y, action: f.action, frame: f.frame, move: f.move, hookErr: v.hookErr ? `${v.hookErr.text}: ${v.hookErr.detail}` : null };
    },
  };
}
