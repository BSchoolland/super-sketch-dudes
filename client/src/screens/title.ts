import { FONT, PENCIL, inkLine, inkPath } from "../render/paper";
import { VIEW_H, VIEW_W } from "../render/camera";
import type { MenuInput } from "../input/devices";
import { sfx } from "../audio/audio";
import { account, isNew, playingAsGuest, seeNews, unseenReleases } from "../account";
import { site } from "../base";
import { activity } from "../activity";
import { myLibrary, refreshLibrary } from "../fighters";
import { forgeWords } from "./character";
import { PENCIL } from "../render/paper";
import { myMaps, refreshMaps } from "../maps";
import { bg, card, hint, label, title, hover, clicked, goTo, type Screen, INK } from "./ui";
import { pointer } from "../input/pointer";
import { drawAvatar } from "./images";
import { MenuBrawl } from "./brawl";
import { drawNewSticker } from "./sticker";
import { UpdateCard } from "./updatecard";
import { FeedbackResponseCard } from "./feedbackcard";
import { unseenResponses } from "../feedback";
import { MENU_CARD } from "../../../shared/stages/menu";

const MENU_Y = MENU_CARD.y0, MENU_STEP = MENU_CARD.step;

export type Mode = "battle" | "library" | "create" | "maps" | "settings" | "feedback";

const NOTE = { x: 36, y: 24, w: 290, h: 120 };
/** `sel` for the FEEDBACK note in the top left, above the menu, and a guest's SIGN IN in the top right. */
const FEEDBACK = -1, SIGN_IN = -2;
const SIGN_IN_BOX = { x: VIEW_W - 40 - 220, y: 30, w: 220, h: 76 };

function drawFeedbackNote(ctx: CanvasRenderingContext2D, sel: boolean): void {
  const { x, y, w, h } = NOTE;
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate(-0.05);
  ctx.translate(-w / 2, -h / 2);
  inkPath(ctx, [[0, 0], [w, 0], [w, h - 22], [w - 22, h], [0, h]], true, 7);
  ctx.fillStyle = "#f6e27a";
  ctx.fill();
  ctx.lineWidth = sel ? 4.5 : 2.4; ctx.strokeStyle = INK; ctx.stroke();
  title(ctx, "FEEDBACK", w / 2, h / 2 + 16, 46, INK);
  ctx.restore();
}

export function drawLogo(ctx: CanvasRenderingContext2D, y: number): void {
  ctx.save();
  ctx.translate(VIEW_W / 2, y);
  ctx.rotate(-0.04);
  title(ctx, "SUPER", 0, -78, 64, INK);
  title(ctx, "SKETCH DUDES", 0, 40, 150, INK);
  inkLine(ctx, -410, 70, 410, 59, INK, 5);
  inkLine(ctx, -375, 82, 365, 75, INK, 2);
  ctx.restore();
}

/** Who's signed in, top right: the Discord avatar in a circle and the name. A guest has SIGN IN there, beside the name they play under. */
function drawPlayerBadge(ctx: CanvasRenderingContext2D, signInFocused: boolean): void {
  const p = account.player;
  if (!p) return;
  if (playingAsGuest()) {
    const b = SIGN_IN_BOX;
    card(ctx, b.x, b.y, b.w, b.h, "", signInFocused);
    title(ctx, "SIGN IN", b.x + b.w / 2, b.y + 52, 38, INK);
    label(ctx, p.name, b.x - 18, b.y + 50, 28, PENCIL, "right", 700);
    return;
  }
  const r = 30, cx = VIEW_W - 40 - r, cy = 30 + r;
  drawAvatar(ctx, p, cx, cy, r);
  label(ctx, p.name, cx - r - 16, cy + 10, 30, INK, "right", 800);
}

/** The privacy notice and terms, small in the bottom left; a click opens one in place of the game. False: `live` is off. */
export function drawLegalLinks(ctx: CanvasRenderingContext2D, live: boolean): void {
  const y = VIEW_H - 16, size = 18;
  ctx.save();
  ctx.font = `700 ${size}px ${FONT}`;
  let x = 22;
  for (const [text, page] of [["privacy", "privacy"], ["terms", "terms"]] as const) {
    const w = ctx.measureText(text).width;
    const over = live && hover(x - 4, y - size, w + 8, size + 10);
    label(ctx, text, x, y, size, over ? INK : "rgba(41,39,34,0.5)", "left", 700);
    if (over) { inkLine(ctx, x, y + 4, x + w, y + 4, INK, 1.2); document.body.style.cursor = "pointer"; }
    if (live && clicked(x - 4, y - size, w + 8, size + 10)) location.href = `${site.base}${page}`;
    x += w + 22;
  }
  ctx.restore();
}

export class TitleScreen implements Screen {
  t = 0;
  /** A menu row, or FEEDBACK. */
  sel = 0;
  /** MAPS is only offered to accounts that may make them. */
  get items(): { id: Mode; name: string; desc: string }[] {
    return [
      { id: "battle", name: "BATTLE", desc: "Fight the CPU, a friend here, or someone online" },
      { id: "create", name: "NEW CHARACTER", desc: this.forgeNote || "Draw a new character" },
      { id: "library", name: "CHARACTERS", desc: "Yours, and everyone else's to save" },
      ...(myMaps.canCreate ? [{ id: "maps" as const, name: "MAPS", desc: "Build a stage to fight on" }] : []),
      { id: "settings", name: "SETTINGS", desc: "Change settings" },
    ];
  }
  /** How many forges are left, or why there are none, from the library fetch. */
  private get forgeNote(): string {
    return myLibrary.forge ? forgeWords(myLibrary.forge).short : "";
  }
  brawl: MenuBrawl | null = null;
  /** What's new since this player last played, over the menu until they close it. */
  private whatsNew: UpdateCard | null = unseenReleases.length ? new UpdateCard(unseenReleases.splice(0)) : null;
  /** Ben's responses to their feedback they haven't seen, after what's new. */
  private responses: FeedbackResponseCard | null = null;
  /** `onInspect`: a player's character clicked in the brawl, to see and save; `onSignIn`: a guest's SIGN IN. */
  constructor(private onPick: (m: Mode) => Screen, private onInspect: (id: string) => Screen, private onSignIn: () => Screen) {}
  enter(): void {
    void refreshLibrary();
    void refreshMaps();
    unseenResponses().then(
      (items) => { if (items.length) this.responses = new FeedbackResponseCard(items); },
      (error: unknown) => console.error("feedback responses failed", error),
    );
    this.brawl = new MenuBrawl();
  }
  private pick(mode: Mode): Screen {
    sfx.menuConfirm();
    if (mode === "library") seeNews("characters");
    return this.onPick(mode);
  }
  update(dt: number, m: MenuInput): Screen | null {
    if (this.whatsNew) {
      if (this.whatsNew.update(dt, m)) this.whatsNew = null;
      return null;
    }
    if (this.responses) {
      if (this.responses.update(dt, m)) this.responses = null;
      return null;
    }
    const n = this.items.length;
    if (this.sel === SIGN_IN && !playingAsGuest()) this.sel = 0;
    if (m.up) { this.sel = this.sel < 0 ? n - 1 : this.sel === 0 ? FEEDBACK : this.sel - 1; sfx.menuMove(); }
    if (m.down) { this.sel = this.sel < 0 ? 0 : (this.sel + 1) % n; sfx.menuMove(); }
    if ((m.left || m.right) && this.sel < 0 && playingAsGuest()) { this.sel = this.sel === FEEDBACK ? SIGN_IN : FEEDBACK; sfx.menuMove(); }
    if (m.confirm || m.start) {
      if (this.sel === SIGN_IN) { sfx.menuConfirm(); return this.onSignIn(); }
      return this.pick(this.sel === FEEDBACK ? "feedback" : this.items[this.sel].id);
    }
    return null;
  }
  draw(ctx: CanvasRenderingContext2D, dt: number): void {
    this.t += dt;
    bg(ctx, this.t);
    drawLogo(ctx, 170);
    const live = !this.whatsNew && !this.responses;
    // a fighter in the brawl is on top of the cards it stands on: it takes the hover and the click
    const under = live && pointer.present && this.brawl ? this.brawl.at(pointer.x, pointer.y) : null;
    const tapped = live && pointer.clicked && this.brawl ? this.brawl.at(pointer.tapX, pointer.tapY) : null;
    if (tapped) { sfx.menuConfirm(); goTo(this.onInspect(tapped.id)); }
    const x = MENU_CARD.x, w = MENU_CARD.w, h = MENU_CARD.h;
    this.items.forEach((it, i) => {
      const y = MENU_Y + i * MENU_STEP;
      if (live && !under && hover(x, y, w, h)) { this.sel = i; document.body.style.cursor = "pointer"; }
      if (live && !tapped && clicked(x, y, w, h)) goTo(this.pick(it.id));
      card(ctx, x, y, w, h, "", i === this.sel);
      title(ctx, it.name, x + w / 2, y + 60, 42, INK);
      // the forge's word on the card itself, not only under it when it's picked: resting, or none left
      const st = myLibrary.forge;
      if (it.id === "create" && st && (st.wall || st.resting)) label(ctx, st.resting ? "resting" : "none left", x + w - 14, y + h - 12, 20, PENCIL, "right");
      if (it.id === "library" && isNew("characters")) drawNewSticker(ctx, x + w - 20, y + 8);
    });
    // the brawl plays over the menu: fighters stand on the cards and the logo
    if (this.brawl) { this.brawl.update(dt); this.brawl.draw(ctx, dt); }
    if (live && hover(NOTE.x, NOTE.y, NOTE.w, NOTE.h)) { this.sel = FEEDBACK; document.body.style.cursor = "pointer"; }
    if (live && clicked(NOTE.x, NOTE.y, NOTE.w, NOTE.h)) goTo(this.pick("feedback"));
    drawFeedbackNote(ctx, this.sel === FEEDBACK);
    if (playingAsGuest()) {
      const b = SIGN_IN_BOX;
      if (live && !under && hover(b.x, b.y, b.w, b.h)) { this.sel = SIGN_IN; document.body.style.cursor = "pointer"; }
      if (live && !tapped && clicked(b.x, b.y, b.w, b.h)) { sfx.menuConfirm(); goTo(this.onSignIn()); }
    }
    drawPlayerBadge(ctx, this.sel === SIGN_IN);
    const desc = this.sel === FEEDBACK ? "Ideas, bugs, anything: Ben reads these" : this.sel === SIGN_IN ? "Keep your characters on any device, with Discord or Google" : this.items[this.sel].desc;
    label(ctx, desc, VIEW_W / 2, MENU_Y + this.items.length * MENU_STEP + 30, 26, INK, "center");
    hint(ctx, "click, or arrows + Enter · gamepad: stick + A");
    label(ctx, `build ${__BUILD__}`, VIEW_W - 20, VIEW_H - 16, 14, "rgba(41,39,34,0.5)", "right", 400);
    if (!activity) drawLegalLinks(ctx, live && !under && !tapped);
    if (under) { this.brawl!.drawHover(ctx, under); document.body.style.cursor = "pointer"; }
    if (this.whatsNew) this.whatsNew.draw(ctx, dt);
    else this.responses?.draw(ctx);
  }
}
