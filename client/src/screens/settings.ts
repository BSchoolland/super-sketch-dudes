import { VIEW_W } from "../render/camera";
import type { MenuInput } from "../input/devices";
import { setMusicVolume, setVolume, sfx } from "../audio/audio";
import { bg, card, hint, label, title, hover, clicked, arrows, backButton, goTo, type Screen, INK, settings, saveSettings } from "./ui";
import { account } from "../account";

interface Row { name: string; get: () => string; adj: (d: number) => void; act?: () => Screen }

export class SettingsScreen implements Screen {
  t = 0;
  sel = 0;
  rows: Row[] = [
    { name: "SOUND", get: () => `${Math.round(settings.volume * 100)}%`, adj: (d) => { settings.volume = Math.max(0, Math.min(1, settings.volume + d * 0.1)); setVolume(settings.volume); } },
    { name: "MUSIC", get: () => `${Math.round(settings.music * 100)}%`, adj: (d) => { settings.music = Math.max(0, Math.min(1, settings.music + d * 0.1)); setMusicVolume(settings.music); } },
    { name: "SCREEN SHAKE", get: () => `${Math.round(settings.shake * 100)}%`, adj: (d) => { settings.shake = Math.max(0, Math.min(1.5, settings.shake + d * 0.25)); } },
    { name: "TAP JUMP (stick up)", get: () => (settings.tapJump ? "on" : "off"), adj: () => { settings.tapJump = !settings.tapJump; } },
    { name: "RUMBLE", get: () => (settings.rumble ? "on" : "off"), adj: () => { settings.rumble = !settings.rumble; } },
    { name: "DEFAULT CPU LEVEL", get: () => `${settings.cpuLevel}`, adj: (d) => { settings.cpuLevel = Math.max(1, Math.min(9, settings.cpuLevel + d)); } },
    { name: "SIGN OUT", get: () => account.player?.name ?? "", adj: () => {}, act: () => this.onSignOut() },
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
      const y = 160 + i * 96;
      const sel = i === this.sel;
      if (hover(VIEW_W / 2 - 400, y, 800, 76)) this.sel = i;
      card(ctx, VIEW_W / 2 - 400, y, 800, 76, sel ? INK : "rgba(18,16,26,0.6)", sel);
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
    const y = 160 + this.rows.length * 96 + 30;
    label(ctx, "KEYBOARD 1: WASD move · W/Space jump · left click attack · right click special · Shift shield · I grab · U smash modifier · T taunt", VIEW_W / 2, y, 18, INK, "center", 600);
    label(ctx, "KEYBOARD 2: arrows move · Up/Numpad0 jump · Numpad1 attack · 2 special · 3/RShift shield · 4 grab · 6 smash modifier · 5 taunt", VIEW_W / 2, y + 30, 18, INK, "center", 600);
    label(ctx, "GAMEPAD: left stick move · X/Y jump · A attack · B special · LB/RB/LT shield · RT grab · right stick smash · Start pause", VIEW_W / 2, y + 60, 18, INK, "center", 600);
    label(ctx, "tilts: hold a direction then attack · smashes: flick a direction with attack, or the modifier, or the right stick", VIEW_W / 2, y + 100, 18, INK, "center", 600);
    if (backButton(ctx)) { sfx.menuBack(); goTo(this.onBack()); }
    hint(ctx, "click the arrows, or up/down + left/right · Esc: back");
  }
}
