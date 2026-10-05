import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { B, cloneInput, type InputFrame } from "../shared/input";
import { hashState, type MatchConfig } from "../shared/sim";
import { RollbackSession } from "../client/src/net/rollback";
import { NetLink, type RelayInputs } from "../client/src/net/link";
import type { PeerMesh } from "../client/src/net/mesh";
import type { HashCallback, InputsCallback, RelayMessage, Unsubscribe } from "../client/src/net/transport";
import { loadAllHouse } from "./house";
import { liveRuns } from "../server/lobby";

/**
 * A room on a simulated network, one tick per sim frame. The relay works like the real one: each player's stream
 * reaches it in order (uplink), it trims frames it decided away, decides silent players away (fills), acknowledges
 * each player's own frames, and every receiver gets one ordered stream from it (downlink). Each pair also has a
 * peer-to-peer link: unordered, each packet `linkLatency` ticks plus jitter, a share of them lost. Every endpoint
 * runs the real NetLink. Member ids are slot + 1.
 */
interface Delivery { at: number; seq: number; run: () => void; hold?: () => boolean }
/** The network's clock in ms: NetLink's stale-ack timer and the session's step timing read performance.now. */
let now = 0;
const FILL_BEHIND = 18;

class Room {
  clock = 0;
  linkLoss = 0;
  /** Links that are down: `a-b` with a < b. */
  down = new Set<string>();
  /** Endpoints that hear nothing (a downlink blackout): link packets to them are lost, the relay's wait (TCP). */
  deaf = new Set<number>();
  /** Endpoints whose uplink is dead: their link packets are lost, their relay stream waits. */
  mute = new Set<number>();
  /** Endpoints whose relay connection alone is stalled (their links still work). */
  relayMute = new Set<number>();
  fills = true;
  private queue: Delivery[] = [];
  private seq = 0;
  private seed: number;
  private upLast = new Map<number, number>();
  private downLast = new Map<number, number>();
  readonly relays: FakeRelay[] = [];
  readonly meshes: FakeMesh[] = [];
  /** The relay's per-slot bookkeeping: newest frame passed on, frames decided away through, what each was told is final. */
  forwarded: number[] = [];
  filled: number[] = [];
  fillRanges: [number, number][][] = [];
  /** Per slot, what each player said it holds of every slot. */
  acks: number[][] = [];
  finalSent: number[] = [];
  gone = new Set<number>();

  constructor(seed: number, public relayLatency: [number, number], public linkLatency: [number, number]) {
    this.seed = seed >>> 0;
  }

  random(): number {
    let x = this.seed;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this.seed = x >>> 0;
    return this.seed / 4294967296;
  }

  between([lo, hi]: [number, number]): number {
    return lo + Math.floor(this.random() * (hi - lo + 1));
  }

  schedule(at: number, run: () => void, hold?: () => boolean): void {
    this.queue.push({ at, seq: this.seq++, run, hold });
  }

  /** A message from `from` reaching the relay: in order, half the relay latency, held while its uplink is dead. */
  up(from: number, run: () => void): void {
    const half: [number, number] = [Math.floor(this.relayLatency[0] / 2), Math.ceil(this.relayLatency[1] / 2)];
    const at = Math.max(this.upLast.get(from) ?? 0, this.clock + this.between(half));
    this.upLast.set(from, at);
    this.schedule(at, run, () => this.mute.has(from) || this.relayMute.has(from));
  }

  /** The relay's one ordered stream to `to`. */
  downTo(to: number, run: () => void): void {
    const half: [number, number] = [Math.floor(this.relayLatency[0] / 2), Math.ceil(this.relayLatency[1] / 2)];
    const at = Math.max(this.downLast.get(to) ?? 0, this.clock + this.between(half));
    this.downLast.set(to, at);
    this.schedule(at, run, () => this.deaf.has(to) || this.relayMute.has(to));
  }

  linked(from: number, to: number, run: () => void): void {
    if (this.random() < this.linkLoss || this.mute.has(from)) return;
    this.schedule(this.clock + this.between(this.linkLatency), () => { if (!this.deaf.has(to)) run(); });
  }

  isDown(a: number, b: number): boolean {
    return this.down.has(`${Math.min(a, b)}-${Math.max(a, b)}`);
  }

  /** The relay, as it handles a player's inputs (see server/lobby.ts). */
  relayInputs(slot: number, frame: number, inputs: InputFrame[], ahead: number[], acks?: number[]): void {
    if (acks) acks.forEach((a, s) => { this.acks[slot][s] = Math.max(this.acks[slot][s] ?? 0, a); });
    const runs = liveRuns(frame, inputs, this.fillRanges[slot]) as { frame: number; inputs: InputFrame[] }[];
    if (runs.length) this.forwarded[slot] = Math.max(this.forwarded[slot], runs[runs.length - 1].frame);
    for (const run of runs) {
      for (const r of this.relays) {
        if (r.slot === slot) continue;
        this.downTo(r.slot, () => { for (const l of r.inputListeners) l(slot, run.frame, run.inputs.map(cloneInput), [...ahead], acks ? [...acks] : undefined); });
      }
    }
    if (this.forwarded[slot] - this.finalSent[slot] >= 6) {
      const final = this.finalSent[slot] = this.forwarded[slot];
      this.downTo(slot, () => { for (const l of this.relays[slot].lobbyListeners) l({ t: "final", frame: final }); });
    }
    this.checkFills();
  }

  checkFills(): void {
    if (!this.fills) return;
    const live = this.relays.filter((r) => !this.gone.has(r.slot)).map((r) => r.slot);
    if (live.length < 2) return;
    const vouched = (s: number) => Math.max(this.forwarded[s], this.filled[s], ...live.map((o) => this.acks[o][s] ?? 0));
    for (const slot of live) {
      const others = live.filter((o) => o !== slot).map(vouched).sort((a, b) => b - a);
      const through = others[Math.min(1, others.length - 1)] - FILL_BEHIND;
      const from = vouched(slot) + 1;
      if (through < from) continue;
      this.filled[slot] = through;
      this.fillRanges[slot].push([from, through]);
      for (const r of this.relays) this.downTo(r.slot, () => { for (const l of r.lobbyListeners) l({ t: "fill", slot, from, through }); });
    }
  }

  frontier(slot: number): number {
    return Math.max(this.forwarded[slot], this.filled[slot]);
  }

  tick(): void {
    this.clock++;
    now = this.clock * (1000 / 60);
    const due = (d: Delivery) => d.at <= this.clock && !d.hold?.();
    const ready = this.queue.filter(due).sort((a, b) => a.at - b.at || a.seq - b.seq);
    this.queue = this.queue.filter((d) => !due(d));
    for (const d of ready) d.run();
  }

  drain(ticks = 40): void {
    for (let i = 0; i < ticks; i++) this.tick();
  }

  endpoint(slot: number, members: number): { link: NetLink; relay: FakeRelay; mesh: FakeMesh } {
    const relay = new FakeRelay(this, slot);
    const mesh = new FakeMesh(this, slot);
    this.relays[slot] = relay;
    this.meshes[slot] = mesh;
    this.forwarded[slot] ??= 0; this.filled[slot] ??= 0; this.finalSent[slot] ??= 0; this.fillRanges[slot] ??= []; this.acks[slot] ??= [];
    const roster = Array.from({ length: members }, (_, s) => ({ id: s + 1, name: `P${s + 1}`, slot: s }));
    return { link: new NetLink(relay as unknown as RelayInputs, mesh as unknown as PeerMesh, roster, slot), relay, mesh };
  }
}

class FakeRelay {
  inputListeners = new Set<InputsCallback>();
  hashListeners = new Set<HashCallback>();
  lobbyListeners = new Set<(m: RelayMessage) => void>();
  constructor(private room: Room, readonly slot: number) {}
  send(frame: number, inputs: InputFrame[], ahead: number[], acks?: number[]): void {
    const copy = inputs.map(cloneInput), a = [...ahead], k = acks ? [...acks] : undefined;
    this.room.up(this.slot, () => this.room.relayInputs(this.slot, frame, copy, a, k));
  }
  onInputs(cb: InputsCallback): Unsubscribe { this.inputListeners.add(cb); return () => this.inputListeners.delete(cb); }
  onLobby(cb: (m: RelayMessage) => void): Unsubscribe { this.lobbyListeners.add(cb); return () => this.lobbyListeners.delete(cb); }
  sendHash(frame: number, hash: number): void {
    this.room.up(this.slot, () => {
      for (const r of this.room.relays) if (r.slot !== this.slot) this.room.downTo(r.slot, () => { for (const l of r.hashListeners) l(this.slot, frame, hash); });
    });
  }
  onHash(cb: HashCallback): Unsubscribe { this.hashListeners.add(cb); return () => this.hashListeners.delete(cb); }
  rtt(): number { return 50; }
}

class FakeMesh {
  listeners = new Set<(id: number, data: ArrayBuffer) => void>();
  constructor(private room: Room, private slot: number) {}
  link(id: number) { return { open: !this.room.isDown(this.slot, id - 1), route: "direct" as const, rtt: 40, heardMsAgo: 0 }; }
  stats() { return null; }
  send(id: number, data: ArrayBuffer): boolean {
    const to = id - 1;
    if (this.room.isDown(this.slot, to)) return false;
    const copy = data.slice(0);
    this.room.linked(this.slot, to, () => { for (const l of this.room.meshes[to]?.listeners ?? []) l(this.slot + 1, copy); });
    return true;
  }
  onPacket(cb: (id: number, data: ArrayBuffer) => void): Unsubscribe { this.listeners.add(cb); return () => this.listeners.delete(cb); }
}

function scriptedInput(slot: number, frame: number): InputFrame {
  const direction = ((Math.floor(frame / (41 + slot * 7)) + slot) & 1) ? 100 : -100;
  let b = 0;
  if (frame % (47 + slot * 5) === 0) b |= B.JUMP;
  if (frame % (31 + slot * 3) < 2) b |= B.ATTACK;
  if (frame % (113 + slot * 11) === 0) b |= B.SPECIAL;
  return { x: direction, y: frame % 89 < 9 ? -100 : 0, cx: 0, cy: 0, b };
}

function makeConfig(players = 2, withCpus = false): MatchConfig {
  const fighters = ["lampjack", "slugbert", "woodstove", "rocket"];
  return {
    stage: "proving",
    seed: 0x51a7e,
    rules: { stocks: 99, time: 0 },
    players: withCpus
      ? [{ fighter: "lampjack" }, { fighter: "slugbert" }, { fighter: "woodstove", cpu: 3 }, { fighter: "rocket", cpu: 4 }]
      : fighters.slice(0, players).map((fighter) => ({ fighter })),
  };
}

interface Peer { session: RollbackSession; link: NetLink; relay: FakeRelay; mesh: FakeMesh }

function room(config: MatchConfig, seed: number, opts: { relay?: [number, number]; link?: [number, number]; loss?: number } = {}): { net: Room; peers: Peer[] } {
  const net = new Room(seed, opts.relay ?? [3, 7], opts.link ?? [2, 6]);
  net.linkLoss = opts.loss ?? 0;
  const humans = config.players.map((p, slot) => (p.cpu ? -1 : slot)).filter((s) => s >= 0);
  const peers = humans.map((slot) => {
    const { link, relay, mesh } = net.endpoint(slot, config.players.length);
    return { session: new RollbackSession({ config, localSlot: slot, transport: link }), link, relay, mesh };
  });
  return { net, peers };
}

/** Each tick: the network delivers, then every active peer takes its input for the frame it's recording. */
function play(net: Room, peers: Peer[], ticks: number, active: (p: Peer, tick: number) => boolean = () => true): void {
  for (let t = 0; t < ticks; t++) {
    net.tick();
    for (const p of peers) if (active(p, t)) p.session.advance(scriptedInput(p.session.localSlot, p.session.clock + p.session.inputDelay + 1));
  }
}

/** Plays until every peer's sim reaches `frame` (clocks stop there), then lets the network settle. */
function playTo(net: Room, peers: Peer[], frame: number, limit = frame * 4): void {
  let ticks = 0;
  while (peers.some((p) => p.session.state.frame < frame) && ticks < limit) {
    net.tick();
    for (const p of peers) if (p.session.clock < frame) p.session.advance(scriptedInput(p.session.localSlot, p.session.clock + p.session.inputDelay + 1));
      else p.session.synchronize();
    ticks++;
  }
  expect(ticks, "ticks to reach the frame").toBeLessThan(limit);
  net.drain();
  for (const p of peers) p.session.synchronize();
}

function sameAt(peers: Peer[], frame: number): void {
  const hashes = peers.map((p) => p.session.stateHashAt(frame));
  expect(hashes[0]).not.toBeNull();
  for (const h of hashes) expect(h).toBe(hashes[0]);
  for (const p of peers) expect(p.session.desync).toBeNull();
}

describe("rollback session over links and the relay", () => {
  beforeAll(async () => {
    await loadAllHouse();
    vi.spyOn(performance, "now").mockImplementation(() => now);
  });
  afterAll(() => vi.restoreAllMocks());

  it("keeps two jittered peers identical for 1800 frames, most inputs arriving over the link", () => {
    const { net, peers } = room(makeConfig(), 0x12345678, { relay: [6, 10], link: [2, 6] });
    playTo(net, peers, 1800);
    sameAt(peers, 1800);
    const path = peers[0].link.pathStats()[1];
    expect(path.framesViaLink).toBeGreaterThan(path.framesViaRelay * 5);
  });

  it("keeps four fighters identical when two slots are CPU", () => {
    const { net, peers } = room(makeConfig(4, true), 0x9abcdef0);
    playTo(net, peers, 1800);
    sameAt(peers, 1800);
  });

  it("stays identical with a third of link packets lost and reordered, four players", () => {
    const { net, peers } = room(makeConfig(4), 0x10551055, { relay: [8, 20], link: [1, 9], loss: 0.33 });
    playTo(net, peers, 1500);
    sameAt(peers, 1500);
    const path = peers[2].link.pathStats()[0];
    expect(path.framesViaLink).toBeGreaterThan(path.framesViaRelay);
  });

  it("carries on over the relay alone when a link is down, and back on the link when it returns", () => {
    const { net, peers } = room(makeConfig(3), 0x11e4, { relay: [5, 9], link: [2, 4] });
    play(net, peers, 300);
    net.down.add("0-1");
    play(net, peers, 400);
    const during = peers[0].link.pathStats()[1];
    net.down.delete("0-1");
    playTo(net, peers, 1200);
    sameAt(peers, 1200);
    const after = peers[0].link.pathStats()[1];
    expect(during.changes).toBe(1);
    expect(after.changes).toBe(2);
    expect(after.framesViaRelay).toBeGreaterThan(300);
  });

  it("a player who hears nothing for two seconds doesn't freeze the others, and catches up after", () => {
    const { net, peers } = room(makeConfig(3), 0xdea5, { relay: [4, 8], link: [2, 5] });
    play(net, peers, 200);
    const [deaf, ...others] = peers;
    const stalls = others.map((p) => p.session.stats.stalls);
    net.deaf.add(0);
    play(net, peers, 120);
    net.deaf.delete(0);
    expect(others.map((p, i) => p.session.stats.stalls - stalls[i])).toEqual([0, 0]);
    expect(deaf.session.stats.stalls).toBeGreaterThan(60);
    play(net, peers, 60);
    expect(deaf.session.clock - deaf.session.state.frame).toBeLessThan(4);
    expect(deaf.session.stats.catchupFrames).toBeGreaterThan(50);
    playTo(net, peers, 900);
    sameAt(peers, 900);
  });

  it("freezes at the prediction window when nothing arrives, then catches up without diverging", () => {
    const { net, peers } = room(makeConfig(), 0xdeadbeef, { relay: [4, 6], link: [2, 4] });
    net.down.add("0-1");
    net.deaf.add(0); net.deaf.add(1);
    play(net, peers, 60);
    for (const p of peers) {
      expect(p.session.clock).toBe(60);
      expect(p.session.state.frame).toBe(p.session.inputDelay + p.session.maxRollback);
      expect(p.session.waiting).toBe(true);
    }
    net.deaf.clear();
    net.down.clear();
    playTo(net, peers, 600);
    sameAt(peers, 600);
  });

  it("two players carry on in step after a third leaves, dropping at the relay's last frame", () => {
    const { net, peers } = room(makeConfig(3), 0x7e57);
    play(net, peers, 300);
    // slot 2 quits: its last relay message goes before its socket closes, then the relay announces the leave
    const [a, b, leaver] = peers;
    play(net, peers, 1, (p) => p === leaver);
    net.drain();
    const frame = net.frontier(2);
    net.gone.add(2);
    a.session.drop(2, frame);
    b.session.drop(2, frame);
    playTo(net, [a, b], 900);
    sameAt([a, b], 900);
    expect(leaver.session.state.frame).toBeLessThan(900);
  });

  it("a client that starts 40 ticks late still catches up", () => {
    const { net, peers } = room(makeConfig(), 0x1badb002);
    play(net, peers, 40, (p) => p.session.localSlot === 0);
    playTo(net, peers, 900, 4000);
    sameAt(peers, 900);
  });

  it("a client running at half speed never deadlocks the other; the fast one slows to match", () => {
    const { net, peers } = room(makeConfig(), 0x5eed5eed);
    const [a, b] = peers;
    let ticks = 0;
    while (b.session.state.frame < 600 && ticks < 4000) {
      play(net, peers, 1, (p, _) => p === a || ticks % 2 === 0);
      ticks++;
    }
    expect(ticks).toBeLessThan(4000);
    expect(a.session.stats.stalls).toBeLessThan(ticks * 0.25);
    expect(a.session.stats.timeSyncSkips).toBeGreaterThan(100);
    expect(b.session.stats.timeSyncSkips).toBe(0);
    expect(Math.abs(a.session.clock - b.session.clock)).toBeLessThan(a.session.maxRollback + a.session.inputDelay + 2);
    net.drain();
    a.session.synchronize(); b.session.synchronize();
    const f = Math.min(a.session.state.frame, b.session.state.frame);
    expect(a.session.stateHashAt(f)).toBe(b.session.stateHashAt(f));
  });

  it("equal clocks over symmetric latency never give up ticks, whatever the latency", () => {
    for (const [min, max] of [[2, 6], [4, 8], [6, 10]] as [number, number][]) {
      const { net, peers } = room(makeConfig(), 0xabc0 + min, { relay: [min + 2, max + 2], link: [min, max] });
      play(net, peers, 1200);
      const [a, b] = peers;
      expect(a.session.stats.timeSyncSkips + b.session.stats.timeSyncSkips, `latency ${min}-${max}`).toBeLessThan(6);
      expect(Math.abs(a.session.clock - b.session.clock)).toBeLessThan(4);
    }
  });

  it("a client that runs slightly slow is matched by the other without either stalling", () => {
    const { net, peers } = room(makeConfig(), 0x600d);
    const [a, b] = peers;
    let ticks = 0;
    // b skips every sixth tick: a 50 Hz laptop against a 60 Hz desktop
    while (b.session.state.frame < 1200 && ticks < 3000) {
      play(net, peers, 1, (p) => p === a || ticks % 6 !== 5);
      ticks++;
    }
    expect(a.session.stats.stalls + b.session.stats.stalls).toBeLessThan(ticks * 0.02);
    expect(b.session.stats.timeSyncSkips).toBe(0);
    expect(a.session.stats.timeSyncSkips).toBeGreaterThan(ticks / 6 * 0.7);
    expect(a.session.stats.timeSyncSkips).toBeLessThan(ticks / 6 * 1.3);
  });

  it("resumes from a handoff even when the swap lost what crossed the relay meanwhile (no links)", () => {
    const config = makeConfig();
    const { net, peers } = room(config, 0x5a4b);
    // the relay stops deciding anyone away once a swap is scheduled
    net.fills = false;
    net.down.add("0-1");
    play(net, peers, 300);
    const swapAt = 330;
    for (const p of peers) p.session.keepFrom = swapAt;
    let handoffs: (ReturnType<RollbackSession["handoff"]>)[] = [null, null];
    let ticks = 0;
    while (handoffs.some((h) => !h) && ticks < 400) {
      play(net, peers, 1, (p) => !handoffs[p.session.localSlot]);
      peers.forEach((p, i) => { if (!handoffs[i]) { p.session.synchronize(); handoffs[i] = p.session.handoff(swapAt); } if (handoffs[i]) p.session.close(); });
      ticks++;
    }
    for (const p of peers) p.link.close();
    // the swap takes a moment: whatever arrives now has no listener
    net.drain(20);
    const resumed: Peer[] = peers.map((p, slot) => {
      const { link, relay, mesh } = net.endpoint(slot, 2);
      return { session: new RollbackSession({ config, localSlot: slot, transport: link, resume: handoffs[slot]! }), link, relay, mesh };
    });
    // one client resumes 30 ticks before the other
    play(net, resumed, 30, (p) => p.session.localSlot === 0);
    playTo(net, resumed, 900, 6000);
    sameAt(resumed, 900);
  });
});

describe("players whose inputs stop reaching the relay", () => {
  beforeAll(async () => {
    await loadAllHouse();
    vi.spyOn(performance, "now").mockImplementation(() => now);
  });
  afterAll(() => vi.restoreAllMocks());

  it("a player whose uplink dies for three seconds is played away; the others never freeze, and he comes back", () => {
    const { net, peers } = room(makeConfig(3), 0xaa11, { relay: [4, 8], link: [2, 5] });
    play(net, peers, 300);
    const [a, b, c] = peers;
    const before = [a, b].map((p) => p.session.stats.stalls);
    net.mute.add(2);
    play(net, peers, 180);
    net.mute.delete(2);
    // the others stall at most while the first fill is on its way
    expect([a, b].map((p, i) => p.session.stats.stalls - before[i]).every((n) => n < 20)).toBe(true);
    expect(a.session.stats.awayFrames[2]).toBeGreaterThan(120);
    play(net, peers, 120);
    expect(c.session.stats.awayFrames[2]).toBe(a.session.stats.awayFrames[2]);
    // back: his own inputs count again
    const filledBefore = a.session.stats.awayFrames[2];
    play(net, peers, 120);
    expect(a.session.stats.awayFrames[2]).toBe(filledBefore);
    playTo(net, peers, 1200);
    sameAt(peers, 1200);
  });

  it("a player whose relay connection alone stalls is vouched for by the others over their links: nobody is played away or freezes", () => {
    const { net, peers } = room(makeConfig(3), 0xbb22, { relay: [6, 10], link: [1, 3] });
    play(net, peers, 300);
    const stalls = peers.map((p) => p.session.stats.stalls);
    net.relayMute.add(1);
    play(net, peers, 180);
    net.relayMute.delete(1);
    expect(peers.map((p) => p.session.stats.awayFrames[1])).toEqual([0, 0, 0]);
    expect(peers[0].session.stats.stalls - stalls[0] + peers[2].session.stats.stalls - stalls[2]).toBe(0);
    playTo(net, peers, 900);
    sameAt(peers, 900);
  });

  it("one on one, the player left alone plays on against a fighter standing still", () => {
    const { net, peers } = room(makeConfig(2), 0xcc33, { relay: [4, 8], link: [2, 5] });
    play(net, peers, 200);
    net.mute.add(1);
    const stalls = peers[0].session.stats.stalls;
    play(net, peers, 240);
    net.mute.delete(1);
    expect(peers[0].session.stats.stalls - stalls).toBeLessThan(20);
    playTo(net, peers, 900);
    sameAt(peers, 900);
  });
});

describe("fuzz", () => {
  beforeAll(async () => {
    await loadAllHouse();
    vi.spyOn(performance, "now").mockImplementation(() => now);
  });
  afterAll(() => vi.restoreAllMocks());

  it("stays identical through random blackouts, relay stalls, dead links and loss", () => {
    let fills = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const players = 2 + (seed % 3);
      const { net, peers } = room(makeConfig(players), 0xf00d + seed * 7919, { relay: [3, 12], link: [1, 8], loss: (seed % 4) * 0.1 });
      for (let t = 0; t < 1500; t++) {
        // every 60 ticks something changes for someone
        if (t % 60 === 0) {
          const who = Math.floor(net.random() * players);
          const what = Math.floor(net.random() * 6);
          net.mute.clear(); net.deaf.clear(); net.relayMute.clear(); net.down.clear();
          if (what === 0) net.mute.add(who);
          if (what === 1) net.deaf.add(who);
          if (what === 2) net.relayMute.add(who);
          if (what === 3) net.down.add(`${Math.min(who, (who + 1) % players)}-${Math.max(who, (who + 1) % players)}`);
        }
        play(net, peers, 1);
      }
      net.mute.clear(); net.deaf.clear(); net.relayMute.clear(); net.down.clear();
      playTo(net, peers, Math.max(...peers.map((p) => p.session.clock)) + 60, 6000);
      const f = Math.min(...peers.map((p) => p.session.state.frame));
      for (const p of peers) expect(p.session.desync, `seed ${seed}`).toBeNull();
      fills += peers[0].session.stats.fills;
      const hashes = peers.map((p) => p.session.stateHashAt(f));
      for (const h of hashes) expect(h, `seed ${seed} frame ${f}`).toBe(hashes[0]);
    }
    expect(fills).toBeGreaterThan(0);
  });
});

describe("eliminated fighters", () => {
  beforeAll(loadAllHouse);
  it("an eliminated fighter's input changes nothing", async () => {
    const { createMatch, step, cloneState } = await import("../shared/sim");
    const config = makeConfig(3);
    const a = createMatch(config);
    a.fighters[2].stocks = 0;
    a.fighters[2].action = "dead";
    const b = cloneState(a);
    for (let f = 1; f <= 300; f++) {
      step(a, [scriptedInput(0, f), scriptedInput(1, f), scriptedInput(2, f)]);
      step(b, [scriptedInput(0, f), scriptedInput(1, f), { x: 0, y: 0, cx: 0, cy: 0, b: 0 }]);
    }
    expect(hashState(a)).toBe(hashState(b));
    expect(JSON.stringify(a.inputs)).toBe(JSON.stringify(b.inputs));
    expect(JSON.stringify(a.fighters[2])).toBe(JSON.stringify(b.fighters[2]));
  });
});
