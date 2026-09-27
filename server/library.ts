import fs from "node:fs";
import path from "node:path";
import type { LibraryEntry, Player } from "../shared/account";

/** Every player's characters, one JSON file per player under <dataDir>/players/. */
let dir = "";
const cache = new Map<string, { player: Player | null; characters: LibraryEntry[] }>();
/** Fighter ids every player sees in their library (reference fighters), kept in <dataDir>/starters.json. */
let starters: string[] = [];
let startersFile = "";
/** The fighter PRACTICE and the move previews put in front of you, kept in <dataDir>/dummy.json. */
let dummy: string | null = null;
let dummyFile = "";

function fileOf(owner: string): string {
  return path.join(dir, `${owner.replace(/[^\w-]/g, "_")}.json`);
}
function load(owner: string): { player: Player | null; characters: LibraryEntry[] } {
  let lib = cache.get(owner);
  if (!lib) {
    const f = fileOf(owner);
    lib = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : { player: null, characters: [] };
    cache.set(owner, lib!);
  }
  return lib!;
}
function save(owner: string): void {
  fs.writeFileSync(fileOf(owner), JSON.stringify(load(owner), null, 1));
}

export function initLibrary(dataDir: string): void {
  dir = path.join(dataDir, "players");
  fs.mkdirSync(dir, { recursive: true });
  startersFile = path.join(dataDir, "starters.json");
  starters = fs.existsSync(startersFile) ? JSON.parse(fs.readFileSync(startersFile, "utf8")) : [];
  dummyFile = path.join(dataDir, "dummy.json");
  dummy = fs.existsSync(dummyFile) ? JSON.parse(fs.readFileSync(dummyFile, "utf8")) : null;
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

export function libraryOf(owner: string): LibraryEntry[] {
  return load(owner).characters;
}

/** Every library into the cache, once; from then on every owner is in it (new ones arrive through upsertCharacter). */
let scanned = false;
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
  return [...cache.values()].flatMap((lib) => lib.characters.filter((c) => c.status === "ready" && c.bundleUrl));
}

/** Adds or replaces the entry (by id) in its owner's library. */
export function upsertCharacter(entry: LibraryEntry, player?: Player): LibraryEntry {
  const lib = load(entry.owner);
  if (player) lib.player = player;
  const i = lib.characters.findIndex((c) => c.id === entry.id);
  if (i >= 0) lib.characters[i] = entry; else lib.characters.push(entry);
  save(entry.owner);
  return entry;
}

export function removeCharacter(owner: string, id: string): boolean {
  const lib = load(owner);
  const before = lib.characters.length;
  lib.characters = lib.characters.filter((c) => c.id !== id);
  if (lib.characters.length === before) return false;
  save(owner);
  return true;
}
