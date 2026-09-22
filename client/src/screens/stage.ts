import { VIEW_H, VIEW_W } from "../render/camera";
import type { MenuInput } from "../input/devices";
import { stageList } from "../../../shared/stages/index";
import { sfx } from "../audio/audio";
import { bg, card, hint, label, title, type Screen, INK, settings, saveSettings } from "./ui";
import { drawStage } from "../render/stage";
import type { State } from "../../../shared/types";

export interface MatchSetup { stage: string; stocks: number; time: number }

export class StageScreen implements Screen {
  t = 0;
  sel = 0;
  row = 0; // 0 stage, 1 stocks, 2 time
  constructor(private onStart: (setup: MatchSetup) => Screen, private onBack: () => Screen, private training = false) {}
  update(dt: number, m: MenuInput): Screen | null {
    this.t += dt;
    const rows = this.training ? 1 : 3;
    if (m.up) { this.row = (this.row + rows - 1) % rows; sfx.menuMove(); }
    if (m.down) { this.row = (this.row + 1) % rows; sfx.menuMove(); }
    if (m.left || m.right) {
      const d = m.right ? 1 : -1;
      if (this.row === 0) this.sel = (this.sel + d + stageList.length) % stageList.length;
      if (this.row === 1) settings.stocks = Math.max(1, Math.min(10, settings.stocks + d));
      if (this.row === 2) settings.time = Math.max(0, Math.min(10, settings.time + d));
      saveSettings();
      sfx.menuMove();
    }
    if (m.confirm || m.start) { sfx.go(); return this.onStart({ stage: stageList[this.sel].id, stocks: this.training ? 99 : settings.stocks, time: this.training ? 0 : settings.time * 60 * 60 }); }
    if (m.back) { sfx.menuBack(); return this.onBack(); }
    return null;
  }
  draw(ctx: CanvasRenderingContext2D): void {
    bg(ctx, this.t);
    title(ctx, "STAGE", VIEW_W / 2, 90, 64);
    const w = 460, h = 300, gap = 40;
    const x0 = (VIEW_W - (stageList.length * w + (stageList.length - 1) * gap)) / 2;
    stageList.forEach((st, i) => {
      const x = x0 + i * (w + gap), y = 150;
      card(ctx, x, y, w, h, i === this.sel ? "#ffc43a" : "rgba(18,16,26,0.6)", i === this.sel && this.row === 0);
      // thumbnail: the platforms drawn to scale
      ctx.save();
      ctx.beginPath(); ctx.roundRect(x + 12, y + 12, w - 24, h - 70, 10); ctx.clip();
      ctx.fillStyle = "#f4efe4"; ctx.fillRect(x, y, w, h);
      const sc = (w - 60) / (st.camera.right - st.camera.left);
      ctx.translate(x + w / 2, y + h / 2 + 30);
      ctx.scale(sc, sc);
      const fake = { platOffsets: st.platforms.map(() => ({ dx: 0, dy: 0 })) } as unknown as State;
      drawStage(ctx, fake, st);
      ctx.restore();
      title(ctx, st.name, x + w / 2, y + h - 18, 30, INK);
    });
    if (!this.training) {
      const ry = 520;
      const rowCard = (r: number, y: number, text: string, value: string) => {
        const sel = this.row === r;
        card(ctx, VIEW_W / 2 - 300, y, 600, 80, sel ? "#ffc43a" : "rgba(18,16,26,0.6)", sel);
        label(ctx, text, VIEW_W / 2 - 270, y + 52, 30, INK, "left", 900);
        label(ctx, `◀  ${value}  ▶`, VIEW_W / 2 + 270, y + 52, 30, INK, "right", 900);
      };
      rowCard(1, ry, "STOCKS", `${settings.stocks}`);
      rowCard(2, ry + 100, "TIME", settings.time ? `${settings.time}:00` : "none");
    }
    hint(ctx, "attack / start: fight · shield: back");
    void VIEW_H;
  }
}
