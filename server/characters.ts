import type express from "express";
import { DRAW_PNG_MAX_BYTES } from "../shared/draw";
import { playerOf } from "./auth";
import { enqueueJob, entryOf, jobOf, newFighterId } from "./forge";
import { libraryOf, removeCharacter } from "./library";

/** The character creator and the library, over HTTP, for signed-in players. */
export function attachCharacters(api: express.Router): void {
  api.get("/library", (req, res) => {
    const player = playerOf(req);
    if (!player) return res.status(401).json({ error: "not signed in" });
    res.json({ player, characters: libraryOf(player.id) });
  });

  api.delete("/library/:id", (req, res) => {
    const player = playerOf(req);
    if (!player) return res.status(401).json({ error: "not signed in" });
    if (!removeCharacter(player.id, req.params.id)) return res.status(404).json({ error: "not in your library" });
    res.status(204).end();
  });

  // { png: <data URL> } -> the new library entry, queued for the forge
  api.post("/characters", (req, res) => {
    const player = playerOf(req);
    if (!player) return res.status(401).json({ error: "not signed in" });
    const png = typeof req.body?.png === "string" ? decodePng(req.body.png) : null;
    if (!png) return res.status(400).json({ error: "drawing must be a PNG data URL" });
    if (png.length > DRAW_PNG_MAX_BYTES) return res.status(400).json({ error: "drawing too large" });
    const siblings = libraryOf(player.id).map((c) => c.name).filter((n): n is string => !!n);
    const job = enqueueJob({ fighterId: newFighterId(player.id.slice(-4)), player, siblings, png, origin: "creator" });
    res.json({ character: entryOf(job) });
  });

  api.get("/characters/:id", (req, res) => {
    const entry = libraryOf(playerOf(req)?.id ?? "").find((c) => c.id === req.params.id);
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
