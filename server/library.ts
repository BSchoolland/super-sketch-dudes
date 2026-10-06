import fs from "node:fs";
import path from "node:path";
import { GAME_VERSION, type LastPlayed, type LibraryEntry, type News, type Player } from "../shared/account";
import { FRESH_MS, compareVersions, releasesSince, type Fresh } from "../shared/releases";

/**
 * Every player's record (who they are, when they last played, their characters and saves), one JSON file per player under
 * <dataDir>/players/. `saved` are other players' characters this player keeps in their library: references by id, like starters.
 */
interface PlayerRecord { player: Player | null; lastPlayed: LastPlayed | null; news?: News | null; characters: LibraryEntry[]; saved: Saved[] }
/** Someone else's character in this player's library, and when they saved it. */
interface Saved { id: string; at: number }
let dir = "";
const cache = new Map<string, PlayerRecord>();
/** How many players have each character saved; built by scanAll, kept current by save and unsave. */
const saves = new Map<string, number>();
let scanned = false;
/** Fighter ids every player sees in their library (reference fighters), kept in <dataDir>/starters.json. */
let starters: string[] = [];
let startersFile = "";
/** The fighter PRACTICE and the move previews put in front of you, kept in <dataDir>/dummy.json. */
let dummy: string | null = null;
let dummyFile = "";
/** Online matches each fighter has been picked for, one per slot, kept in <dataDir>/plays.json. */
let plays: Record<string, number> = {};
let playsFile = "";

function fileOf(owner: string): string {
  return path.join(dir, `${owner.replace(/[^\w-]/g, "_")}.json`);
}
function load(owner: string): PlayerRecord {
  let lib = cache.get(owner);
  if (!lib) {
    const f = fileOf(owner);
    lib = fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, "utf8")) as PlayerRecord) : { player: null, lastPlayed: null, characters: [], saved: [] };
    if (!("lastPlayed" in lib)) throw new Error(`${f} predates lastPlayed: run scripts/migrate-last-played.mjs on the data dir`);
    lib.saved ??= [];
    if (lib.saved.some((s) => typeof s === "string")) throw new Error(`${f} has saves without times: run scripts/migrate-saved-at.mjs on the data dir`);
    for (const c of lib.characters) c.public ??= true;
    cache.set(owner, lib);
    for (const { id } of lib.saved) saves.set(id, (saves.get(id) ?? 0) + 1);
  }
  return lib;
}
function write(owner: string): void {
  fs.writeFileSync(fileOf(owner), JSON.stringify(load(owner), null, 1));
}

export function initLibrary(dataDir: string): void {
  dir = path.join(dataDir, "players");
  cache.clear(); saves.clear(); scanned = false;
  fs.mkdirSync(dir, { recursive: true });
  startersFile = path.join(dataDir, "starters.json");
  starters = fs.existsSync(startersFile) ? JSON.parse(fs.readFileSync(startersFile, "utf8")) : [];
  dummyFile = path.join(dataDir, "dummy.json");
  dummy = fs.existsSync(dummyFile) ? JSON.parse(fs.readFileSync(dummyFile, "utf8")) : null;
  playsFile = path.join(dataDir, "plays.json");
  plays = fs.existsSync(playsFile) ? JSON.parse(fs.readFileSync(playsFile, "utf8")) : {};
}

/** A room started a match with these fighters, one per player. */
export function recordPlays(fighters: string[]): void {
  for (const id of fighters) plays[id] = (plays[id] ?? 0) + 1;
  fs.writeFileSync(playsFile, JSON.stringify(plays));
}
export function playCount(id: string): number {
  return plays[id] ?? 0;
}

export function setDummy(id: string): void {
  if (!findCharacter(id)) throw new Error(`no such character: ${id}`);
  dummy = id;
  fs.writeFileSync(dummyFile, JSON.stringify(dummy));
}
/** The practice dummy, once it's set and forged. */
export function dummyEntry(): LibraryEntry | null {
  const e = dummy ? findCharacter(dummy) : null;
  return e?.status === "ready" ? e : null;
}

export function starterIds(): string[] {
  return [...starters];
}
export function setStarters(ids: string[]): string[] {
  const missing = ids.filter((id) => !findCharacter(id));
  if (missing.length) throw new Error(`no such character: ${missing.join(", ")}`);
  starters = [...ids];
  fs.writeFileSync(startersFile, JSON.stringify(starters));
  return starters;
}
/** The starters as library entries, marked so the client won't offer to delete them. */
export function starterEntries(): LibraryEntry[] {
  return starters.map((id) => findCharacter(id)).filter((e): e is LibraryEntry => !!e && e.status === "ready").map((e) => ({ ...e, starter: true }));
}

/**
 * The player is playing now, on this version. Returns when they last played before (null for a new player) and their
 * NEW stickers: a returning player's first visit on a newer version starts them, for FRESH_MS.
 */
export function markPlayed(player: Player): { lastPlayed: LastPlayed | null; news: News | null } {
  const lib = load(player.id);
  const previous = lib.lastPlayed, now = Date.now();
  if (previous && compareVersions(previous.version, GAME_VERSION) < 0) {
    const fresh = [...new Set(releasesSince(previous.version, GAME_VERSION).flatMap((r) => r.fresh))];
    lib.news = fresh.length ? { since: now, fresh, seen: [] } : null;
  }
  if (lib.news && now - lib.news.since >= FRESH_MS) lib.news = null;
  lib.player = player;
  lib.lastPlayed = { version: GAME_VERSION, at: now };
  write(player.id);
  return { lastPlayed: previous, news: lib.news ?? null };
}

/** The player opened something that had a NEW sticker. */
export function seeNews(owner: string, what: Fresh): News | null {
  const lib = load(owner);
  if (lib.news && !lib.news.seen.includes(what)) {
    lib.news.seen.push(what);
    write(owner);
  }
  return lib.news ?? null;
}

/** The player's own characters, without the ones they deleted that others still have saved. */
export function libraryOf(owner: string): LibraryEntry[] {
  return load(owner).characters.filter((c) => !c.deleted);
}

/** The characters the player saved, marked so the client offers to unsave rather than delete. */
export function savedOf(owner: string): LibraryEntry[] {
  return load(owner).saved.flatMap(({ id, at }) => {
    const e = findCharacter(id);
    return e?.status === "ready" ? [{ ...e, saved: at }] : [];
  });
}

export function saveCount(id: string): number {
  scanAll();
  return saves.get(id) ?? 0;
}

/** False if it was already saved. */
export function saveCharacter(owner: string, id: string): boolean {
  scanAll();
  const lib = load(owner);
  if (lib.saved.some((s) => s.id === id)) return false;
  lib.saved.push({ id, at: Date.now() });
  saves.set(id, saveCount(id) + 1);
  write(owner);
  return true;
}

/** False if it wasn't saved. The last saver of a character its creator deleted takes it with them. */
export function unsaveCharacter(owner: string, id: string): boolean {
  scanAll();
  const lib = load(owner);
  if (!lib.saved.some((s) => s.id === id)) return false;
  lib.saved = lib.saved.filter((s) => s.id !== id);
  const left = saveCount(id) - 1;
  if (left > 0) saves.set(id, left); else saves.delete(id);
  write(owner);
  const e = findCharacter(id);
  if (e?.deleted && !left) purge(e.owner, id);
  return true;
}

export function setPublic(owner: string, id: string, pub: boolean): LibraryEntry | null {
  const e = libraryOf(owner).find((c) => c.id === id);
  if (!e) return null;
  e.public = pub;
  write(owner);
  return e;
}

/** Ready characters anyone can find and save: public, not deleted, not a starter (everyone has those). */
export function communityCharacters(): { entry: LibraryEntry; creator: Player | null; plays: number }[] {
  scanAll();
  return [...cache.values()].flatMap((lib) => lib.characters
    .filter((c) => c.status === "ready" && c.bundleUrl && c.public && !c.deleted && !starters.includes(c.id))
    .map((entry) => ({ entry, creator: lib.player, plays: playCount(entry.id) })));
}

/** Every library into the cache, once; from then on every owner is in it (new ones arrive through upsertCharacter). */
function scanAll(): void {
  if (scanned) return;
  for (const f of fs.readdirSync(dir)) load(path.basename(f, ".json"));
  scanned = true;
}

export function findCharacter(id: string): LibraryEntry | null {
  scanAll();
  for (const lib of cache.values()) { const e = lib.characters.find((c) => c.id === id); if (e) return e; }
  return null;
}

/** Every ready character in every library. */
export function everyCharacter(): LibraryEntry[] {
  scanAll();
  return [...cache.values()].flatMap((lib) => lib.characters.filter((c) => c.status === "ready" && c.bundleUrl && !c.deleted));
}

/** Adds or replaces the entry (by id) in its owner's library. A replacement keeps what the owner set on it (public, deleted). */
export function upsertCharacter(entry: LibraryEntry, player?: Player): LibraryEntry {
  const lib = load(entry.owner);
  if (player) lib.player = player;
  const i = lib.characters.findIndex((c) => c.id === entry.id);
  if (i >= 0) {
    const was = lib.characters[i];
    entry = { ...entry, public: was.public };
    if (was.deleted) entry.deleted = true;
    lib.characters[i] = entry;
  } else lib.characters.push(entry);
  write(entry.owner);
  return entry;
}

/** Deletes the owner's character; one somebody has saved stays on file, marked deleted, until the last of them unsaves it. */
export function removeCharacter(owner: string, id: string): boolean {
  const e = libraryOf(owner).find((c) => c.id === id);
  if (!e) return false;
  if (saveCount(id)) { e.deleted = true; write(owner); }
  else purge(owner, id);
  return true;
}

/** A moderator pulling a character: gone from its owner's library and from everyone who saved it. False if there's no such character. */
export function takeDown(id: string): boolean {
  const e = findCharacter(id);
  if (!e) return false;
  for (const [owner, lib] of cache) if (lib.saved.some((s) => s.id === id)) { lib.saved = lib.saved.filter((s) => s.id !== id); write(owner); }
  saves.delete(id);
  purge(e.owner, id);
  return true;
}

function purge(owner: string, id: string): void {
  const lib = load(owner);
  lib.characters = lib.characters.filter((c) => c.id !== id);
  write(owner);
}
