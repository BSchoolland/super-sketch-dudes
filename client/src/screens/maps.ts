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
import { ScrollView, type Rect } from "./scroll";

const COLS = 4, W = 400, H = 260, GAP = 40, TOP = 140, BOTTOM = VIEW_H - 180;
const X0 = (VIEW_W - (COLS * W + (COLS - 1) * GAP)) / 2;

/** MAPS: the player's maps as cards, NEW MAP, and a long-press DELETE on the focused one. */
export class MapsScreen implements Screen {
  t = 0;
  private menu = new ButtonMenu();
  private scroll = new ScrollView({ x: X0, y: TOP, w: COLS * W + (COLS - 1) * GAP, h: BOTTOM - TOP });
  /** The focus the scroll last followed: scrolling away from it leaves it be until it moves. */
  private followed = -1;
  private deleteArmed = -Infinity;
  private problem = "";

  constructor(private nav: Nav) {}

  enter(): void {
    void refreshMaps();
  }

  private get docs(): MapDoc[] {
    return myMaps.docs ?? [];
  }

  /** Map `i`'s card in the scroll's content. */
  private cell(i: number): Rect {
    return { x: X0 + (i % COLS) * (W + GAP), y: GAP / 2 + Math.floor(i / COLS) * (H + GAP), w: W, h: H };
  }

  private buttons(): Button[] {
    const docs = this.docs;
    const b: Button[] = docs.map((_, i) => this.scroll.button(`m${i}`, this.cell(i)));
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
    this.scroll.tick(dt, Math.ceil(this.docs.length / COLS) * (H + GAP));
    const f = this.menu.focus;
    if (f !== this.followed || m.up || m.down || m.left || m.right) {
      this.followed = f;
      if (f < this.docs.length) { const c = this.cell(f); this.scroll.reveal(c.y, c.y + H); }
    }
    if (pressed === "new") return this.nav.mapEditor(null);
    if (pressed === "back" || m.back) { sfx.menuBack(); return this.nav.title(); }
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
    this.scroll.draw(ctx, () => this.docs.forEach((doc, i) => {
      const c = this.cell(i);
      if (!this.scroll.shows(c.y, H)) return;
      const y = this.scroll.at(c.y);
      card(ctx, c.x, y, W, H, INK, i === focus);
      drawStageThumb(ctx, stageFromMap(doc), c.x + 12, y + 12, W - 24, H - 70);
      title(ctx, doc.name, c.x + W / 2, y + H - 18, 30, INK, "center", W - 30);
    }));
    this.menu.draw(ctx, buttons);
    const error = this.problem || myMaps.error;
    if (error) label(ctx, error, VIEW_W / 2, VIEW_H - 170, 24, RED);
  }
}
