import fs from "node:fs";
import path from "node:path";
import type express from "express";
import { checkMap, MAP_ID, MAP_JSON_MAX, MAP_NAME_MAX, newMapDoc, type MapDoc } from "../shared/maps";
import type { Player } from "../shared/account";
import { playerOf } from "./auth";

/**
 * Player-made maps: one JSON file per map under <dataDir>/maps/. Who may make them is the list
 * of player ids in <dataDir>/map-makers.json ("*" opens it to everyone); a DEV_LOGIN server lets
 * anyone. Everyone signed in can read their own maps; a map travels to other players inside the
 * host's stage pick, not through here.
 */
export interface MapsOptions { dataDir: string; devLogin: boolean }

/** Ben's Discord account: the first map maker. */
const FIRST_MAKER = "953441333601763358";

let dir = "";
let makersFile = "";
let devLogin = false;
const maps = new Map<string, MapDoc>();

function fileOf(id: string): string {
  return path.join(dir, `${id}.json`);
}

function makers(): string[] {
  if (!fs.existsSync(makersFile)) fs.writeFileSync(makersFile, JSON.stringify([FIRST_MAKER], null, 1));
  const list = JSON.parse(fs.readFileSync(makersFile, "utf8")) as unknown;
  if (!Array.isArray(list) || !list.every((v) => typeof v === "string")) throw new Error(`${makersFile} must be a list of player ids`);
  return list;
}

export function canMakeMaps(player: Player): boolean {
  if (devLogin) return true;
  const list = makers();
  return list.includes("*") || list.includes(player.id);
}

export function initMaps(opts: MapsOptions): void {
  dir = path.join(opts.dataDir, "maps");
  fs.mkdirSync(dir, { recursive: true });
  makersFile = path.join(opts.dataDir, "map-makers.json");
  devLogin = opts.devLogin;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    const doc = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as MapDoc;
    const problems = checkMap(doc);
    if (problems.length) throw new Error(`stored map ${f} is invalid: ${problems.join("; ")}`);
    maps.set(doc.id, doc);
  }
}

export function mapsOf(owner: string): MapDoc[] {
  return [...maps.values()].filter((m) => m.owner === owner).sort((a, b) => b.updatedAt - a.updatedAt);
}

function store(doc: MapDoc): void {
  maps.set(doc.id, doc);
  fs.writeFileSync(fileOf(doc.id), JSON.stringify(doc, null, 1));
}

const cleanName = (v: unknown): string => String(v ?? "").replace(/[^\w .'!?&-]/g, "").replace(/\s+/g, " ").trim().slice(0, MAP_NAME_MAX).toUpperCase();

/** The client's copy of a map, with the fields only the server decides put back. */
function incoming(body: unknown, base: MapDoc): MapDoc | string[] {
  if (!body || typeof body !== "object") return ["map must be an object"];
  if (JSON.stringify(body).length > MAP_JSON_MAX) return ["map too large"];
  const b = body as Record<string, unknown>;
  const doc: MapDoc = { ...base, name: cleanName(b.name), pieces: b.pieces as MapDoc["pieces"], spawns: b.spawns as MapDoc["spawns"], updatedAt: Date.now() };
  const problems = checkMap(doc);
  return problems.length ? problems : doc;
}

export function attachMaps(api: express.Router): void {
  api.get("/maps", (req, res) => {
    const player = playerOf(req);
    if (!player) return res.status(401).json({ error: "not signed in" });
    res.json({ maps: mapsOf(player.id), canCreate: canMakeMaps(player) });
  });

  api.post("/maps", (req, res) => {
    const player = playerOf(req);
    if (!player) return res.status(401).json({ error: "not signed in" });
    if (!canMakeMaps(player)) return res.status(403).json({ error: "map making isn't open to you yet" });
    const id = (req.body as { id?: unknown } | null)?.id;
    if (typeof id !== "string" || !MAP_ID.test(id)) return res.status(400).json({ error: "bad map id" });
    if (maps.has(id)) return res.status(409).json({ error: "that map id is taken" });
    const now = Date.now();
    const doc = incoming(req.body, newMapDoc(id, player.id, player.name, "", now));
    if (Array.isArray(doc)) return res.status(400).json({ error: doc.join("; ") });
    store(doc);
    res.json({ map: doc });
  });

  api.put("/maps/:id", (req, res) => {
    const player = playerOf(req);
    if (!player) return res.status(401).json({ error: "not signed in" });
    if (!canMakeMaps(player)) return res.status(403).json({ error: "map making isn't open to you yet" });
    const existing = MAP_ID.test(req.params.id) ? maps.get(req.params.id) : undefined;
    if (!existing || existing.owner !== player.id) return res.status(404).json({ error: "not one of your maps" });
    const doc = incoming(req.body, existing);
    if (Array.isArray(doc)) return res.status(400).json({ error: doc.join("; ") });
    store(doc);
    res.json({ map: doc });
  });

  api.delete("/maps/:id", (req, res) => {
    const player = playerOf(req);
    if (!player) return res.status(401).json({ error: "not signed in" });
    const existing = MAP_ID.test(req.params.id) ? maps.get(req.params.id) : undefined;
    if (!existing || existing.owner !== player.id) return res.status(404).json({ error: "not one of your maps" });
    maps.delete(existing.id);
    fs.rmSync(fileOf(existing.id));
    res.status(204).end();
  });
}
