import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type express from "express";
import { broadcast, joinRoom, leaveRoom, makeCode, rooms, send, setRoomExtension, type Client, type Room } from "./lobby";
import { DRAW_DEFAULTS, DRAW_PNG_MAX_BYTES, type CharStatus, type DrawBattle, type DrawCharacter, type DrawPhase, type DrawPlayer, type DrawRoomState } from "../shared/draw";
import { buildGenerated } from "../shared/gen/load";
import { SPRITE_CELLS } from "../shared/gen/sprite";
import { stageList } from "../shared/stages/index";

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
interface Job {
  id: string;
  room: string;
  playerId: number;
  playerName: string;
  slot: number;
  round: number;
  fighterId: string;
  drawingPath: string;
  status: "queued" | "running" | "done" | "failed";
  stage: string;
  claimedAt: number;
  attempts: number;
  /** Names of the player's other characters so the agent avoids repeats. */
  siblings: string[];
}

const jobs = new Map<string, Job>();
const queue: string[] = [];

export interface DrawOptions {
  password: string;
  forgeToken: string;
  dataDir: string;
  /** URL prefix the client uses for generated files, e.g. "/sketch-battle/gen". */
  genBase: string;
}

export function attachDraw(api: express.Router, opts: DrawOptions): void {
  const genDir = path.join(opts.dataDir, "gen");
  const drawDir = path.join(opts.dataDir, "draw");
  fs.mkdirSync(genDir, { recursive: true });
  fs.mkdirSync(drawDir, { recursive: true });

  const stateOf = (room: Room): DrawState => room.draw as DrawState;
  const snapshot = (room: Room): DrawRoomState => {
    const d = stateOf(room);
    return {
      code: room.code, host: room.host.id, phase: d.phase, round: d.round, rounds: d.rounds, drawSeconds: d.drawSeconds, deadline: d.deadline,
      players: [...d.players.values()], battles: d.battles, battle: d.battle, note: d.note,
    };
  };
  const push = (room: Room): void => broadcast(room, { t: "draw", room: snapshot(room) });
  const setTimer = (room: Room, ms: number, fn: () => void): void => {
    const d = stateOf(room);
    if (d.timer) clearTimeout(d.timer);
    d.deadline = ms > 0 ? Date.now() + ms : 0;
    d.timer = ms > 0 ? setTimeout(() => { d.timer = null; if (rooms.get(room.code) === room) fn(); }, ms) : null;
  };
  const alive = (d: DrawState): DrawPlayer[] => [...d.players.values()].filter((p) => p.alive && p.connected);
  const charOf = (d: DrawState, playerId: number, round: number): DrawCharacter | undefined => d.players.get(playerId)?.characters[round - 1];

  function newCharacter(round: number): DrawCharacter {
    return { round, status: "waiting", stage: "", drawingUrl: null, fighterId: null, bundleUrl: null, sheetUrl: null, name: null, tagline: null, description: null, error: null, spent: false };
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
    d.phase = "reveal";
    d.note = d.round < d.rounds ? "look what everyone drew" : "the forge is finishing up";
    for (const p of d.players.values()) p.ready = false;
    if (d.round < d.rounds) setTimer(room, DRAW_DEFAULTS.revealSeconds * 1000, () => startDrawRound(room, d.round + 1));
    else setTimer(room, 0, () => {});
    push(room);
    maybeAdvanceReveal(room);
  }
  /** Reveal ends early when everyone is ready; the final reveal also needs every character settled. */
  function maybeAdvanceReveal(room: Room): void {
    const d = stateOf(room);
    if (d.phase !== "reveal") return;
    const players = [...d.players.values()].filter((p) => p.connected);
    const everyoneReady = players.length > 0 && players.every((p) => p.ready);
    if (d.round < d.rounds) { if (everyoneReady) startDrawRound(room, d.round + 1); return; }
    const settled = players.every((p) => p.characters.every((ch) => ch.status === "ready" || ch.status === "failed"));
    if (!settled) { d.note = "the forge is finishing up"; return; }
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
    if (alive(d).length < 2) { finish(room, "not enough fighters made it out of the forge"); return; }
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
    broadcast(room, { t: "start", seed: d.battle.seed, config: { stage: d.battle.stage, rules: { stocks: DRAW_DEFAULTS.stocks, time: 0 }, inputDelay: 2, players: fighters.map((fighter) => ({ fighter })) }, members });
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
    d.phase = "between"; d.note = w ? `${w.name} wins with ${w.characters[w.current]?.name ?? "?"}` : "no winner";
    setTimer(room, DRAW_DEFAULTS.betweenSeconds * 1000, () => nextBattle(room));
    push(room);
  }
  function finish(room: Room, note: string): void {
    const d = stateOf(room);
    d.phase = "over"; d.note = note; d.battle = null;
    room.started = false;
    setTimer(room, 0, () => {});
    push(room);
  }

  // ---- forge queue ----
  function enqueue(room: Room, p: DrawPlayer, round: number, drawingPath: string): void {
    const d = stateOf(room);
    const fighterId = `gen-${room.code.toLowerCase()}-${p.slot}-${round}`;
    const id = crypto.randomBytes(6).toString("hex");
    const siblings = p.characters.filter((ch) => ch.round !== round && ch.name).map((ch) => ch.name!);
    jobs.set(id, { id, room: room.code, playerId: p.id, playerName: p.name, slot: p.slot, round, fighterId, drawingPath, status: "queued", stage: "waiting for the forge", claimedAt: 0, attempts: 0, siblings });
    queue.push(id);
    const ch = p.characters[round - 1];
    ch.status = "queued"; ch.stage = "waiting for the forge"; ch.fighterId = fighterId;
    ch.drawingUrl = `${opts.genBase}/drawings/${fighterId}.png`;
    void d;
  }
  function jobRoom(job: Job): { room: Room; ch: DrawCharacter } | null {
    const room = rooms.get(job.room);
    if (!room || !room.draw) return null;
    const ch = charOf(stateOf(room), job.playerId, job.round);
    return ch ? { room, ch } : null;
  }
  const setStatus = (job: Job, status: CharStatus, stage: string, error: string | null = null): void => {
    const r = jobRoom(job);
    if (!r) return;
    r.ch.status = status; r.ch.stage = stage; r.ch.error = error;
    push(r.room);
    if (status === "ready" || status === "failed") maybeAdvanceReveal(r.room);
  };

  // a job the forge claimed but never finished goes back on the queue once
  setInterval(() => {
    for (const job of jobs.values()) {
      if (job.status === "running" && Date.now() - job.claimedAt > 6 * 60_000) {
        if (job.attempts >= 2) { job.status = "failed"; setStatus(job, "failed", "", "the forge gave up on this one"); }
        else { job.status = "queued"; queue.push(job.id); setStatus(job, "queued", "waiting for the forge again"); }
      }
    }
  }, 15_000).unref();

  const forgeAuth = (req: express.Request, res: express.Response): boolean => {
    const t = req.get("x-forge-token") ?? String(req.query.token ?? "");
    if (!opts.forgeToken || t !== opts.forgeToken) { res.status(401).json({ error: "bad forge token" }); return false; }
    return true;
  };
  api.get("/forge/jobs/next", (req, res) => {
    if (!forgeAuth(req, res)) return;
    while (queue.length) {
      const id = queue.shift()!;
      const job = jobs.get(id);
      if (!job || job.status !== "queued") continue;
      job.status = "running"; job.claimedAt = Date.now(); job.attempts++;
      setStatus(job, "generating", "reading the drawing");
      return res.json({ id: job.id, fighterId: job.fighterId, playerName: job.playerName, round: job.round, siblings: job.siblings, attempts: job.attempts });
    }
    res.status(204).end();
  });
  api.get("/forge/jobs/:id/drawing.png", (req, res) => {
    if (!forgeAuth(req, res)) return;
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).end();
    res.sendFile(job.drawingPath);
  });
  api.post("/forge/jobs/:id/progress", (req, res) => {
    if (!forgeAuth(req, res)) return;
    const job = jobs.get(req.params.id);
    if (!job || job.status !== "running") return res.status(409).json({ error: "job not running" });
    setStatus(job, "generating", String(req.body?.stage ?? "").slice(0, 80));
    res.status(204).end();
  });
  api.post("/forge/jobs/:id/fail", (req, res) => {
    if (!forgeAuth(req, res)) return;
    const job = jobs.get(req.params.id);
    if (!job || job.status !== "running") return res.status(409).json({ error: "job not running" });
    job.status = "failed";
    setStatus(job, "failed", "", String(req.body?.error ?? "the forge failed").slice(0, 300));
    res.status(204).end();
  });
  api.post("/forge/jobs/:id/complete", async (req, res) => {
    if (!forgeAuth(req, res)) return;
    const job = jobs.get(req.params.id);
    if (!job || job.status !== "running") return res.status(409).json({ error: "job not running" });
    const b = req.body ?? {};
    try {
      for (const k of ["name", "tagline", "description", "source"]) if (typeof b[k] !== "string") throw new Error(`${k} must be a string`);
      if (!b.sprite || typeof b.sprite !== "object") throw new Error("sprite missing");
      if (!b.cells || typeof b.cells !== "object") throw new Error("cells missing");
      for (const c of SPRITE_CELLS) if (typeof b.cells[c] !== "string") throw new Error(`cell ${c} missing`);
      const dir = path.join(genDir, job.fighterId);
      fs.mkdirSync(dir, { recursive: true });
      const cells: Record<string, string> = {};
      for (const c of SPRITE_CELLS) { fs.writeFileSync(path.join(dir, `${c}.png`), Buffer.from(b.cells[c], "base64")); cells[c] = `${opts.genBase}/${job.fighterId}/${c}.png`; }
      if (typeof b.sheet === "string") fs.writeFileSync(path.join(dir, "sheet.png"), Buffer.from(b.sheet, "base64"));
      const sprite = { px: Number(b.sprite.px), feetPx: Number(b.sprite.feetPx), heightPx: Number(b.sprite.heightPx), anims: b.sprite.anims && typeof b.sprite.anims === "object" ? b.sprite.anims : {}, cells };
      const bundle = { id: job.fighterId, player: job.playerName, description: b.description, source: b.source, sprite };
      await buildGenerated(bundle); // the forge already validated; this is the server refusing to serve a broken one
      fs.writeFileSync(path.join(dir, "bundle.json"), JSON.stringify(bundle));
      if (b.report !== undefined) fs.writeFileSync(path.join(dir, "report.json"), JSON.stringify(b.report));
      job.status = "done";
      const r = jobRoom(job);
      if (r) {
        r.ch.name = b.name.slice(0, 24); r.ch.tagline = b.tagline.slice(0, 120); r.ch.description = b.description.slice(0, 600);
        r.ch.bundleUrl = `${opts.genBase}/${job.fighterId}/bundle.json`;
        r.ch.sheetUrl = typeof b.sheet === "string" ? `${opts.genBase}/${job.fighterId}/sheet.png` : null;
      }
      setStatus(job, "ready", "");
      res.status(204).end();
    } catch (e) {
      job.status = "failed";
      const error = e instanceof Error ? e.message : String(e);
      setStatus(job, "failed", "", error.slice(0, 300));
      res.status(400).json({ error });
    }
  });
  // generated fighters and the original drawings are public files (ids carry the room code, that's fine for friends)
  api.get("/forge/health", (req, res) => { if (!forgeAuth(req, res)) return; res.json({ ok: true, queued: queue.length, jobs: jobs.size }); });

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
          c.name = String(msg.name ?? "").replace(/[^\w \-.!?]/g, "").slice(0, 14) || c.name;
          let target: Room;
          if (msg.t === "drawCreate") {
            target = { code: makeCode(), members: [], started: false, host: c, seed: 0, config: null };
            const st: DrawState = { phase: "lobby", round: 0, rounds: DRAW_DEFAULTS.rounds, drawSeconds: DRAW_DEFAULTS.drawSeconds, deadline: 0, timer: null, players: new Map(), battles: [], battle: null, note: "", drawRoot: path.join(drawDir, target.code) };
            target.draw = st;
            rooms.set(target.code, target);
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
          const fighterId = `gen-${room.code.toLowerCase()}-${p.slot}-${round}`;
          const drawingPath = path.join(genDir, "drawings", `${fighterId}.png`);
          fs.mkdirSync(path.dirname(drawingPath), { recursive: true });
          fs.writeFileSync(drawingPath, png);
          enqueue(room, p, round, drawingPath);
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
function decodePng(dataUrl: string): Buffer | null {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) return null;
  const buf = Buffer.from(m[1], "base64");
  return buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47 ? buf : null;
}
function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
