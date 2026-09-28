import { VIEW_H, VIEW_W } from "../render/camera";
import { PENCIL } from "../render/paper";
import type { MenuInput } from "../input/devices";
import { consumeTaps } from "../input/pointer";
import { sfx } from "../audio/audio";
import { mapsApi, myMaps, refreshMaps } from "../maps";
import { stageFromMap, type MapDoc } from "../../../shared/maps";
import { drawStageThumb } from "./stage";
import { bg, card, label, title, type Screen, INK } from "./ui";
import { ButtonMenu, type Button } from "./buttons";
import { RED } from "./character";
import type { Nav } from "./nav";

const COLS = 4, ROWS = 2, W = 400, H = 260, GAP = 40, TOP = 150;
const X0 = (VIEW_W - (COLS * W + (COLS - 1) * GAP)) / 2;

/** MAPS: the player's maps as cards, NEW MAP, and a long-press DELETE on the focused one. */
export class MapsScreen implements Screen {
  t = 0;
  private menu = new ButtonMenu();
  private scroll = 0;
  private deleteArmed = -Infinity;
  private problem = "";

  constructor(private nav: Nav) {}

  enter(): void {
    void refreshMaps();
  }

  private get docs(): MapDoc[] {
    return myMaps.docs ?? [];
  }

  private buttons(): Button[] {
    const docs = this.docs;
    const rows = Math.ceil(docs.length / COLS);
    const b: Button[] = docs.map((_, i) => {
      const row = Math.floor(i / COLS) - this.scroll;
      const visible = row >= 0 && row < ROWS;
      return { id: `m${i}`, x: X0 + (i % COLS) * (W + GAP), y: visible ? TOP + row * (H + GAP) : -9999, w: W, h: H, text: "", custom: true };
    });
    if (this.scroll > 0) b.push({ id: "up", x: VIEW_W - 110, y: TOP, w: 80, h: 80, text: "▲", size: 40 });
    if (this.scroll + ROWS < rows) b.push({ id: "down", x: VIEW_W - 110, y: TOP + ROWS * (H + GAP) - 120, w: 80, h: 80, text: "▼", size: 40 });
    const armed = this.t - this.deleteArmed < 3;
    if (myMaps.canCreate) b.push({ id: "new", x: VIEW_W / 2 - 250, y: VIEW_H - 150, w: 500, h: 110, text: "NEW MAP", size: 44 });
    if (docs.length && this.menu.focus < docs.length) b.push({ id: "delete", x: VIEW_W - 320, y: VIEW_H - 130, w: 280, h: 90, text: armed ? "SURE?" : "DELETE", size: 34 });
    b.push({ id: "back", x: 40, y: VIEW_H - 130, w: 240, h: 90, text: "BACK", size: 40 });
    return b;
  }

  update(dt: number, m: MenuInput): Screen | null {
    this.t += dt;
    const buttons = this.buttons();
    const focusedMap = this.menu.focus < this.docs.length ? this.docs[this.menu.focus] : null;
    const pressed = this.menu.update(buttons, this.menu.grid(m, COLS, this.docs.length, buttons.length), consumeTaps());
    const f = this.menu.focus;
    if (f < this.docs.length) {
      const row = Math.floor(f / COLS);
      if (row < this.scroll) this.scroll = row;
      if (row >= this.scroll + ROWS) this.scroll = row - ROWS + 1;
    }
    if (pressed === "new") return this.nav.mapEditor(null);
    if (pressed === "back" || m.back) { sfx.menuBack(); return this.nav.title(); }
    if (pressed === "up") this.scroll--;
    if (pressed === "down") this.scroll++;
    if (pressed === "delete" && focusedMap) {
      if (this.t - this.deleteArmed < 3) this.remove(focusedMap);
      else this.deleteArmed = this.t;
    }
    if (pressed?.startsWith("m")) return this.nav.mapEditor(this.docs[Number(pressed.slice(1))]);
    return null;
  }

  private remove(doc: MapDoc): void {
    this.deleteArmed = -Infinity;
    mapsApi.remove(doc.id).then(
      () => { sfx.menuBack(); void refreshMaps(); },
      (error: unknown) => {
        console.error(`delete map ${doc.id} failed`, error);
        this.problem = error instanceof Error ? error.message : String(error);
      },
    );
  }

  draw(ctx: CanvasRenderingContext2D): void {
    bg(ctx, this.t);
    title(ctx, "MAPS", VIEW_W / 2, 100, 72);
    const buttons = this.buttons();
    if (!myMaps.docs) label(ctx, "…", VIEW_W / 2, 500, 60, PENCIL);
    else if (!this.docs.length) label(ctx, myMaps.canCreate ? "nothing here yet: build your first map" : "no maps yet", VIEW_W / 2, 480, 40, PENCIL);
    const focus = this.menu.focus;
    this.docs.forEach((doc, i) => {
      const b = buttons[i];
      if (b.y < 0) return;
      card(ctx, b.x, b.y, b.w, b.h, INK, i === focus);
      drawStageThumb(ctx, stageFromMap(doc), b.x + 12, b.y + 12, b.w - 24, b.h - 70);
      title(ctx, doc.name, b.x + b.w / 2, b.y + b.h - 18, 30, INK, "center", b.w - 30);
    });
    this.menu.draw(ctx, buttons);
    const error = this.problem || myMaps.error;
    if (error) label(ctx, error, VIEW_W / 2, VIEW_H - 170, 24, RED);
  }
}
