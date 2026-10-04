import { VIEW_W } from "../render/camera";
import { PENCIL } from "../render/paper";
import type { MenuInput } from "../input/devices";
import { setMusicVolume, setVolume, sfx } from "../audio/audio";
import { bg, card, hint, label, title, hover, clicked, arrows, backButton, goTo, type Screen, INK, MAYHEM, settings, saveSettings } from "./ui";
import { account } from "../account";
import { ControlsScreen } from "./controls";

/** `small`: tucked under the rest in pencil, for the ones few players should touch. */
interface Row { name: string; get: () => string; adj: (d: number) => void; act?: () => Screen; small?: boolean }

export class SettingsScreen implements Screen {
  t = 0;
  sel = 0;
  rows: Row[] = [
    { name: "SOUND", get: () => `${Math.round(settings.volume * 100)}%`, adj: (d) => { settings.volume = Math.max(0, Math.min(1, settings.volume + d * 0.1)); setVolume(settings.volume); } },
    { name: "MUSIC", get: () => `${Math.round(settings.music * 100)}%`, adj: (d) => { settings.music = Math.max(0, Math.min(1, settings.music + d * 0.1)); setMusicVolume(settings.music); } },
    { name: "MENU MAYHEM", get: () => MAYHEM[settings.mayhem].name, adj: (d) => { settings.mayhem = Math.max(0, Math.min(MAYHEM.length - 1, settings.mayhem + d)); } },
    { name: "CONTROLS", get: () => "▶", adj: () => {}, act: () => new ControlsScreen(() => this) },
    { name: "SIGN OUT", get: () => account.player?.name ?? "", adj: () => {}, act: () => this.onSignOut() },
    { name: "screen shake", get: () => `${Math.round(settings.shake * 100)}%`, adj: (d) => { settings.shake = Math.max(0, Math.min(1.5, settings.shake + d * 0.25)); }, small: true },
  ];
  constructor(private onBack: () => Screen, private onSignOut: () => Screen) {}
  update(dt: number, m: MenuInput): Screen | null {
    this.t += dt;
    if (m.up) { this.sel = (this.sel + this.rows.length - 1) % this.rows.length; sfx.menuMove(); }
    if (m.down) { this.sel = (this.sel + 1) % this.rows.length; sfx.menuMove(); }
    const row = this.rows[this.sel];
    if (row.act && m.confirm) { sfx.menuBack(); return row.act(); }
    if (!row.act && (m.left || m.right || m.confirm)) { row.adj(m.left ? -1 : 1); saveSettings(); sfx.menuMove(); }
    if (m.back || m.start) { sfx.menuBack(); return this.onBack(); }
    return null;
  }
  draw(ctx: CanvasRenderingContext2D): void {
    bg(ctx, this.t);
    title(ctx, "SETTINGS", VIEW_W / 2, 90, 64);
    this.rows.forEach((r, i) => {
      const sel = i === this.sel;
      if (r.small) {
        const y = 170 + i * 96 + 30, w = 520;
        if (hover(VIEW_W / 2 - w / 2, y, w, 56)) this.sel = i;
        if (sel) card(ctx, VIEW_W / 2 - w / 2, y, w, 56, INK, true);
        const d = arrows(ctx, VIEW_W / 2 + 130, y + 36, 60, 20);
        if (d) { r.adj(d); saveSettings(); sfx.menuMove(); }
        label(ctx, r.name, VIEW_W / 2 - w / 2 + 30, y + 36, 24, PENCIL, "left", 700);
        label(ctx, r.get(), VIEW_W / 2 + 130, y + 36, 24, PENCIL, "center", 700);
        return;
      }
      const y = 170 + i * 96;
      if (hover(VIEW_W / 2 - 400, y, 800, 76)) this.sel = i;
      card(ctx, VIEW_W / 2 - 400, y, 800, 76, INK, sel);
      if (r.act) {
        if (clicked(VIEW_W / 2 - 400, y, 800, 76)) { sfx.menuBack(); goTo(r.act()); }
        label(ctx, r.name, VIEW_W / 2 - 370, y + 50, 28, INK, "left", 900);
        label(ctx, r.get(), VIEW_W / 2 + 370, y + 50, 28, INK, "right", 700);
        return;
      }
      const d = arrows(ctx, VIEW_W / 2 + 280, y + 50, 90, 26);
      if (d) { r.adj(d); saveSettings(); sfx.menuMove(); }
      label(ctx, r.name, VIEW_W / 2 - 370, y + 50, 28, INK, "left", 900);
      label(ctx, r.get(), VIEW_W / 2 + 280, y + 50, 28, INK, "center", 900);
    });
    if (backButton(ctx)) { sfx.menuBack(); goTo(this.onBack()); }
    hint(ctx, "click the arrows, or up/down + left/right · Esc: back");
  }
}
