import { stillSprites } from "./render/sprite";
import { library } from "./account";
import { site } from "./base";
import { fighterLoad, type FighterLoad } from "./gen";
import { roster } from "../../shared/fighters/index";
import { HOUSE_ROSTER, houseBundlePath, type HouseId } from "../../shared/house";
import type { LibraryEntry } from "../../shared/account";
import type { FighterDef } from "../../shared/types";

/** A fighter someone can pick: one of the house roster, or a ready character from a library. */
export interface FighterChoice {
  id: string;
  name: string;
  bundleUrl: string;
  house: boolean;
  /** The library entry behind it (sheet, drawing, card); null for the house. */
  entry: LibraryEntry | null;
}

export const houseChoice = (id: HouseId, name: string): FighterChoice => ({ id, name, bundleUrl: `${site.base}${houseBundlePath(id)}?v=${site.build}`, house: true, entry: null });
export const houseChoices = (): FighterChoice[] => HOUSE_ROSTER.map((h) => houseChoice(h.id, h.name));
export const isHouseId = (id: string): id is HouseId => HOUSE_ROSTER.some((h) => h.id === id);

export function libraryChoices(entries: readonly LibraryEntry[]): FighterChoice[] {
  return entries.filter((e) => e.status === "ready" && e.bundleUrl).map((e) => ({ id: e.id, name: e.name ?? "?", bundleUrl: e.bundleUrl!, house: false, entry: e }));
}

/** Starts loading the fighter; the def once it's registered, else null. */
export function choiceDef(c: FighterChoice): { def: FighterDef | null; load: FighterLoad } {
  const load = fighterLoad(c.bundleUrl);
  return { def: load.state === "ready" ? roster[c.id] ?? null : null, load };
}

/**
 * The signed-in player's library, fetched on demand and shared by every screen. `entries` is
 * null until the first fetch lands; a failed fetch keeps the last list and says why.
 */
export const myLibrary: { entries: LibraryEntry[] | null; error: string; loading: boolean } = { entries: null, error: "", loading: false };

export async function refreshLibrary(): Promise<void> {
  myLibrary.loading = true;
  try {
    const { characters } = await library.list();
    myLibrary.entries = [...characters].sort((a, b) => b.createdAt - a.createdAt);
    myLibrary.error = "";
  } catch (error) {
    console.error("library fetch failed", error);
    myLibrary.error = error instanceof Error ? error.message : String(error);
  } finally {
    myLibrary.loading = false;
  }
}

/** The fighter PRACTICE and the move previews stand you in front of; null until the server has one. */
export const practiceDummy: { choice: FighterChoice | null; error: string } = { choice: null, error: "" };

export async function refreshDummy(): Promise<void> {
  try {
    const { character } = await library.dummy();
    practiceDummy.choice = character ? libraryChoices([character])[0] ?? null : null;
    stillSprites.clear();
    if (character) stillSprites.add(character.id);
    practiceDummy.error = "";
  } catch (error) {
    console.error("dummy fetch failed", error);
    practiceDummy.error = error instanceof Error ? error.message : String(error);
  }
}

export function forgetLibrary(): void {
  myLibrary.entries = null;
  myLibrary.error = "";
}

/** What a player can fight with: their ready characters, then the house. */
export function allChoices(): { mine: FighterChoice[]; house: FighterChoice[] } {
  return { mine: libraryChoices(myLibrary.entries ?? []), house: houseChoices() };
}
