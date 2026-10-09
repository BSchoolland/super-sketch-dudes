import { VIEW_W } from "../render/camera";
import { PENCIL } from "../render/paper";
import type { MenuInput } from "../input/devices";
import { consumeTaps } from "../input/pointer";
import { setMusicVolume, setVolume, sfx } from "../audio/audio";
import { bg, card, hint, label, backButton, goTo, type Screen, INK, MAYHEM, settings, saveSettings } from "./ui";
import { account } from "../account";
import { ButtonMenu, type Button } from "./buttons";
import { drawTabs, otherTabButton, type Tabs } from "./tabs";
import { ControlsPage } from "./controls";

type SettingsTab = "general" | "controls";
const TABS: Tabs<SettingsTab> = { left: { id: "general", text: "GENERAL" }, right: { id: "controls", text: "CONTROLS" } };

interface Row { id: string; name: string; get: () => string; step: (d: -1 | 1) => void }
const ROW = { x: VIEW_W / 2 - 400, w: 800, h: 80, top: 220, gap: 100 };
const SIGN_OUT = { w: 300, h: 80, y: 720 };

const clamp01 = (v: number): number => Math.max(0, Math.min(1, Math.round(v * 10) / 10));

export class SettingsScreen implements Screen {
  t = 0;
  private tab: SettingsTab = "general";
  private menu = new ButtonMenu();
  private controls = new ControlsPage();
  private rows: Row[] = [
    { id: "sound", name: "SOUND VOLUME", get: () => `${Math.round(settings.volume * 100)}%`, step: (d) => { settings.volume = clamp01(settings.volume + d * 0.1); setVolume(settings.volume); } },
    { id: "music", name: "MUSIC VOLUME", get: () => `${Math.round(settings.music * 100)}%`, step: (d) => { settings.music = clamp01(settings.music + d * 0.1); setMusicVolume(settings.music); } },
    { id: "mayhem", name: "MENU MAYHEM", get: () => MAYHEM[settings.mayhem].name, step: (d) => { settings.mayhem = Math.max(0, Math.min(MAYHEM.length - 1, settings.mayhem + d)); } },
    { id: "stages", name: "EXTRA STAGES", get: () => (settings.extraStages ? "ON" : "OFF"), step: () => { settings.extraStages = !settings.extraStages; } },
  ];
  constructor(private onBack: () => Screen, private onSignOut: () => Screen) {}

  private buttons(): Button[] {
    const b: Button[] = this.rows.map((r, i) => ({
      id: r.id, x: ROW.x, y: ROW.top + i * ROW.gap, w: ROW.w, h: ROW.h, text: r.name, custom: true,
      step: (d) => { r.step(d); saveSettings(); },
    }));
    b.push({ id: "signout", x: VIEW_W / 2 - SIGN_OUT.w / 2, y: SIGN_OUT.y, w: SIGN_OUT.w, h: SIGN_OUT.h, text: "SIGN OUT", size: 32 });
    b.push(otherTabButton(TABS, this.tab));
    return b;
  }

  update(dt: number, m: MenuInput): Screen | null {
    this.t += dt;
    const taps = consumeTaps();
    if (this.tab === "controls") {
      const done = this.controls.update(m, taps, otherTabButton(TABS, this.tab));
      if (done === "tab") { sfx.menuConfirm(); this.tab = "general"; this.menu.focus = 0; }
      if (done === "back") { sfx.menuBack(); return this.onBack(); }
      return null;
    }
    const pressed = this.menu.update(this.buttons(), m, taps);
    if (pressed === "tab") { sfx.menuConfirm(); this.tab = "controls"; this.controls.show(taps.length ? null : m.from); }
    if (pressed === "signout") { sfx.menuBack(); return this.onSignOut(); }
    if (m.back) { sfx.menuBack(); return this.onBack(); }
    return null;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    bg(ctx, this.t);
    const tab = otherTabButton(TABS, this.tab);
    if (this.tab === "controls") {
      drawTabs(ctx, TABS, this.tab, this.controls.tabFocused(tab));
      this.controls.draw(ctx, tab);
    } else {
      const buttons = this.buttons();
      const focused = this.menu.focused(buttons);
      drawTabs(ctx, TABS, this.tab, focused?.id === "tab");
      this.rows.forEach((r, i) => {
        const y = ROW.top + i * ROW.gap;
        card(ctx, ROW.x, y, ROW.w, ROW.h, INK, focused?.id === r.id);
        label(ctx, r.name, ROW.x + 30, y + 52, 30, INK, "left", 900);
        label(ctx, `◀   ${r.get()}   ▶`, ROW.x + ROW.w - 150, y + 52, 30, INK, "center", 900);
      });
      if (account.player) label(ctx, `signed in as ${account.player.name}`, VIEW_W / 2, SIGN_OUT.y - 24, 26, PENCIL, "center", 600);
      this.menu.draw(ctx, buttons);
    }
    if (backButton(ctx) && !this.controls.busy) { sfx.menuBack(); goTo(this.onBack()); }
    hint(ctx, this.tab === "controls" ? this.controls.hint : "click, or arrows: up/down to pick, left/right to change · Esc: back");
  }
}
