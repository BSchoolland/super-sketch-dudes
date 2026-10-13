import fs from "node:fs";
import type { WebSocket } from "ws";
import path from "node:path";
import type { WideEvent, WideEventRecord } from "../shared/wide";
import { RESUME_GRACE_MS } from "../shared/resume";
import { handOver, resumeEvent } from "./events";
import { clients, holdForResume, idsFrom, nextClientId, rooms, type Client, type RelayMatch, type Room, type SlotRelay } from "./lobby";

/**
 * Rooms and matches outlive a deploy. On SIGINT/SIGTERM the relay writes out every client (id, resume token, room)
 * and every room (lobby, local game or running match, with the inputs the match forwarded), and the next process
 * loads them as if every socket had just broken: the clients resume onto it the way they do after a wifi dropout
 * (see "resume" in lobby.ts), their wide events carry on under the same ids, and a client that doesn't come back
 * within RESUME_GRACE_MS is dropped as usual.
 */
export const HANDOFF_FILE = "handoff.json";
/** Bump when what's saved or the relay protocol changes in a way the next process can't take: an older file is dropped. */
export const HANDOFF_VERSION = 1;

type SavedSlot = Omit<SlotRelay, "history"> & { history: [number, unknown][] };
interface SavedClient { id: number; name: string; slot: number; rtt: number | null; fighter: string; bundleUrl: string; ready: boolean; peerRtt: [number, number][]; token: string; event: WideEventRecord }
interface SavedMatch { event: WideEventRecord; slots: SavedSlot[]; hashes: [number, { hash: number; slot: number }][]; loaded: number[]; goAt: number; fillers: number[]; fills: boolean; left: [number, { id: number; frame: number }][] }
interface SavedRoom { code: string; public: boolean; started: boolean; seed: number; config: unknown; picking: Room["picking"]; game: string | null; bots: Room["bots"]; host: number; members: number[]; event: WideEventRecord; match: SavedMatch | null }
interface Handoff { version: number; at: number; nextId: number; clients: SavedClient[]; rooms: SavedRoom[] }

/** The socket of a client the previous process handed over, until a fresh socket resumes it. */
const HANDED_OVER = { readyState: 3, OPEN: 1, CONNECTING: 0, close() {}, send() { throw new Error("sent on a handed-over socket"); } } as unknown as WebSocket;
/** How long a handed-over match waits for all its players' inputs before deciding the missing ones away again. */
const HOLD_FILLS_MS = 3000;

export function saveHandoff(dataDir: string): void {
  if (!clients.size) return;
  const ids = (list: Iterable<Client>) => [...list].map((c) => c.id);
  const saveMatch = (m: RelayMatch): SavedMatch => ({
    event: handOver(m.event), slots: m.slots.map((s) => ({ ...s, history: [...s.history] })), hashes: [...m.hashes], loaded: ids(m.loaded), goAt: m.goAt,
    fillers: ids(m.fillers), fills: m.fills, left: [...m.left],
  });
  const handoff: Handoff = {
    version: HANDOFF_VERSION, at: Date.now(), nextId: nextClientId(),
    clients: [...clients.values()].map((c) => ({ id: c.id, name: c.name, slot: c.slot, rtt: c.rtt, fighter: c.fighter, bundleUrl: c.bundleUrl, ready: c.ready, peerRtt: [...c.peerRtt], token: c.token, event: handOver(c.event) })),
    rooms: [...rooms.values()].map((r) => ({
      code: r.code, public: r.public, started: r.started, seed: r.seed, config: r.config, picking: r.picking, game: r.game, bots: r.bots, host: r.host.id,
      members: ids(r.members), event: handOver(r.event), match: r.match ? saveMatch(r.match) : null,
    })),
  };
  const file = path.join(dataDir, HANDOFF_FILE);
  fs.writeFileSync(file + ".tmp", JSON.stringify(handoff));
  fs.renameSync(file + ".tmp", file);
}

/** At boot: the rooms and clients the previous process handed over, if it did just now. */
export function restoreHandoff(dataDir: string, processEvent: WideEvent): void {
  const file = path.join(dataDir, HANDOFF_FILE);
  if (!fs.existsSync(file)) return;
  const handoff = JSON.parse(fs.readFileSync(file, "utf8")) as Handoff;
  fs.rmSync(file);
  const gapMs = Date.now() - handoff.at;
  // another version's file may not even have this one's shape
  if (handoff.version !== HANDOFF_VERSION) {
    processEvent.set("handoff", { version: handoff.version, gapMs }).issue("warn", "handoff", `dropped rooms handed over at version ${handoff.version} (this is ${HANDOFF_VERSION})`);
    return;
  }
  processEvent.set("handoff", { clients: handoff.clients.length, rooms: handoff.rooms.map((r) => r.code), matches: handoff.rooms.filter((r) => r.match).length, gapMs });
  if (gapMs > RESUME_GRACE_MS) {
    processEvent.issue("warn", "handoff", `dropped rooms handed over ${gapMs} ms ago: past the resume grace`);
    return;
  }
  idsFrom(handoff.nextId);
  const restored = new Map<number, Client>(handoff.clients.map((c) => [c.id, {
    ws: HANDED_OVER, id: c.id, name: c.name, room: null, slot: c.slot, lastPing: Date.now(), rtt: c.rtt, fighter: c.fighter, bundleUrl: c.bundleUrl,
    ready: c.ready, event: resumeEvent(c.event), peerRtt: new Map(c.peerRtt), token: c.token, grace: null,
  }]));
  const byId = (id: number): Client => {
    const c = restored.get(id);
    if (!c) throw new Error(`handoff: no client ${id}`);
    return c;
  };
  for (const r of handoff.rooms) {
    const room: Room = {
      code: r.code, trace: r.event.trace, members: r.members.map(byId), started: r.started, host: byId(r.host), seed: r.seed, config: r.config,
      public: r.public, picking: r.picking, game: r.game, bots: r.bots, event: resumeEvent(r.event), match: r.match ? restoreMatch(r.match, r.members.map(byId), byId, gapMs) : null,
    };
    for (const c of room.members) c.room = room;
    rooms.set(room.code, room);
  }
  for (const c of restored.values()) {
    clients.set(c.id, c);
    holdForResume(c, { handoff: "never resumed" }, "handed over, never resumed");
  }
}

function restoreMatch(s: SavedMatch, members: Client[], byId: (id: number) => Client, gapMs: number): RelayMatch {
  const slots: SlotRelay[] = s.slots.map((slot) => ({ ...slot, history: new Map(slot.history) }));
  const event = resumeEvent(s.event);
  // the snapshot's relay is a copy: the live one is these slots
  event.set("relay", slots).set("handoff", { gapMs });
  return { event, slots, hashes: new Map(s.hashes), loaded: new Set(s.loaded.map(byId)), goAt: s.goAt, fillers: new Set(s.fillers.map(byId)), fills: s.fills, left: new Map(s.left), handoff: { until: Date.now() + HOLD_FILLS_MS, players: new Set(members.filter((c) => slots[c.slot])) } };
}
