import { describe, expect, it } from "vitest";
import { B, cloneInput, type InputFrame } from "../shared/input";
import { hashState, type MatchConfig } from "../shared/sim";
import { RollbackSession } from "../client/src/net/rollback";
import type { HashCallback, InputsCallback, Transport, Unsubscribe } from "../client/src/net/transport";

interface Packet {
  at: number;
  to: number;
  kind: "inputs" | "hash";
  slot: number;
  frame: number;
  inputs?: InputFrame[];
  hash?: number;
}

class SeededNetwork {
  clock = 0;
  paused = false;
  private seed: number;
  private packets: Packet[] = [];
  private endpoints: MemoryTransport[] = [];

  constructor(seed: number, private minLatency: number, private maxLatency: number) {
    this.seed = seed >>> 0;
  }

  endpoint(slot: number): MemoryTransport {
    const endpoint = new MemoryTransport(this, this.endpoints.length, slot);
    this.endpoints.push(endpoint);
    return endpoint;
  }

  send(from: number, packet: Omit<Packet, "at" | "to">): void {
    for (let to = 0; to < this.endpoints.length; to++) {
      if (to === from) continue;
      const spread = this.maxLatency - this.minLatency + 1;
      const at = this.clock + this.minLatency + this.randomInt(spread);
      this.packets.push({ ...packet, at, to });
    }
  }

  tick(): void {
    this.clock++;
    if (this.paused) return;
    const ready = this.packets.filter((packet) => packet.at <= this.clock);
    this.packets = this.packets.filter((packet) => packet.at > this.clock);
    for (const packet of ready) this.endpoints[packet.to].deliver(packet);
  }

  release(): void {
    this.paused = false;
    for (const packet of this.packets) packet.at = this.clock;
    this.tick();
  }

  private randomInt(limit: number): number {
    let x = this.seed;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.seed = x >>> 0;
    return this.seed % limit;
  }
}

class MemoryTransport implements Transport {
  private inputListeners = new Set<InputsCallback>();
  private hashListeners = new Set<HashCallback>();

  constructor(private network: SeededNetwork, private endpointId: number, private slot: number) {}

  send(frame: number, inputs: InputFrame[]): void {
    this.network.send(this.endpointId, { kind: "inputs", slot: this.slot, frame, inputs: inputs.map(cloneInput) });
  }

  onInputs(cb: InputsCallback): Unsubscribe {
    this.inputListeners.add(cb);
    return () => this.inputListeners.delete(cb);
  }

  sendHash(frame: number, hash: number): void {
    this.network.send(this.endpointId, { kind: "hash", slot: this.slot, frame, hash });
  }

  onHash(cb: HashCallback): Unsubscribe {
    this.hashListeners.add(cb);
    return () => this.hashListeners.delete(cb);
  }

  ping(): void {}
  rtt(): number { return 4 * 1000 / 60; }
  close(): void {}

  deliver(packet: Packet): void {
    if (packet.kind === "inputs") {
      for (const listener of this.inputListeners) listener(packet.slot, packet.frame, packet.inputs!.map(cloneInput));
    } else {
      for (const listener of this.hashListeners) listener(packet.slot, packet.frame, packet.hash!);
    }
  }
}

function scriptedInput(slot: number, frame: number): InputFrame {
  const direction = ((Math.floor(frame / (41 + slot * 7)) + slot) & 1) ? 100 : -100;
  let b = 0;
  if (frame % (47 + slot * 5) === 0) b |= B.JUMP;
  if (frame % (31 + slot * 3) < 2) b |= B.ATTACK;
  if (frame % (113 + slot * 11) === 0) b |= B.SPECIAL;
  return { x: direction, y: frame % 89 < 9 ? -100 : 0, cx: 0, cy: 0, b };
}

function makeConfig(withCpus = false): MatchConfig {
  return {
    stage: "proving",
    seed: 0x51a7e,
    rules: { stocks: 99, time: 0 },
    players: withCpus
      ? [{ fighter: "sable" }, { fighter: "wick" }, { fighter: "brick", cpu: 6 }, { fighter: "pilot", cpu: 8 }]
      : [{ fighter: "sable" }, { fighter: "wick" }],
  };
}

function runPair(config: MatchConfig, seed: number, frames: number): { a: RollbackSession; b: RollbackSession; network: SeededNetwork } {
  const network = new SeededNetwork(seed, 2, 6);
  const ta = network.endpoint(0);
  const tb = network.endpoint(1);
  const a = new RollbackSession({ config, localSlot: 0, transport: ta });
  const b = new RollbackSession({ config, localSlot: 1, transport: tb });
  let ticks = 0;
  while ((a.state.frame < frames || b.state.frame < frames) && ticks < frames * 4) {
    network.tick();
    if (a.state.frame < frames) a.advance(scriptedInput(0, a.state.frame + a.inputDelay + 1));
    if (b.state.frame < frames) b.advance(scriptedInput(1, b.state.frame + b.inputDelay + 1));
    ticks++;
  }
  expect(ticks).toBeLessThan(frames * 4);
  for (let i = 0; i < 12; i++) network.tick();
  a.synchronize();
  b.synchronize();
  return { a, b, network };
}

describe("rollback session", () => {
  it("keeps two jittered peers identical for 1800 frames", () => {
    const { a, b } = runPair(makeConfig(), 0x12345678, 1800);
    expect(a.state.frame).toBe(1800);
    expect(b.state.frame).toBe(1800);
    expect(hashState(a.state)).toBe(hashState(b.state));
    expect(a.rollbackFramesPerSecond() + b.rollbackFramesPerSecond()).toBeGreaterThan(0);
  });

  it("keeps four fighters identical when two slots are CPU", () => {
    const { a, b } = runPair(makeConfig(true), 0x9abcdef0, 1800);
    expect(a.state.frame).toBe(1800);
    expect(b.state.frame).toBe(1800);
    expect(hashState(a.state)).toBe(hashState(b.state));
  });

  it("stalls at the rollback cap and resumes without diverging", () => {
    const config = makeConfig();
    const network = new SeededNetwork(0xdeadbeef, 2, 6);
    const a = new RollbackSession({ config, localSlot: 0, transport: network.endpoint(0) });
    const b = new RollbackSession({ config, localSlot: 1, transport: network.endpoint(1) });
    network.paused = true;
    for (let i = 0; i < 30; i++) {
      a.advance(scriptedInput(0, a.state.frame + a.inputDelay + 1));
      b.advance(scriptedInput(1, b.state.frame + b.inputDelay + 1));
      network.tick();
    }
    expect(a.state.frame).toBe(a.inputDelay + a.maxRollback);
    expect(b.state.frame).toBe(b.inputDelay + b.maxRollback);
    expect(a.waiting).toBe(true);
    expect(b.waiting).toBe(true);

    network.release();
    let ticks = 0;
    while ((a.state.frame < 240 || b.state.frame < 240) && ticks < 1000) {
      network.tick();
      if (a.state.frame < 240) a.advance(scriptedInput(0, a.state.frame + a.inputDelay + 1));
      if (b.state.frame < 240) b.advance(scriptedInput(1, b.state.frame + b.inputDelay + 1));
      ticks++;
    }
    for (let i = 0; i < 12; i++) network.tick();
    a.synchronize();
    b.synchronize();
    expect(a.state.frame).toBe(240);
    expect(b.state.frame).toBe(240);
    expect(hashState(a.state)).toBe(hashState(b.state));
  });
});
