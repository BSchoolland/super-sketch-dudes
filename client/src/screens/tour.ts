import { VIEW_H, VIEW_W } from "../render/camera";
import { INK } from "../render/paper";
import type { MenuInput } from "../input/devices";
import { consumeTaps } from "../input/pointer";
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

const CARD = { w: 980, h: 560 };
const CX = (VIEW_W - CARD.w) / 2, CY = (VIEW_H - CARD.h) / 2;

function buttons(card: Card): Button[] {
  const y = CY + CARD.h - 150, w = 400;
  const pair = (a: [string, string], b: [string, string]): Button[] => [
    { id: a[0], x: VIEW_W / 2 - w - 20, y, w, h: 110, text: a[1], size: 38 },
    { id: b[0], x: VIEW_W / 2 + 20, y, w, h: 110, text: b[1], size: 34 },
  ];
  switch (card) {
    case "intro": return pair(["go", "LET'S BATTLE"], ["skip", "I'LL LOOK AROUND"]);
    case "afterBattle": return pair(["go", "TO COMMUNITY"], ["skip", "SKIP"]);
    case "afterSave": return pair(["go", "BATTLE WITH IT"], ["skip", "SKIP"]);
    case "almost": return [{ id: "ok", x: VIEW_W / 2 - 200, y, w: 400, h: 110, text: "OK", size: 44 }];
    case "ready": return pair(["go", "FIGHT WITH IT"], ["skip", "LATER"]);
    case "failed": return fighterEntry()?.retryable ? pair(["go", "TRY AGAIN"], ["skip", "LATER"]) : [{ id: "skip", x: VIEW_W / 2 - 200, y, w: 400, h: 110, text: "OK", size: 44 }];
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

export function tourDraw(ctx: CanvasRenderingContext2D, screen: Screen): void {
  if (current()?.card && !busy(screen)) drawCard(ctx, tour!.card!);
}

function drawCard(ctx: CanvasRenderingContext2D, which: Card): void {
  ctx.save();
  ctx.fillStyle = "rgba(244,239,228,0.72)";
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.restore();
  card(ctx, CX, CY, CARD.w, CARD.h, INK, false);
  const e = fighterEntry();
  const name = e?.name ?? "your fighter";
  const text = (heading: string, body: string, color = INK) => {
    title(ctx, heading, VIEW_W / 2, CY + 100, 58, color, "center", CARD.w - 80);
    wrapped(ctx, body, VIEW_W / 2, CY + 180, CARD.w - 140, 32, INK, 6);
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
      if (e) drawCharacterArt(ctx, e, CX + 60, CY + 60, 290, t);
      title(ctx, `${name.toUpperCase()} IS READY`, CX + 390, CY + 140, 56, INK, "left", CARD.w - 430);
      wrapped(ctx, "Your drawing is a fighter now. Take it into a battle.", CX + 390, CY + 210, CARD.w - 440, 32, INK, 4, "left");
      break;
    case "failed":
      text("COULDN'T CREATE THAT ONE", e?.error ?? "Something went wrong making it.", RED);
      break;
  }
  menu.draw(ctx, buttons(which));
}

function choiceName(id: string | null): string {
  return myLibrary.entries?.find((x) => x.id === id)?.name ?? "It";
}
