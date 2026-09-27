import { VIEW_H, VIEW_W } from "../render/camera";
import { PENCIL } from "../render/paper";
import type { MenuInput } from "../input/devices";
import { consumeTaps } from "../input/pointer";
import { fighterLoad } from "../gen";
import { bg, label, title, type Screen } from "./ui";
import { ButtonMenu, type Button } from "./buttons";
import { RED } from "./character";

const BACK: Button = { id: "back", x: VIEW_W / 2 - 170, y: VIEW_H / 2 + 120, w: 340, h: 96, text: "BACK", size: 40 };

/** Waits for every fighter bundle in the match, then starts it. A bundle that fails stops here, loudly. */
export class LoadingScreen implements Screen {
  t = 0;
  private menu = new ButtonMenu();

  constructor(private bundles: string[], private start: () => Screen, private back: () => Screen) {}

  update(dt: number, m: MenuInput): Screen | null {
    this.t += dt;
    const loads = this.bundles.map((u) => fighterLoad(u));
    const failed = loads.find((l) => l.state === "failed");
    if (failed) {
      if (this.menu.update([BACK], m, consumeTaps()) || m.back) return this.back();
      return null;
    }
    if (loads.every((l) => l.state === "ready")) return this.start();
    if (m.back) return this.back();
    return null;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    bg(ctx, this.t);
    const failed = this.bundles.map((u) => fighterLoad(u)).find((l) => l.state === "failed");
    if (failed) {
      title(ctx, "A FIGHTER DIDN'T LOAD", VIEW_W / 2, VIEW_H / 2 - 40, 72, RED);
      label(ctx, failed.error, VIEW_W / 2, VIEW_H / 2 + 30, 26, RED);
      this.menu.draw(ctx, [BACK]);
      return;
    }
    label(ctx, `loading ${".".repeat(1 + (Math.floor(this.t * 3) % 3))}`, VIEW_W / 2, VIEW_H / 2, 48, PENCIL);
  }
}
