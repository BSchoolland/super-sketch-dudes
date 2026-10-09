import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stageList } from "../shared/stages/index";
import { ART_THEMES, type StageManifest } from "../client/src/render/stageart";
import { VIEW_H, VIEW_W } from "../client/src/render/camera";

const PUBLIC = join(__dirname, "../client/public/stages");

describe("shipped stages", () => {
  for (const s of stageList) {
    it(`${s.id}: every solid block has its ledges, spawns stand on one, and the camera box sits inside the blast zone`, () => {
      expect(s.platforms[0].solid).toBe(true);
      const solids = s.platforms.flatMap((p, i) => (p.solid ? [{ p, i }] : []));
      expect(s.ledges).toEqual(solids.flatMap(({ p, i }) => [
        { x: p.x1, y: p.y, side: -1, platform: i },
        { x: p.x2, y: p.y, side: 1, platform: i },
      ]));
      for (const sp of s.spawns) expect(solids.some(({ p }) => sp.x > p.x1 && sp.x < p.x2 && sp.y === p.y), `spawn ${sp.x}`).toBe(true);
      expect(s.respawn.y).toBeLessThan(Math.min(...s.platforms.map((p) => p.y)) - 100);
      const c = s.camera, b = s.blast;
      const x1 = Math.min(...solids.map(({ p }) => p.x1)), x2 = Math.max(...solids.map(({ p }) => p.x2)), bottom = Math.max(...solids.map(({ p }) => p.bottom!));
      expect(b.left < c.left && c.left < x1 && x2 < c.right && c.right < b.right).toBe(true);
      expect(b.top < c.top && c.bottom < b.bottom && bottom < c.bottom).toBe(true);
    });
  }
});

describe("art stages", () => {
  it("every art theme is a shipped stage's", () => {
    for (const t of ART_THEMES) expect(stageList.some((s) => s.theme === t), t).toBe(true);
  });

  for (const theme of ART_THEMES) {
    it(`${theme}: the manifest's images exist, the platform art spans the main platform, and the backdrop fills every planned camera`, () => {
      const file = join(PUBLIC, theme, "stage.json");
      expect(existsSync(file), file).toBe(true);
      const m = JSON.parse(readFileSync(file, "utf8")) as StageManifest;
      for (const l of m.layers) expect(existsSync(join(PUBLIC, theme, l.src)), l.src).toBe(true);
      const stage = stageList.find((s) => s.theme === theme)!;
      const main = stage.platforms[0];
      const plat = m.layers.find((l) => l.depth === 1)!;
      expect(plat.rect[0]).toBeLessThanOrEqual(main.x1);
      expect(plat.rect[2]).toBeGreaterThanOrEqual(main.x2);
      expect(plat.rect[1] < 0 && plat.rect[3] > 0).toBe(true);
      const bg = m.layers[0];
      expect(bg.cover).toBe(true);
      // the parallax model (stageart.ts layerView) at the corners of the cameras captures use, shaken
      const [x1, y1, x2, y2] = bg.rect;
      for (const [xs, ys, zs] of [[[-500, 500], [-700, 50], [1, 5]], [[-800, 800], [-900, 100], [1.2, 5]]]) {
        for (let k = 0; k <= 8; k++) {
          const zoom = zs[0] * (zs[1] / zs[0]) ** (k / 8);
          const z = m.ref.zoom * (zoom / m.ref.zoom) ** bg.depth;
          const hx = (VIEW_W / 2 + 28 * zoom) / z, hy = (VIEW_H / 2 + 22 * zoom) / z;
          for (const x of xs) {
            const cx = m.ref.x + (x - m.ref.x) * bg.depth;
            expect(cx - hx >= x1 && cx + hx <= x2, `x ${x} zoom ${zoom.toFixed(2)}`).toBe(true);
          }
          for (const y of ys) {
            const cy = m.ref.y + (y - m.ref.y) * bg.depth;
            expect(cy - hy >= y1 && cy + hy <= y2, `y ${y} zoom ${zoom.toFixed(2)}`).toBe(true);
          }
        }
      }
    });
  }
});
