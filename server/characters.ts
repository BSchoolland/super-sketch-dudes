import fs from "node:fs";
import path from "node:path";
import type express from "express";
import { COMMUNITY_PAGE, DRAW_PNG_MAX_BYTES, HINT_DESCRIPTION_MAX, HINT_NAME_MAX, FEATURED, FEATURED_PER_CREATOR, type CommunityCharacter, type FeaturedCharacter } from "../shared/account";
import { playerOf } from "./auth";
import type { WideEvent } from "../shared/wide";
import type { LibraryEntry } from "../shared/account";
import { drawingUrlOf, enqueueJob, entryOf, jobOf, newFighterId, reviseCharacter, storeCharacter } from "./forge";
import { communityCharacters, dummyEntry, everyCharacter, findCharacter, libraryOf, removeCharacter, saveCharacter, savedOf, setDummy, setPublic, setStarters, starterEntries, starterIds, setHeld, takeDown, unsaveCharacter, upsertCharacter } from "./library";
import { HOUSE_ROSTER } from "../shared/house";

/** The character creator and the library, over HTTP, for signed-in players. */
export function attachCharacters(api: express.Router, forgeToken = "", dataDir = ""): void {
  api.get("/library", (req, res) => {
    const player = playerOf(req);
    if (!player) return res.status(401).json({ error: "not signed in" });
    res.json({ player, characters: libraryWithSaves(player.id) });
  });

  // someone else's public character into your library, by reference
  api.post("/library/saved/:id", (req, res) => {
    const player = playerOf(req);
    if (!player) return res.status(401).json({ error: "not signed in" });
    const id = req.params.id;
    const listed = communityCharacters().find((c) => c.entry.id === id);
    if (!listed) return res.status(404).json({ error: "no such public character" });
    if (listed.entry.owner === player.id) return res.status(400).json({ error: "that one's yours" });
    saveCharacter(player.id, id);
    res.json({ saved: true });
  });
  api.delete("/library/saved/:id", (req, res) => {
    const player = playerOf(req);
    if (!player) return res.status(401).json({ error: "not signed in" });
    if (!unsaveCharacter(player.id, req.params.id)) return res.status(404).json({ error: "not saved" });
    res.json({ saved: false });
  });

  // { public } on one of your own characters
  api.patch("/library/:id", (req, res) => {
    const player = playerOf(req);
    if (!player) return res.status(401).json({ error: "not signed in" });
    if (typeof req.body?.public !== "boolean") return res.status(400).json({ error: "public must be true or false" });
    const entry = setPublic(player.id, req.params.id, req.body.public);
    if (!entry) return res.status(404).json({ error: "not in your library" });
    res.json({ character: entry });
  });

  // everyone's public characters, a page at a time: most played online or newest first; `q` keeps the ones whose name has it in
  api.get("/characters/community", (req, res) => {
    const sort = req.query.sort === "new" ? "new" : req.query.sort === "popular" || req.query.sort === undefined ? "popular" : null;
    if (!sort) return res.status(400).json({ error: "sort is popular or new" });
    const page = Math.max(0, Math.floor(Number(req.query.page) || 0));
    const caller = playerOf(req)?.id ?? "";
    const saved = new Set(caller ? savedOf(caller).map((e) => e.id) : []);
    const q = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";
    const all = communityCharacters().filter(({ entry }) => !q || (entry.name ?? "").toLowerCase().includes(q)).sort((a, b) => (sort === "popular" ? b.plays - a.plays : 0) || b.entry.createdAt - a.entry.createdAt);
    const characters: CommunityCharacter[] = all.slice(page * COMMUNITY_PAGE, (page + 1) * COMMUNITY_PAGE).map(({ entry: e, creator, plays }) => ({
      id: e.id, name: e.name, tagline: e.tagline, drawingUrl: e.drawingUrl, bundleUrl: e.bundleUrl!, createdAt: e.createdAt,
      creator: { name: creator?.name ?? "?" }, plays, saved: saved.has(e.id), mine: e.owner === caller,
    }));
    res.json({ characters, pages: Math.ceil(all.length / COMMUNITY_PAGE) });
  });

  // the most played community characters, at most FEATURED_PER_CREATOR from any one player, and how many players have made: the release card
  api.get("/characters/featured", (_req, res) => {
    const perCreator = new Map<string, number>();
    const characters: FeaturedCharacter[] = [];
    for (const { entry: e } of communityCharacters().sort((a, b) => b.plays - a.plays)) {
      const n = perCreator.get(e.owner) ?? 0;
      if (n >= FEATURED_PER_CREATOR) continue;
      perCreator.set(e.owner, n + 1);
      characters.push({ id: e.id, drawingUrl: e.drawingUrl, bundleUrl: e.bundleUrl! });
      if (characters.length === FEATURED) break;
    }
    res.json({ characters, made: everyCharacter().filter((c) => !starterIds().includes(c.id)).length });
  });

  // reference fighters every player starts with; the forge token sets the list
  api.get("/starters", (_req, res) => res.json({ ids: starterIds(), characters: starterEntries() }));
  api.post("/starters", (req, res) => {
    if (!forgeToken || req.get("x-forge-token") !== forgeToken) return res.status(401).json({ error: "bad token" });
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : null;
    if (!ids) return res.status(400).json({ error: "ids required" });
    try { res.json({ ids: setStarters(ids) }); } catch (e) { res.status(404).json({ error: (e as Error).message }); }
  });

  // the practice dummy; the forge token picks which character it is
  api.get("/dummy", (_req, res) => res.json({ character: dummyEntry() }));
  api.post("/dummy", (req, res) => {
    if (!forgeToken || req.get("x-forge-token") !== forgeToken) return res.status(401).json({ error: "bad token" });
    if (typeof req.body?.id !== "string") return res.status(400).json({ error: "id required" });
    try { setDummy(req.body.id); res.json({ character: dummyEntry() }); } catch (e) { res.status(404).json({ error: (e as Error).message }); }
  });

  api.delete("/library/:id", (req, res) => {
    const player = playerOf(req);
    if (!player) return res.status(401).json({ error: "not signed in" });
    if (starterIds().includes(req.params.id)) return res.status(403).json({ error: "that one is everyone's" });
    if (!removeCharacter(player.id, req.params.id)) return res.status(404).json({ error: "not in your library" });
    res.status(204).end();
  });

  // a moderator taking a character down, from its owner and everyone who saved it
  api.post("/characters/:id/take-down", (req, res) => {
    if (!forgeToken || req.get("x-forge-token") !== forgeToken) return res.status(401).json({ error: "bad token" });
    if (starterIds().includes(req.params.id)) return res.status(403).json({ error: "that one is everyone's" });
    if (!takeDown(req.params.id)) return res.status(404).json({ error: "no such character" });
    res.status(204).end();
  });

  // Ben releasing a character the auto moderator held out of COMMUNITY
  api.post("/characters/:id/release", (req, res) => {
    if (!forgeToken || req.get("x-forge-token") !== forgeToken) return res.status(401).json({ error: "bad token" });
    if (!setHeld(req.params.id, false)) return res.status(404).json({ error: "no such character" });
    res.status(204).end();
  });

  // { png: <data URL>, name?, description? } -> the new library entry, queued for the forge
  api.post("/characters", (req, res) => {
    const player = playerOf(req);
    if (!player) return res.status(401).json({ error: "not signed in" });
    const png = typeof req.body?.png === "string" ? decodePng(req.body.png) : null;
    if (!png) return res.status(400).json({ error: "drawing must be a PNG data URL" });
    if (png.length > DRAW_PNG_MAX_BYTES) return res.status(400).json({ error: "drawing too large" });
    const name = String(req.body?.name ?? "").replace(/[^\w .'!?-]/g, "").trim().slice(0, HINT_NAME_MAX).toUpperCase();
    const description = String(req.body?.description ?? "").replace(/\s+/g, " ").trim().slice(0, HINT_DESCRIPTION_MAX);
    const hint = name || description ? { name, description } : null;
    if (req.body?.public !== undefined && typeof req.body.public !== "boolean") return res.status(400).json({ error: "public must be true or false" });
    const event = res.locals.event as WideEvent | undefined;
    const job = enqueueJob({ fighterId: newFighterId(player.id.replace(/\W+/g, "").slice(-4) || "p"), player, png, origin: "creator", hint, public: req.body?.public ?? true, parent: event?.trace ?? null });
    event?.set("forge", `f-${job.id}`);
    res.json({ character: entryOf(job) });
  });

  // a finished character made elsewhere (a CLI forge run), dropped straight into a player's library
  api.post("/characters/import", async (req, res) => {
    if (!forgeToken || req.get("x-forge-token") !== forgeToken) return res.status(401).json({ error: "bad token" });
    const owner = String(req.body?.owner ?? ""), id = String(req.body?.id ?? "");
    if (!owner || !/^gen-[\w-]+$/.test(id)) return res.status(400).json({ error: "owner and a gen-… id required" });
    try {
      const result = await storeCharacter(id, String(req.body?.player ?? "player"), req.body);
      if (typeof req.body?.drawing === "string") { const f = path.join(dataDir, "gen", "drawings", `${id}.png`); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, Buffer.from(req.body.drawing, "base64")); }
      const entry = upsertCharacter({ id, owner, status: "ready", stage: "", error: null, ...result, drawingUrl: drawingUrlOf(id), createdAt: Date.now(), origin: "creator", public: true });
      res.json({ character: entry });
    } catch (e) { res.status(400).json({ error: (e as Error).message }); }
  });

  // a new module (and the forge's CPU study of it) for a character that already exists (an engine migration, a fix), keeping everything else
  api.post("/characters/:id/source", async (req, res) => {
    const source = typeof req.body?.source === "string" ? req.body.source : "";
    if (!source) return res.status(400).json({ error: "source required" });
    await revise(req, res, { source, cpu: req.body?.cpu });
  });

  // a new CPU study for a character that already exists (the study changed): { cpu }
  api.post("/characters/:id/cpu", async (req, res) => {
    if (!req.body?.cpu) return res.status(400).json({ error: "cpu required" });
    await revise(req, res, { cpu: req.body.cpu });
  });

  // re-cut cells for a character that already exists (a normalize.py fix): { cells: { <cell>: base64 png }, heightPx }
  api.post("/characters/:id/cells", async (req, res) => {
    const cells = req.body?.cells, heightPx = Number(req.body?.heightPx);
    if (!cells || typeof cells !== "object" || !(heightPx > 0)) return res.status(400).json({ error: "cells and heightPx required" });
    await revise(req, res, { cells, heightPx });
  });

  async function revise(req: express.Request, res: express.Response, change: Parameters<typeof reviseCharacter>[1]): Promise<void> {
    if (!forgeToken || req.get("x-forge-token") !== forgeToken) { res.status(401).json({ error: "bad token" }); return; }
    const entry = findCharacter(req.params.id);
    if (!entry || entry.status !== "ready") { res.status(404).json({ error: "no such finished character" }); return; }
    try { res.json({ character: upsertCharacter({ ...entry, ...(await reviseCharacter(entry, change)) }) }); }
    catch (e) { res.status(400).json({ error: (e as Error).message }); }
  }

  // a random handful of contenders for the title screen's brawl, none of `not`: the house four (no bundle
  // URL; the client knows where those live) and everyone's finished characters
  api.get("/characters/sample", (req, res) => {
    const n = Math.max(1, Math.min(24, Number(req.query.n) || 8));
    const not = new Set(String(req.query.not ?? "").split(",").filter(Boolean));
    const all = [
      ...HOUSE_ROSTER.map((h) => ({ id: h.id as string, name: h.name as string | null, bundleUrl: null as string | null })),
      ...everyCharacter().filter((c) => c.public && !c.held).map((c) => ({ id: c.id, name: c.name, bundleUrl: c.bundleUrl })),
    ].filter((c) => !not.has(c.id));
    for (let i = 0; i < Math.min(n, all.length); i++) { const j = i + Math.floor(Math.random() * (all.length - i)); [all[i], all[j]] = [all[j], all[i]]; }
    res.json({ characters: all.slice(0, n) });
  });

  // everyone's finished characters, for the tools: just enough to load and name them
  api.get("/characters/everyone", (_req, res) => {
    res.json({ characters: everyCharacter().map((c) => ({ id: c.id, name: c.name, bundleUrl: c.bundleUrl })) });
  });

  api.get("/characters/:id", (req, res) => {
    const caller = playerOf(req)?.id;
    const entry = (caller ? libraryWithSaves(caller) : starterEntries()).find((c) => c.id === req.params.id);
    if (!entry) return res.status(404).json({ error: "no such character" });
    res.json({ character: entry });
  });
  void jobOf;
}

/** A player's library as they see it: their own, the ones they saved, then the starters they don't already have. */
function libraryWithSaves(owner: string): LibraryEntry[] {
  const own = [...libraryOf(owner), ...savedOf(owner)];
  return [...own, ...starterEntries().filter((s) => !own.some((c) => c.id === s.id))];
}

export function decodePng(dataUrl: string): Buffer | null {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) return null;
  const buf = Buffer.from(m[1], "base64");
  return buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47 ? buf : null;
}
