import fs from "node:fs";
import path from "node:path";
import type express from "express";
import { DRAW_PNG_MAX_BYTES } from "../shared/account";
import { playerOf } from "./auth";
import type { WideEvent } from "../shared/wide";
import { drawingUrlOf, enqueueJob, entryOf, jobOf, newFighterId, restoreSource, storeCharacter } from "./forge";
import { upsertCharacter } from "./library";
import { dummyEntry, everyCharacter, findCharacter, libraryOf, removeCharacter, setDummy, setStarters, starterEntries, starterIds } from "./library";

/** The character creator and the library, over HTTP, for signed-in players. */
export function attachCharacters(api: express.Router, forgeToken = "", dataDir = ""): void {
  api.get("/library", (req, res) => {
    const player = playerOf(req);
    if (!player) return res.status(401).json({ error: "not signed in" });
    const own = libraryOf(player.id);
    res.json({ player, characters: [...own, ...starterEntries().filter((s) => !own.some((c) => c.id === s.id))] });
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

  // { png: <data URL>, name?, description? } -> the new library entry, queued for the forge
  api.post("/characters", (req, res) => {
    const player = playerOf(req);
    if (!player) return res.status(401).json({ error: "not signed in" });
    const png = typeof req.body?.png === "string" ? decodePng(req.body.png) : null;
    if (!png) return res.status(400).json({ error: "drawing must be a PNG data URL" });
    if (png.length > DRAW_PNG_MAX_BYTES) return res.status(400).json({ error: "drawing too large" });
    const name = String(req.body?.name ?? "").replace(/[^\w .'!?-]/g, "").trim().slice(0, 28).toUpperCase();
    const description = String(req.body?.description ?? "").replace(/\s+/g, " ").trim().slice(0, 240);
    const hint = name || description ? { name, description } : null;
    const event = res.locals.event as WideEvent | undefined;
    const job = enqueueJob({ fighterId: newFighterId(player.id.replace(/\W+/g, "").slice(-4) || "p"), player, png, origin: "creator", hint, parent: event?.trace ?? null });
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
      const entry = upsertCharacter({ id, owner, status: "ready", stage: "", error: null, ...result, drawingUrl: drawingUrlOf(id), createdAt: Date.now(), origin: "creator" });
      res.json({ character: entry });
    } catch (e) { res.status(400).json({ error: (e as Error).message }); }
  });

  // a new module for a character that already exists (an engine migration, a fix), keeping everything else
  api.post("/characters/:id/source", async (req, res) => {
    if (!forgeToken || req.get("x-forge-token") !== forgeToken) return res.status(401).json({ error: "bad token" });
    const entry = findCharacter(req.params.id);
    if (!entry || entry.status !== "ready") return res.status(404).json({ error: "no such finished character" });
    const source = typeof req.body?.source === "string" ? req.body.source : "";
    if (!source) return res.status(400).json({ error: "source required" });
    try { res.json({ character: upsertCharacter({ ...entry, ...(await restoreSource(entry, source)) }) }); }
    catch (e) { res.status(400).json({ error: (e as Error).message }); }
  });

  // everyone's finished characters, for the title screen's brawl: just enough to load and name them
  api.get("/characters/everyone", (_req, res) => {
    res.json({ characters: everyCharacter().map((c) => ({ id: c.id, name: c.name, bundleUrl: c.bundleUrl })) });
  });

  api.get("/characters/:id", (req, res) => {
    const entry = [...libraryOf(playerOf(req)?.id ?? ""), ...starterEntries()].find((c) => c.id === req.params.id);
    if (!entry) return res.status(404).json({ error: "no such character" });
    res.json({ character: entry });
  });
  void jobOf;
}

export function decodePng(dataUrl: string): Buffer | null {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) return null;
  const buf = Buffer.from(m[1], "base64");
  return buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47 ? buf : null;
}
