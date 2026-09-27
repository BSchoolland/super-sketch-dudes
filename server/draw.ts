import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type express from "express";
import { broadcast, endRelayMatch, joinRoom, leaveRoom, newRoom, rooms, send, setRoomExtension, startRelayMatch, type Client, type Room } from "./lobby";
import { DRAW_DEFAULTS, DRAW_PNG_MAX_BYTES, type CharStatus, type DrawBattle, type DrawCharacter, type DrawPhase, type DrawPlayer, type DrawRoomState } from "../shared/draw";
import { stageList } from "../shared/stages/index";
import { playerFromSession } from "./auth";
import { decodePng } from "./characters";
import { drawingUrlOf, enqueueJob, onJob, charStatusOf, type ForgeJob } from "./forge";

/**
 * DRAW BATTLE: the room state machine and the forge job queue. The server is the clock and the
 * referee; it never simulates. Battles are relayed exactly like classic online matches (same
 * `start` message, same input relay), with participants' relay slots renumbered per battle.
 *
 * The forge (a worker on Ben's machine) polls /api/forge/jobs/next with FORGE_TOKEN, downloads the
 * drawing, and posts back a fighter bundle. Nothing here ever calls out to it.
 */

interface DrawState {
  phase: DrawPhase;
  round: number;
  rounds: number;
  drawSeconds: number;
  deadline: number;
  timer: NodeJS.Timeout | null;
  players: Map<number, DrawPlayer>; // by client id
  battles: DrawBattle[];
  battle: DrawBattle | null;
  note: string;
  drawRoot: string;
}
export interface DrawOptions {
  password: string;
  dataDir: string;
}

export function attachDraw(api: express.Router, opts: DrawOptions): void {
  const drawDir = path.join(opts.dataDir, "draw");
  fs.mkdirSync(drawDir, { recursive: true });

  const stateOf = (room: Room): DrawState => room.draw as DrawState;
  const snapshot = (room: Room): DrawRoomState => {
    const d = stateOf(room);
    return {
      code: room.code, trace: room.trace, host: room.host.id, phase: d.phase, round: d.round, rounds: d.rounds, drawSeconds: d.drawSeconds, deadline: d.deadline,
      players: [...d.players.values()], battles: d.battles, battle: d.battle, note: d.note,
    };
  };
  const push = (room: Room): void => {
    const d = stateOf(room);
    const phases = (room.event.business.phases ??= []) as { phase: DrawPhase; round: number; at: number }[];
    const last = phases[phases.length - 1];
    if ((!last || last.phase !== d.phase || last.round !== d.round) && phases.length < 60) phases.push({ phase: d.phase, round: d.round, at: Date.now() - room.event.t0 });
    broadcast(room, { t: "draw", room: snapshot(room) });
  };
  const setTimer = (room: Room, ms: number, fn: () => void): void => {
    const d = stateOf(room);
    if (d.timer) clearTimeout(d.timer);
    d.deadline = ms > 0 ? Date.now() + ms : 0;
    d.timer = ms > 0 ? setTimeout(() => { d.timer = null; if (rooms.get(room.code) === room) fn(); }, ms) : null;
  };
  const alive = (d: DrawState): DrawPlayer[] => [...d.players.values()].filter((p) => p.alive && p.connected);
  const charOf = (d: DrawState, playerId: number, round: number): DrawCharacter | undefined => d.players.get(playerId)?.characters[round - 1];

  function newCharacter(round: number): DrawCharacter {
    return { round, status: "waiting", stage: "", drawingUrl: null, fighterId: null, bundleUrl: null, sheetUrl: null, name: null, tagline: null, description: null, card: null, error: null, spent: false };
  }
  function addPlayer(room: Room, c: Client): void {
    const d = stateOf(room);
    d.players.set(c.id, { id: c.id, name: c.name, slot: c.slot, ready: false, loaded: [], characters: [], current: -1, alive: true, wins: 0, connected: true });
  }

  // ---- phases ----
  function startDrawRound(room: Room, round: number): void {
    const d = stateOf(room);
    d.phase = "draw"; d.round = round; d.note = `draw character ${round} of ${d.rounds}`;
    for (const p of d.players.values()) { p.ready = false; if (!p.characters[round - 1]) p.characters[round - 1] = newCharacter(round); }
    setTimer(room, d.drawSeconds * 1000 + 4000, () => endDrawRound(room));
    push(room);
  }
  function endDrawRound(room: Room): void {
    const d = stateOf(room);
    if (d.phase !== "draw") return;
    for (const p of d.players.values()) {
      const ch = p.characters[d.round - 1];
      if (ch.status === "waiting") { ch.status = "failed"; ch.error = "no drawing arrived before the clock ran out"; }
    }
    // rounds run back to back; the only wait is at the end, for the forge
    if (d.round < d.rounds) { startDrawRound(room, d.round + 1); return; }
    d.phase = "reveal";
    d.note = "the last characters are still being made";
    for (const p of d.players.values()) p.ready = false;
    setTimer(room, 0, () => {});
    push(room);
    maybeAdvanceReveal(room);
  }
  /** The forge wait ends when every character is settled and everyone is ready. */
  function maybeAdvanceReveal(room: Room): void {
    const d = stateOf(room);
    if (d.phase !== "reveal") return;
    const players = [...d.players.values()].filter((p) => p.connected);
    const everyoneReady = players.length > 0 && players.every((p) => p.ready);
    const settled = players.every((p) => p.characters.every((ch) => ch.status === "ready" || ch.status === "failed"));
    if (!settled) { d.note = "the last characters are still being made"; return; }
    d.note = everyoneReady ? "" : "everyone's characters are in: ready up to fight";
    if (everyoneReady) beginLadder(room);
    else push(room);
  }
  function beginLadder(room: Room): void {
    const d = stateOf(room);
    for (const p of d.players.values()) {
      p.current = p.characters.findIndex((ch) => ch.status === "ready" && !ch.spent);
      p.alive = p.current >= 0 && p.connected;
    }
    if (alive(d).length < 2) { finish(room, "not enough characters made it"); return; }
    nextBattle(room);
  }
  function nextBattle(room: Room): void {
    const d = stateOf(room);
    const parts = alive(d);
    if (parts.length < 2) { finish(room, parts.length === 1 ? `${parts[0].name} wins` : "nobody left standing"); return; }
    const stage = stageList[(d.battles.length * 7 + room.code.charCodeAt(0)) % stageList.length].id;
    d.battle = { index: d.battles.length, participants: parts.map((p) => p.id), winner: null, seed: (Math.random() * 0xffffffff) >>> 0, stage };
    d.phase = "loading"; d.note = "loading everyone's fighters";
    for (const p of d.players.values()) { p.ready = false; p.loaded = []; }
    setTimer(room, 0, () => {});
    push(room);
  }
  function maybeStartBattle(room: Room): void {
    const d = stateOf(room);
    if (d.phase !== "loading" || !d.battle) return;
    const parts = d.battle.participants.map((id) => d.players.get(id)!);
    const fighters = parts.map((p) => p.characters[p.current].fighterId!);
    if (!parts.every((p) => fighters.every((f) => p.loaded.includes(f)))) return;
    // relay slots: participants in order, everyone else spectates
    for (const m of room.members) m.slot = d.battle.participants.indexOf(m.id);
    room.started = true;
    d.phase = "battle"; d.note = "";
    const members = parts.map((p, slot) => ({ id: p.id, name: p.name, slot }));
    const config = { stage: d.battle.stage, rules: { stocks: DRAW_DEFAULTS.stocks, time: 0 }, inputDelay: 2, players: fighters.map((fighter) => ({ fighter })) };
    startRelayMatch(room, d.battle.seed, config, d.battle.participants.map((id) => room.members.find((m) => m.id === id)!));
    broadcast(room, { t: "start", seed: d.battle.seed, config, members });
    push(room);
  }
  function endBattle(room: Room, winnerSlot: number): void {
    const d = stateOf(room);
    if (d.phase !== "battle" || !d.battle) return;
    room.started = false;
    const winnerId = d.battle.participants[winnerSlot] ?? -1;
    d.battle.winner = winnerId;
    d.battles.push(d.battle);
    for (const id of d.battle.participants) {
      const p = d.players.get(id)!;
      if (id === winnerId) { p.wins++; continue; }
      p.characters[p.current].spent = true;
      p.current = p.characters.findIndex((ch) => ch.status === "ready" && !ch.spent);
      if (p.current < 0) p.alive = false;
    }
    const w = d.players.get(winnerId);
    endRelayMatch(room, w ? `${w.name} won` : "no winner");
    d.phase = "between"; d.note = w ? `${w.name} wins with ${w.characters[w.current]?.name ?? "?"}` : "no winner";
    setTimer(room, DRAW_DEFAULTS.betweenSeconds * 1000, () => nextBattle(room));
    push(room);
  }
  function finish(room: Room, note: string): void {
    const d = stateOf(room);
    d.phase = "over"; d.note = note; d.battle = null;
    room.started = false;
    endRelayMatch(room, note);
    room.event.set("result", { message: note });
    setTimer(room, 0, () => {});
    push(room);
  }

  // ---- forge jobs: a draw round's drawings are forge jobs owned by the players; the room mirrors their progress ----
  const jobChars = new Map<string, { code: string; playerId: number; round: number }>(); // by fighterId
  onJob((job: ForgeJob) => {
    const at = jobChars.get(job.fighterId);
    const room = at && rooms.get(at.code);
    if (!at || !room || !room.draw) return;
    const ch = charOf(stateOf(room), at.playerId, at.round);
    if (!ch) return;
    ch.status = charStatusOf(job); ch.stage = job.stage; ch.error = job.error;
    if (job.result) { ch.name = job.result.name; ch.tagline = job.result.tagline; ch.description = job.result.description; ch.card = job.result.card; ch.bundleUrl = job.result.bundleUrl; ch.sheetUrl = job.result.sheetUrl; }
    push(room);
    if (ch.status === "ready" || ch.status === "failed") maybeAdvanceReveal(room);
  });

  // ---- websocket messages ----
  const drawRooms = (): Room[] => [...rooms.values()].filter((r) => r.draw);
  setRoomExtension({
    handle(c, msg) {
      const room = c.room;
      const d = room?.draw ? stateOf(room) : null;
      switch (msg.t) {
        case "drawAuth": {
          const ok = typeof msg.password === "string" && !!opts.password && safeEqual(msg.password, opts.password);
          c.drawAuthed = ok;
          send(c, { t: "drawAuth", ok, error: ok ? undefined : "wrong password" });
          return true;
        }
        case "drawCreate": case "drawJoin": {
          if (!c.drawAuthed) { send(c, { t: "error", error: "password first" }); return true; }
          const player = playerFromSession(msg.session);
          if (!player) { send(c, { t: "error", error: "sign in first" }); return true; }
          c.player = player;
          c.name = player.name;
          let target: Room;
          if (msg.t === "drawCreate") {
            target = newRoom(c, (code): DrawState => ({ phase: "lobby", round: 0, rounds: DRAW_DEFAULTS.rounds, drawSeconds: DRAW_DEFAULTS.drawSeconds, deadline: 0, timer: null, players: new Map(), battles: [], battle: null, note: "", drawRoot: path.join(drawDir, code) }));
          } else {
            const found = rooms.get(String(msg.code ?? "").toUpperCase());
            if (!found || !found.draw) { send(c, { t: "error", error: "no such room" }); return true; }
            if (stateOf(found).phase !== "lobby") { send(c, { t: "error", error: "that game already started" }); return true; }
            if (found.members.length >= DRAW_DEFAULTS.maxPlayers) { send(c, { t: "error", error: "room full" }); return true; }
            target = found;
          }
          joinRoom(c, target);
          addPlayer(target, c);
          push(target);
          return true;
        }
        case "drawLeave": leaveRoom(c); return true;
      }
      if (!room || !d) { send(c, { t: "error", error: "not in a draw room" }); return true; }
      const p = d.players.get(c.id);
      if (!p) { send(c, { t: "error", error: "not a player here" }); return true; }
      switch (msg.t) {
        case "drawStart": {
          if (room.host !== c || d.phase !== "lobby") return true;
          if (room.members.length < DRAW_DEFAULTS.minPlayers) { send(c, { t: "error", error: `need ${DRAW_DEFAULTS.minPlayers} players` }); return true; }
          d.rounds = clampInt(msg.rounds, 1, 5, DRAW_DEFAULTS.rounds);
          d.drawSeconds = clampInt(msg.drawSeconds, 20, 300, DRAW_DEFAULTS.drawSeconds);
          fs.mkdirSync(d.drawRoot, { recursive: true });
          startDrawRound(room, 1);
          return true;
        }
        case "drawSubmit": {
          const round = Number(msg.round);
          if (d.phase !== "draw" || round !== d.round) { send(c, { t: "error", error: "not drawing right now" }); return true; }
          const ch = p.characters[round - 1];
          if (ch.status !== "waiting") return true; // already in
          const png = typeof msg.png === "string" ? decodePng(msg.png) : null;
          if (!png) { send(c, { t: "error", error: "drawing must be a PNG data URL" }); return true; }
          if (png.length > DRAW_PNG_MAX_BYTES) { send(c, { t: "error", error: "drawing too large" }); return true; }
          if (!c.player) { send(c, { t: "error", error: "sign in first" }); return true; }
          const fighterId = `gen-${room.code.toLowerCase()}-${p.slot}-${round}`;
          const siblings = p.characters.filter((q) => q.round !== round && q.name).map((q) => q.name!);
          jobChars.set(fighterId, { code: room.code, playerId: p.id, round });
          const job = enqueueJob({ fighterId, player: c.player, siblings, png, origin: { room: room.code, round }, parent: room.trace });
          const drawings = (room.event.business.drawings ??= []) as unknown[];
          if (drawings.length < 60) drawings.push({ player: p.name, round, bytes: png.length, forge: `f-${job.id}` });
          ch.status = "queued"; ch.stage = "waiting in line"; ch.fighterId = fighterId; ch.drawingUrl = drawingUrlOf(fighterId);
          push(room);
          if ([...d.players.values()].every((q) => !q.connected || q.characters[round - 1].status !== "waiting")) endDrawRound(room);
          return true;
        }
        case "drawReady": {
          p.ready = !!msg.ready;
          push(room);
          if (d.phase === "reveal") maybeAdvanceReveal(room);
          return true;
        }
        case "drawLoaded": {
          if (Array.isArray(msg.fighterIds)) p.loaded = msg.fighterIds.map(String).slice(0, 32);
          maybeStartBattle(room);
          // everyone's loading screen shows who's in
          if (d.phase === "loading") push(room);
          return true;
        }
        case "drawBattleEnd": {
          // an eliminated host isn't simulating the match, so relay slot 0 reports instead
          const reporter = d.battle && !d.battle.participants.includes(room.host.id) ? d.battle.participants[0] : room.host.id;
          if (c.id !== reporter) return true;
          endBattle(room, Number(msg.winner));
          return true;
        }
      }
      return false;
    },
    onLeave(c, room, duringMatch) {
      if (!rooms.has(room.code)) { const d = stateOf(room); if (d.timer) clearTimeout(d.timer); return; }
      const d = stateOf(room);
      const p = d.players.get(c.id);
      if (p) { p.connected = false; p.ready = false; if (d.phase !== "lobby") p.alive = false; else d.players.delete(c.id); }
      if (d.phase === "lobby") room.members.forEach((m, i) => { m.slot = i; const q = d.players.get(m.id); if (q) q.slot = i; });
      if (duringMatch && d.battle) {
        // the match can't continue without them: whoever is left in it wins it
        const left = d.battle.participants.filter((id) => d.players.get(id)?.connected);
        broadcast(room, { t: "left", id: c.id, slot: d.battle.participants.indexOf(c.id), duringMatch: true });
        if (left.length === 1) endBattle(room, d.battle.participants.indexOf(left[0]));
        else if (left.length === 0) finish(room, "everyone left");
        // two or more remain but the match can't continue without the missing inputs: the reporter ends it from where it stopped
        else push(room);
        return;
      }
      if (d.phase === "reveal") maybeAdvanceReveal(room);
      if (d.phase === "loading") maybeStartBattle(room);
      push(room);
    },
  });
  void drawRooms;
}

function clampInt(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : dflt;
}
function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
