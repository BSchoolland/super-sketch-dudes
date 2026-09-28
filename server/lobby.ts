import type { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import { isBundlePath } from "../shared/account";
import { checkMap, MAP_JSON_MAX, type MapDoc } from "../shared/maps";
import { matchTrace, TRACE_RE, type WideEvent } from "../shared/wide";
import { finish, newTrace, openEvent } from "./events";

/**
 * Lobby and input relay. The server never simulates: it pairs clients into rooms,
 * picks the seed and slot order, and forwards every input frame to the other members.
 * Message shapes are documented in ARCHITECTURE.md.
 */
export interface Client {
  ws: WebSocket;
  id: number;
  name: string;
  room: Room | null;
  /** Relay slot. -1 = spectator: inputs from this client are dropped. */
  slot: number;
  lastPing: number;
  /** Fighter id and the bundle every client loads it from; "" until the first pick. */
  fighter: string;
  bundleUrl: string;
  ready: boolean;
  /** This connection's wide event, traced by the page session that opened it. */
  event: WideEvent;
}
export interface Room {
  code: string; trace: string; members: Client[]; started: boolean; host: Client; seed: number; config: unknown;
  /** Listed in JOIN ROOM and joinable by QUICK MATCH; private rooms need the code. */ public: boolean;
  /** Set while the host is on the stage screen after START: what they have picked so far, for everyone to watch. */ picking: StagePick | null;
  /** Game bundle hash the room plays on; null = whatever the page loaded. */ game: string | null;
  event: WideEvent;
  match: RelayMatch | null;
}
/** What the relay sees of one match: per slot, how inputs and hashes flowed. */
interface SlotRelay { inputs: number; newest: number; hashes: number; lastHashFrame: number; maxGapMs: number; stalls: number; lastAt: number }
export interface RelayMatch { event: WideEvent; slots: SlotRelay[]; hashes: Map<number, { hash: number; slot: number }> }

let nextId = 1;
export const rooms = new Map<string, Room>();
const ROOM_SIZE = 4;
/** `map` is the player-made map `stage` names, so guests can see and later play it. */
export interface StagePick { stage: string; stocks: number; time: number; map?: MapDoc }
function stagePick(v: unknown): StagePick | null {
  if (!v || typeof v !== "object") return null;
  const p = v as Record<string, unknown>;
  if (typeof p.stage !== "string" || typeof p.stocks !== "number" || typeof p.time !== "number") return null;
  const pick: StagePick = { stage: p.stage.slice(0, 32), stocks: p.stocks | 0, time: p.time | 0 };
  if (p.map !== undefined && p.map !== null) {
    const map = mapInMessage(p.map);
    if (!map || map.id !== pick.stage) return null;
    pick.map = map;
  }
  return pick;
}
/** A map a client sent: only ever relayed once it checks out, so nobody can push a broken one at a room. */
function mapInMessage(v: unknown): MapDoc | null {
  if (JSON.stringify(v).length > MAP_JSON_MAX || checkMap(v).length) return null;
  return v as MapDoc;
}

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function makeCode(): string {
  let c = "";
  do { c = ""; for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]; } while (rooms.has(c));
  return c;
}
export function send(c: Client, msg: unknown): void {
  if ((msg as { t?: unknown }).t === "error") pushCapped(c.event.business, "errorsSent", (msg as { error: string }).error);
  if (c.ws.readyState === c.ws.OPEN) c.ws.send(JSON.stringify(msg));
}
function pushCapped(business: Record<string, unknown>, key: string, value: unknown, cap = 40): void {
  const list = (business[key] ??= []) as unknown[];
  if (list.length < cap) list.push(value);
}
const since = (e: WideEvent): number => Date.now() - e.t0;

export function newRoom(host: Client, isPublic: boolean): Room {
  const code = makeCode();
  const trace = `r-${code}-${Date.now().toString(36)}`;
  const room: Room = { code, trace, members: [], started: false, host, seed: 0, config: null, public: isPublic, picking: null, game: null, match: null, event: openEvent("room", trace, host.event.trace) };
  room.event.set("room", { code, host: host.name, public: isPublic });
  rooms.set(code, room);
  return room;
}

/** The relay's own record of a match, on the trace every participant's client uses. */
export function startRelayMatch(room: Room, seed: number, config: unknown, members: Client[]): void {
  if (room.match) endRelayMatch(room, "replaced by the next start");
  const trace = matchTrace(room.code, seed);
  const slots: SlotRelay[] = members.map(() => ({ inputs: 0, newest: 0, hashes: 0, lastHashFrame: 0, maxGapMs: 0, stalls: 0, lastAt: 0 }));
  const event = openEvent("match", trace, room.trace)
    .set("match", { room: room.code, seed, config })
    .set("members", members.map((m) => ({ id: m.id, name: m.name, slot: m.slot, session: m.event.trace, fighter: m.fighter, bundleUrl: m.bundleUrl })))
    .set("relay", slots);
  room.match = { event, slots, hashes: new Map() };
  pushCapped(room.event.business, "matches", trace, 200);
}
export function endRelayMatch(room: Room, exit: string): void {
  const m = room.match;
  if (!m) return;
  room.match = null;
  const frames = Math.max(0, ...m.slots.map((s) => s.newest));
  m.event.set("exit", exit).set("summary", { message: `${m.slots.length}p · ${frames} frames · ${exit}` });
  finish(m.event);
}
function relayInput(m: RelayMatch, slot: number, frame: number): void {
  const s = m.slots[slot];
  if (!s) return;
  const now = Date.now();
  if (s.lastAt) {
    const gap = now - s.lastAt;
    s.maxGapMs = Math.max(s.maxGapMs, gap);
    if (gap > 1000) s.stalls++;
  }
  s.lastAt = now;
  s.inputs++;
  s.newest = Math.max(s.newest, frame);
}
function relayHash(m: RelayMatch, slot: number, frame: number, hash: number): void {
  const s = m.slots[slot];
  if (s) { s.hashes++; s.lastHashFrame = Math.max(s.lastHashFrame, frame); }
  const seen = m.hashes.get(frame);
  if (!seen) m.hashes.set(frame, { hash, slot });
  else if (seen.hash !== hash) m.event.issue("error", "desync", `frame ${frame}: slot ${seen.slot} hashed ${seen.hash}, slot ${slot} hashed ${hash}`);
  for (const f of m.hashes.keys()) if (f < frame - 900) m.hashes.delete(f);
}
export function broadcast(room: Room, msg: unknown, except?: Client): void {
  for (const m of room.members) if (m !== except) send(m, msg);
}
const open = (room: Room): boolean => room.public && !room.started && room.members.length < ROOM_SIZE;
/** What JOIN ROOM lists: public rooms with a free slot, not mid-match. */
function publicRooms(): unknown {
  return { t: "rooms", rooms: [...rooms.values()].filter(open).map((r) => ({ code: r.code, host: r.host.name, members: r.members.map((m) => m.name) })) };
}
function roomInfo(room: Room): unknown {
  return {
    t: "room",
    code: room.code,
    trace: room.trace,
    host: room.host.id,
    started: room.started,
    public: room.public,
    picking: room.picking,
    game: room.game,
    members: room.members.map((m) => ({ id: m.id, name: m.name, slot: m.slot, fighter: m.fighter, bundleUrl: m.bundleUrl, ready: m.ready })),
  };
}
export function leaveRoom(c: Client): void {
  const room = c.room;
  if (!room) return;
  const slot = c.slot;
  const duringMatch = room.started;
  c.room = null;
  c.ready = false;
  room.members = room.members.filter((m) => m !== c);
  pushCapped(room.event.business, "leaves", { id: c.id, name: c.name, at: since(room.event), duringMatch });
  if (room.match && duringMatch) {
    room.match.event.issue("warn", "left", `${c.name} (slot ${slot}) left mid-match at relay frame ${room.match.slots[slot]?.newest ?? "?"}`);
    pushCapped(room.match.event.business, "left", { id: c.id, name: c.name, slot, at: since(room.match.event), newest: room.match.slots[slot]?.newest ?? null });
  }
  if (!room.members.length) {
    rooms.delete(room.code);
    endRelayMatch(room, "everyone left");
    const joins = (room.event.business.joins as unknown[] | undefined)?.length ?? 0;
    const matches = (room.event.business.matches as unknown[] | undefined)?.length ?? 0;
    room.event.set("summary", { message: `room ${room.code} · ${joins} joined · ${matches} matches` });
    finish(room.event.set("exit", "empty"));
    return;
  }
  if (room.host === c) room.host = room.members[0];
  if (room.members.length < 2) room.picking = null;
  // mid-match the relay keeps everyone's slot: the clients carry on without an eliminated player, and the host's "end" reopens the room
  if (!duringMatch) room.members.forEach((m, i) => (m.slot = i));
  broadcast(room, { t: "left", id: c.id, slot, duringMatch });
  broadcast(room, roomInfo(room));
}
export function joinRoom(c: Client, room: Room): void {
  leaveRoom(c);
  c.room = room;
  c.slot = room.members.length;
  c.ready = false;
  room.members.push(c);
  room.picking = null;
  pushCapped(room.event.business, "joins", { id: c.id, name: c.name, session: c.event.trace, at: since(room.event) });
  pushCapped(c.event.business, "rooms", room.code);
  broadcast(room, roomInfo(room));
}

export function attachLobby(wss: WebSocketServer): void {
  wss.on("connection", (ws, req: IncomingMessage) => {
    const id = nextId++;
    // the page's session trace rides on the socket URL, so the connection files under the session that opened it
    const session = new URL(req.url ?? "", "http://relay").searchParams.get("trace");
    const event = openEvent("connection", session && TRACE_RE.test(session) ? session : newTrace("c"));
    const msgs: Record<string, number> = {};
    event.set("connection", { id, ua: String(req.headers["user-agent"] ?? "").slice(0, 200) }).set("msgs", msgs);
    const c: Client = { ws, id, name: `guest${id}`, room: null, slot: 0, lastPing: Date.now(), fighter: "", bundleUrl: "", ready: false, event };
    send(c, { t: "hello", id: c.id });
    ws.on("message", (raw) => {
      let msg: any;
      try { msg = JSON.parse(String(raw)); } catch { event.issue("warn", "protocol", "a message that isn't JSON"); return; }
      if (!msg || typeof msg.t !== "string") { event.issue("warn", "protocol", "a message without a type"); return; }
      const t = msg.t.slice(0, 24);
      if (t in msgs || Object.keys(msgs).length < 40) msgs[t] = (msgs[t] ?? 0) + 1;
      switch (msg.t) {
        case "name": c.name = String(msg.name ?? "").replace(/[^\w \-.!?]/g, "").slice(0, 14) || c.name; event.set("name", c.name); if (c.room) broadcast(c.room, roomInfo(c.room)); break;
        case "ping": send(c, { t: "pong", at: msg.at }); break;
        case "create": joinRoom(c, newRoom(c, !!msg.public)); break;
        case "rooms": send(c, publicRooms()); break;
        // the fullest open public room, so lobbies fill up before new ones open
        case "quick": {
          leaveRoom(c);
          const best = [...rooms.values()].filter(open).sort((a, b) => b.members.length - a.members.length)[0];
          joinRoom(c, best ?? newRoom(c, true));
          break;
        }
        case "join": {
          const room = rooms.get(String(msg.code ?? "").toUpperCase());
          if (!room) { send(c, { t: "error", error: "no such room" }); break; }
          if (room.started) { send(c, { t: "error", error: "match in progress" }); break; }
          if (room.members.length >= ROOM_SIZE) { send(c, { t: "error", error: "room full" }); break; }
          joinRoom(c, room);
          break;
        }
        case "leave": leaveRoom(c); break;
        case "pick": {
          if (!c.room || c.room.started) break;
          const fighter = String(msg.fighter ?? "");
          const bundleUrl = typeof msg.bundleUrl === "string" ? msg.bundleUrl : "";
          if (!isBundlePath(bundleUrl, fighter)) { send(c, { t: "error", error: "unknown fighter" }); break; }
          c.fighter = fighter;
          c.bundleUrl = bundleUrl;
          c.ready = !!msg.ready;
          if (!c.ready) c.room.picking = null;
          broadcast(c.room, roomInfo(c.room));
          break;
        }
        // the host moving between the lobby and the stage screen, and every change they make there
        case "picking": {
          const room = c.room;
          if (!room || room.host !== c || room.started) break;
          if (msg.pick !== null && !room.members.every((m) => m.ready)) { send(c, { t: "error", error: "not everyone is ready" }); break; }
          room.picking = msg.pick === null ? null : stagePick(msg.pick);
          broadcast(room, roomInfo(room));
          break;
        }
        case "start": {
          const room = c.room;
          if (!room || room.host !== c || room.members.length < 2 || room.started) break;
          if (!room.members.every((m) => m.ready)) { send(c, { t: "error", error: "not everyone is ready" }); break; }
          if (!msg.config || typeof msg.config !== "object" || Array.isArray(msg.config)) { send(c, { t: "error", error: "invalid match config" }); break; }
          const requested = msg.config as Record<string, unknown>;
          if (requested.map !== undefined) {
            const map = mapInMessage(requested.map);
            if (!map || map.id !== requested.stage) { send(c, { t: "error", error: "invalid map" }); break; }
            requested.map = map;
          }
          room.started = true;
          room.picking = null;
          room.seed = (Math.random() * 0xffffffff) >>> 0;
          room.config = { ...requested, players: room.members.map((m) => ({ fighter: m.fighter, bundleUrl: m.bundleUrl })) };
          startRelayMatch(room, room.seed, room.config, room.members);
          broadcast(room, { t: "start", seed: room.seed, config: room.config, members: room.members.map((m) => ({ id: m.id, name: m.name, slot: m.slot })) });
          break;
        }
        case "inputs":
          if (!c.room?.started || c.slot < 0) break;
          if (c.room.match) relayInput(c.room.match, c.slot, msg.frame | 0);
          broadcast(c.room, { t: "inputs", slot: c.slot, frame: msg.frame | 0, inputs: msg.inputs, ...syncReport(msg) }, c);
          break;
        case "hash":
          if (!c.room?.started || c.slot < 0) break;
          if (c.room.match) relayHash(c.room.match, c.slot, msg.frame | 0, msg.hash >>> 0);
          broadcast(c.room, { t: "hash", slot: c.slot, frame: msg.frame | 0, hash: msg.hash >>> 0 }, c);
          break;
        // the host picks the frame everyone swaps bundles at; relayed to the whole room, host included
        case "gameAt":
          if (!c.room || c.room.host !== c || typeof msg.hash !== "string") break;
          if (c.room.match) pushCapped(c.room.match.event.business, "swaps", { hash: msg.hash, frame: msg.frame | 0 });
          broadcast(c.room, { t: "gameAt", hash: msg.hash, frame: msg.frame | 0 });
          break;
        case "end": if (c.room && c.room.host === c) { endRelayMatch(c.room, "host ended"); c.room.started = false; c.room.members.forEach((m, i) => { m.ready = false; m.slot = i; }); broadcast(c.room, roomInfo(c.room)); } break;
      }
    });
    ws.on("close", (code, reason) => {
      leaveRoom(c);
      event.set("exit", { code, reason: String(reason).slice(0, 120) });
      event.set("summary", { message: `${c.name} · rooms ${((event.business.rooms as string[] | undefined) ?? []).join(" ") || "none"} · closed ${code}` });
      finish(event);
    });
  });
}

/** A client's time-sync report on its inputs (round trip, per-slot frame leads), passed on to the room when well formed. */
function syncReport(msg: { r?: unknown; l?: unknown }): { rtt?: number; leads?: number[] } {
  const out: { rtt?: number; leads?: number[] } = {};
  if (typeof msg.r === "number" && Number.isFinite(msg.r)) out.rtt = Math.max(0, Math.min(5000, Math.round(msg.r)));
  if (Array.isArray(msg.l) && msg.l.length <= 8 && msg.l.every((lead) => typeof lead === "number" && Number.isFinite(lead))) out.leads = msg.l.map((lead: number) => Math.max(-600, Math.min(600, lead)));
  return out;
}
