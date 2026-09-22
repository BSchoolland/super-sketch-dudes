import type { WebSocketServer, WebSocket } from "ws";
import { roster } from "../shared/fighters/index";
import type { FighterId } from "../shared/types";

/**
 * Lobby and input relay. The server never simulates: it pairs clients into rooms,
 * picks the seed and slot order, and forwards every input frame to the other members.
 * Message shapes are documented in ARCHITECTURE.md.
 */
interface Client {
  ws: WebSocket;
  id: number;
  name: string;
  room: Room | null;
  slot: number;
  lastPing: number;
  fighter: FighterId;
  ready: boolean;
}
interface Room { code: string; members: Client[]; started: boolean; host: Client; seed: number; config: unknown }

let nextId = 1;
const rooms = new Map<string, Room>();
const queue: Client[] = [];

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function makeCode(): string {
  let c = "";
  do { c = ""; for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]; } while (rooms.has(c));
  return c;
}
function send(c: Client, msg: unknown): void {
  if (c.ws.readyState === c.ws.OPEN) c.ws.send(JSON.stringify(msg));
}
function broadcast(room: Room, msg: unknown, except?: Client): void {
  for (const m of room.members) if (m !== except) send(m, msg);
}
function roomInfo(room: Room): unknown {
  return {
    t: "room",
    code: room.code,
    host: room.host.id,
    started: room.started,
    members: room.members.map((m) => ({ id: m.id, name: m.name, slot: m.slot, fighter: m.fighter, ready: m.ready })),
  };
}
function leaveRoom(c: Client): void {
  const room = c.room;
  if (!room) return;
  const slot = c.slot;
  const duringMatch = room.started;
  c.room = null;
  c.ready = false;
  room.members = room.members.filter((m) => m !== c);
  if (!room.members.length) { rooms.delete(room.code); return; }
  if (room.host === c) room.host = room.members[0];
  if (duringMatch) {
    room.started = false;
    room.members.forEach((m) => (m.ready = false));
  }
  room.members.forEach((m, i) => (m.slot = i));
  broadcast(room, { t: "left", id: c.id, slot, duringMatch });
  broadcast(room, roomInfo(room));
}
function joinRoom(c: Client, room: Room): void {
  leaveRoom(c);
  c.room = room;
  c.slot = room.members.length;
  c.ready = false;
  room.members.push(c);
  broadcast(room, roomInfo(room));
}

export function attachLobby(wss: WebSocketServer): void {
  wss.on("connection", (ws) => {
    const id = nextId++;
    const c: Client = { ws, id, name: `guest${id}`, room: null, slot: 0, lastPing: Date.now(), fighter: "sable", ready: false };
    send(c, { t: "hello", id: c.id });
    ws.on("message", (raw) => {
      let msg: any;
      try { msg = JSON.parse(String(raw)); } catch { return; }
      if (!msg || typeof msg.t !== "string") return;
      switch (msg.t) {
        case "name": c.name = String(msg.name ?? "").replace(/[^\w \-.!?]/g, "").slice(0, 14) || c.name; if (c.room) broadcast(c.room, roomInfo(c.room)); break;
        case "ping": send(c, { t: "pong", at: msg.at }); break;
        case "create": { const room: Room = { code: makeCode(), members: [], started: false, host: c, seed: 0, config: null }; rooms.set(room.code, room); joinRoom(c, room); break; }
        case "join": {
          const room = rooms.get(String(msg.code ?? "").toUpperCase());
          if (!room) { send(c, { t: "error", error: "no such room" }); break; }
          if (room.started) { send(c, { t: "error", error: "match in progress" }); break; }
          if (room.members.length >= 4) { send(c, { t: "error", error: "room full" }); break; }
          joinRoom(c, room);
          break;
        }
        case "queue": {
          leaveRoom(c);
          if (!queue.includes(c)) queue.push(c);
          if (queue.length >= 2) {
            const a = queue.shift()!, b = queue.shift()!;
            const room: Room = { code: makeCode(), members: [], started: false, host: a, seed: 0, config: null };
            rooms.set(room.code, room);
            joinRoom(a, room); joinRoom(b, room);
            send(a, { t: "matched" }); send(b, { t: "matched" });
          } else send(c, { t: "queued" });
          break;
        }
        case "unqueue": { const i = queue.indexOf(c); if (i >= 0) queue.splice(i, 1); break; }
        case "leave": leaveRoom(c); break;
        case "pick": {
          if (!c.room || c.room.started) break;
          const fighter = String(msg.fighter ?? "") as FighterId;
          if (!roster[fighter]) { send(c, { t: "error", error: "unknown fighter" }); break; }
          c.fighter = fighter;
          c.ready = !!msg.ready;
          broadcast(c.room, roomInfo(c.room));
          break;
        }
        case "start": {
          const room = c.room;
          if (!room || room.host !== c || room.members.length < 2 || room.started) break;
          if (!room.members.every((m) => m.ready)) { send(c, { t: "error", error: "not everyone is ready" }); break; }
          if (!msg.config || typeof msg.config !== "object" || Array.isArray(msg.config)) { send(c, { t: "error", error: "invalid match config" }); break; }
          const requested = msg.config;
          room.started = true;
          room.seed = (Math.random() * 0xffffffff) >>> 0;
          room.config = { ...requested, players: room.members.map((m) => ({ fighter: m.fighter })) };
          broadcast(room, { t: "start", seed: room.seed, config: room.config, members: room.members.map((m) => ({ id: m.id, name: m.name, slot: m.slot })) });
          break;
        }
        case "inputs": if (c.room?.started) broadcast(c.room, { t: "inputs", slot: c.slot, frame: msg.frame | 0, inputs: msg.inputs }, c); break;
        case "hash": if (c.room?.started) broadcast(c.room, { t: "hash", slot: c.slot, frame: msg.frame | 0, hash: msg.hash >>> 0 }, c); break;
        case "end": if (c.room && c.room.host === c) { c.room.started = false; c.room.members.forEach((m) => (m.ready = false)); broadcast(c.room, roomInfo(c.room)); } break;
      }
    });
    ws.on("close", () => { const i = queue.indexOf(c); if (i >= 0) queue.splice(i, 1); leaveRoom(c); });
  });
}
