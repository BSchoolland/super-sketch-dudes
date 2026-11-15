import { VIEW_H, VIEW_W } from "../render/camera";
import { INK } from "../render/paper";
import type { MenuInput } from "../input/devices";
import { consumeTaps } from "../input/pointer";
import { fingers } from "../input/fingers";
import { account } from "../account";
import { libraryChoices, myLibrary, refreshLibrary } from "../fighters";
import { sessionList } from "../telemetry/events";
import type { LibraryEntry } from "../../../shared/account";
import { ButtonMenu, type Button } from "./buttons";
import { drawCharacterArt, RED } from "./character";
import { CommunityScreen } from "./community";
import { CreateScreen } from "./create";
import { DescribeScreen } from "./describe";
import { ForgeScreen } from "./forging";
import { forgeProgress, etaWords } from "./forge-progress";
import { LoadingScreen, WaitScreen } from "./loading";
import type { Nav } from "./nav";
import { SignInScreen } from "./signin";
import { ClassScreen, SketchScreen } from "./classtime";
import { wrapped } from "./text";
import { card, label, title, type Screen } from "./ui";
import { VersusScreen } from "./versus";

/**
 * A player's first fighter takes about ten minutes to forge. The tour fills the wait: a battle, a fighter saved from
 * COMMUNITY, a battle with that one, and then theirs is ready. Each step opens with a card over the screen they're on;
 * a card never interrupts a match or a drawing.
 */
type Step = "battle" | "community" | "battleSaved" | "waiting";
type Card = "intro" | "afterBattle" | "afterSave" | "almost" | "ready" | "failed";
interface Tour { fighter: string; step: Step; saved: string | null; card: Card | null }

const KEY = "sketchbattle.tour";
/** Per player: their tour, or "done" once it's over (or they had characters before it existed). */
type Stored = Record<string, Tour | "done">;
const load = (): Stored => JSON.parse(localStorage.getItem(KEY) ?? "{}") as Stored;

let tour: Tour | null = null;
let tourOf: string | null = null;
const menu = new ButtonMenu();
let sincePoll = 0;
let t = 0;

function current(): Tour | null {
  const id = account.player?.id ?? null;
  if (id !== tourOf) {
    tourOf = id;
    const had = id ? load()[id] : undefined;
    tour = had && had !== "done" ? had : null;
  }
  return tour;
}

function save(): void {
  if (!tourOf) return;
  const all = load();
  all[tourOf] = tour ?? "done";
  localStorage.setItem(KEY, JSON.stringify(all));
}

function set(next: Partial<Tour>): void {
  if (!tour) throw new Error("tour step without a tour");
  Object.assign(tour, next);
  if (next.card) { menu.focus = 0; sessionList("tour", [next.card, Math.round(performance.now() / 100) / 10], 20); }
  save();
}

function finish(): void {
  sessionList("tour", ["done", Math.round(performance.now() / 100) / 10], 20);
  tour = null;
  save();
}

/** A player sent a drawing to the forge: the tour starts if it's their first character and they've never had one. */
export function tourBegin(entry: LibraryEntry, hadOwn: boolean): void {
  current();
  if (!tourOf || load()[tourOf]) return;
  if (hadOwn) { tour = null; save(); return; }
  tour = { fighter: entry.id, step: "battle", saved: null, card: "intro" };
  set({ card: "intro" });
}

/** A fighter from COMMUNITY landed in their library. */
export function tourSaved(id: string): void {
  if (current()?.step === "community") set({ saved: id, card: "afterSave" });
}

const fighterEntry = (): LibraryEntry | null => (tour ? myLibrary.entries?.find((e) => e.id === tour!.fighter) ?? null : null);

/** Screens a card would land on top of something the player is in the middle of. */
const busy = (s: Screen): boolean =>
  s instanceof VersusScreen || s instanceof LoadingScreen || s instanceof WaitScreen || s instanceof SignInScreen || s instanceof ClassScreen
  || s instanceof SketchScreen || s instanceof CreateScreen || s instanceof DescribeScreen;

/** Whether a card is up over `screen`: it takes the input while it is. */
export function tourCardUp(screen: Screen): boolean {
  return !!current()?.card && !busy(screen);
}

/** Every tick: polls the forge while theirs is in it, and turns a finished one into the last card. */
export function tourTick(dt: number, screen: Screen): void {
  t += dt;
  if (!current()) return;
  const e = fighterEntry();
  if (e?.status === "ready" || e?.status === "failed") {
    // the forge screen shows the result itself
    if (screen instanceof ForgeScreen) { finish(); return; }
    const card: Card = e.status === "ready" ? "ready" : "failed";
    if (tour!.card !== card) set({ card });
    return;
  }
  if (myLibrary.entries && !e) { finish(); return; } // deleted it, or the account changed under it
  sincePoll += dt;
  if (sincePoll >= 5 && !myLibrary.loading) { sincePoll = 0; void refreshLibrary(); }
}

/** The screen changed from `was` to `now`: a battle that just ended moves the tour on. */
export function tourSaw(was: Screen, now: Screen): void {
  if (!current() || !(was instanceof VersusScreen) || was.training || now instanceof VersusScreen) return;
  if (tour!.step === "battle") set({ step: "community", card: "afterBattle" });
  else if (tour!.step === "battleSaved") set({ step: "waiting", card: "almost" });
}

function choiceOf(id: string | null) {
  const c = libraryChoices(myLibrary.entries ?? []).find((x) => x.id === id);
  if (!c) throw new Error(`tour: ${id} isn't a ready fighter in the library`);
  return c;
}

/** The card's size, words and buttons: a mouse's, and a finger's (read on a phone). */
const DESK = { w: 980, h: 560, heading: 58, body: 32, lines: 6, art: 290, button: { w: 400, h: 110, size: 38, small: 34, single: 44 } };
const TOUCH = { w: 1440, h: 860, heading: 80, body: 48, lines: 6, art: 440, button: { w: 600, h: 160, size: 52, small: 48, single: 58 } };
const look = () => (fingers() ? TOUCH : DESK);
const corner = () => { const L = look(); return { L, CX: (VIEW_W - L.w) / 2, CY: (VIEW_H - L.h) / 2 }; };

function buttons(card: Card): Button[] {
  const { L, CY } = corner(), { w, h, size, small, single } = L.button, y = CY + L.h - h - 40;
  const pair = (a: [string, string], b: [string, string]): Button[] => [
    { id: a[0], x: VIEW_W / 2 - w - 20, y, w, h, text: a[1], size },
    { id: b[0], x: VIEW_W / 2 + 20, y, w, h, text: b[1], size: small },
  ];
  const one = (id: string, text: string): Button[] => [{ id, x: VIEW_W / 2 - w / 2, y, w, h, text, size: single }];
  switch (card) {
    case "intro": return pair(["go", "LET'S BATTLE"], ["skip", "I'LL LOOK AROUND"]);
    case "afterBattle": return pair(["go", "TO COMMUNITY"], ["skip", "SKIP"]);
    case "afterSave": return pair(["go", "BATTLE WITH IT"], ["skip", "SKIP"]);
    case "almost": return one("ok", "OK");
    case "ready": return pair(["go", "FIGHT WITH IT"], ["skip", "LATER"]);
    case "failed": return fighterEntry()?.retryable ? pair(["go", "TRY AGAIN"], ["skip", "LATER"]) : one("skip", "OK");
  }
}

/** The card's buttons; a screen to go to, or null. */
export function tourUpdate(m: MenuInput, nav: Nav): Screen | null {
  const card = tour!.card!;
  const pressed = menu.update(buttons(card), m, consumeTaps());
  if (!pressed) return null;
  const skip = pressed === "skip";
  switch (card) {
    case "intro":
      set({ card: null, step: skip ? "waiting" : "battle" });
      return skip ? null : nav.bots();
    case "afterBattle":
      set({ card: null, step: skip ? "waiting" : "community" });
      return skip ? null : nav.community();
    case "afterSave":
      set({ card: null, step: skip ? "waiting" : "battleSaved" });
      return skip ? null : nav.bots(choiceOf(tour!.saved));
    case "almost":
      set({ card: null });
      return null;
    case "ready": {
      const fighter = tour!.fighter;
      finish();
      return skip ? null : nav.bots(choiceOf(fighter));
    }
    case "failed": {
      const e = fighterEntry();
      finish();
      return skip || !e ? null : nav.forge(e);
    }
  }
}

const eta = (): string => {
  const e = fighterEntry();
  if (!e) return "";
  const p = forgeProgress(e);
  return p.etaS === null ? "waiting in line" : etaWords(p.etaS);
};

/** The buttons of the card up over `screen`, if one is. */
export function tourButtons(screen: Screen): Button[] | null {
  return tourCardUp(screen) ? buttons(tour!.card!) : null;
}

export function tourDraw(ctx: CanvasRenderingContext2D, screen: Screen): void {
  if (current()?.card && !busy(screen)) drawCard(ctx, tour!.card!);
}

function drawCard(ctx: CanvasRenderingContext2D, which: Card): void {
  ctx.save();
  ctx.fillStyle = "rgba(244,239,228,0.72)";
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.restore();
  const { L, CX, CY } = corner();
  card(ctx, CX, CY, L.w, L.h, INK, false);
  const e = fighterEntry();
  const name = e?.name ?? "your fighter";
  const text = (heading: string, body: string, color = INK) => {
    title(ctx, heading, VIEW_W / 2, CY + L.heading * 1.72, L.heading, color, "center", L.w - 80);
    wrapped(ctx, body, VIEW_W / 2, CY + L.heading * 1.72 + L.body * 2.5, L.w - 140, L.body, INK, L.lines);
  };
  switch (which) {
    case "intro":
      text("YOUR FIGHTER IS BEING CREATED", `It takes about 10 minutes. While you wait: have a battle, find a fighter you like in COMMUNITY and save it, then battle with that one. Yours should be ready by then.`);
      break;
    case "afterBattle":
      text("NICE FIGHT", `Next: COMMUNITY is everyone else's fighters. Find one you like and SAVE it. Yours: ${eta()}.`);
      break;
    case "afterSave":
      text("SAVED", `${choiceName(tour!.saved)} is in your characters now. Take it into a battle.`);
      break;
    case "almost":
      text("ALMOST THERE", `Your fighter: ${eta()}. Keep battling or look around; this pops up when it's ready.`);
      break;
    case "ready":
      if (e) drawCharacterArt(ctx, e, CX + 60, CY + 60, L.art, t);
      title(ctx, `${name.toUpperCase()} IS READY`, CX + L.art + 100, CY + 60 + L.heading * 1.4, L.heading * 0.97, INK, "left", L.w - L.art - 140);
      wrapped(ctx, "Your drawing is a fighter now. Take it into a battle.", CX + L.art + 100, CY + 60 + L.heading * 1.4 + L.body * 2.2, L.w - L.art - 150, L.body, INK, 4, "left");
      break;
    case "failed":
      text("CREATION FAILED", e?.error ?? "Something went wrong making it.", RED);
      break;
  }
  menu.draw(ctx, buttons(which));
}

function choiceName(id: string | null): string {
  return myLibrary.entries?.find((x) => x.id === id)?.name ?? "It";
}
