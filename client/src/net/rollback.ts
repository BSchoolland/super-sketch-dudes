import { cpuInput } from "../../../shared/cpu";
import { EMPTY_INPUT, cloneInput, inputEquals, type InputFrame } from "../../../shared/input";
import { cloneState, createMatch, hashState, step, type MatchConfig } from "../../../shared/sim";
import type { GameEvent, State } from "../../../shared/types";
import type { Transport, Unsubscribe } from "./transport";

export interface DesyncInfo {
  frame: number;
  localHash: number;
  remoteHash: number;
  remoteSlot: number;
}

export interface RollbackOptions {
  config: MatchConfig;
  localSlot: number;
  transport: Transport;
  inputDelay?: number;
  maxRollback?: number;
  onDesync?: (info: DesyncInfo) => void;
}

export class RollbackSession {
  state: State;
  readonly localSlot: number;
  readonly inputDelay: number;
  readonly maxRollback: number;
  readonly transport: Transport;
  waiting = false;
  desync: DesyncInfo | null = null;
  confirmedThrough = 0;

  private humanSlots: number[];
  private cpuLevels: number[];
  private realInputs: Map<number, InputFrame>[];
  private usedInputs = new Map<number, InputFrame[]>();
  private snapshots = new Map<number, State>();
  private pendingRollback: number | null = null;
  private events: GameEvent[] = [];
  private rollbackSamples: { at: number; frames: number }[] = [];
  private localHashes = new Map<number, number>();
  private remoteHashes = new Map<number, Map<number, number>>();
  private nextHashFrame = 30;
  private remoteNewest = new Map<number, number>();
  private slowTick = 0;
  private unsubscribers: Unsubscribe[];
  private onDesync?: (info: DesyncInfo) => void;

  constructor(options: RollbackOptions) {
    this.localSlot = options.localSlot;
    this.inputDelay = Math.max(1, Math.min(6, options.inputDelay ?? 2));
    this.maxRollback = options.maxRollback ?? 8;
    this.transport = options.transport;
    this.onDesync = options.onDesync;
    this.state = createMatch(options.config);
    this.cpuLevels = options.config.players.map((player) => player.cpu ?? 0);
    this.humanSlots = this.cpuLevels.map((level, slot) => level > 0 ? -1 : slot).filter((slot) => slot >= 0);
    if (!this.humanSlots.includes(this.localSlot)) throw new Error(`local slot ${this.localSlot} is not a human player`);
    this.realInputs = options.config.players.map(() => new Map<number, InputFrame>());
    for (const slot of this.humanSlots) {
      for (let frame = 1; frame <= this.inputDelay; frame++) this.realInputs[slot].set(frame, cloneInput(EMPTY_INPUT));
    }
    this.confirmedThrough = this.inputDelay;
    this.snapshots.set(0, cloneState(this.state));
    this.unsubscribers = [
      this.transport.onInputs((slot, frame, inputs) => this.receiveInputs(slot, frame, inputs)),
      this.transport.onHash((slot, frame, hash) => this.receiveHash(slot, frame, hash)),
    ];
  }

  advance(localInput: InputFrame): boolean {
    if (this.desync) return false;
    const targetFrame = this.state.frame + this.inputDelay + 1;
    if (!this.realInputs[this.localSlot].has(targetFrame)) {
      const input = cloneInput(localInput);
      input.b &= ~64;
      this.realInputs[this.localSlot].set(targetFrame, input);
    }
    this.sendLocalWindow(targetFrame);
    this.synchronize();

    const nextFrame = this.state.frame + 1;
    if (nextFrame - this.confirmedThrough > this.maxRollback) {
      this.waiting = true;
      return false;
    }
    // time sync: when we are ahead of a remote, give up every other tick so they can catch up instead of us stalling later
    const lead = this.frameLead();
    if (lead > 2 && (this.slowTick++ & 1) === 0) { this.waiting = false; return false; }

    this.waiting = false;
    const inputs = this.inputsForFrame(nextFrame);
    step(this.state, inputs);
    this.usedInputs.set(nextFrame, inputs.map(cloneInput));
    // Re-simulated frames never enter this queue, so effects and audio fire at most once.
    this.events.push(...this.state.events);
    this.state.events.length = 0;
    this.snapshots.set(nextFrame, cloneState(this.state));
    this.pruneHistory();
    this.sendConfirmedHashes();
    return true;
  }

  takeEvents(): GameEvent[] {
    const events = this.events;
    this.events = [];
    return events;
  }

  synchronize(): void {
    if (this.desync) return;
    this.applyRollback();
    this.advanceConfirmation();
    this.sendConfirmedHashes();
  }

  /** The newest state built only from real inputs; null while a pending rollback still has to rewrite it. */
  confirmedState(): State | null {
    const frame = Math.min(this.confirmedThrough, this.state.frame);
    if (this.pendingRollback !== null && this.pendingRollback <= frame) return null;
    return this.snapshots.get(frame) ?? null;
  }

  stateHashAt(frame: number): number | null {
    const snapshot = this.snapshots.get(frame);
    return snapshot ? hashState(snapshot) : null;
  }

  rollbackFramesPerSecond(): number {
    const cutoff = Date.now() - 1000;
    this.rollbackSamples = this.rollbackSamples.filter((sample) => sample.at >= cutoff);
    return this.rollbackSamples.reduce((sum, sample) => sum + sample.frames, 0);
  }

  connectionQuality(): number {
    if (this.desync) return 0;
    if (this.waiting) return 0.15;
    const latency = Math.max(0, 1 - this.transport.rtt() / 300);
    const rollback = Math.max(0, 1 - this.rollbackFramesPerSecond() / 60);
    return Math.min(latency, rollback);
  }

  close(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers.length = 0;
  }

  /** How many frames our sim is ahead of the slowest remote's, estimated from the newest input frame each remote has sent. */
  frameLead(): number {
    let lead = 0;
    for (const [, newest] of this.remoteNewest) lead = Math.max(lead, this.state.frame - (newest - this.inputDelay));
    return lead;
  }

  private receiveInputs(slot: number, newestFrame: number, inputs: InputFrame[]): void {
    if (!this.humanSlots.includes(slot) || slot === this.localSlot) return;
    this.remoteNewest.set(slot, Math.max(this.remoteNewest.get(slot) ?? 0, newestFrame));
    const firstFrame = newestFrame - inputs.length + 1;
    for (let i = 0; i < inputs.length; i++) {
      const frame = firstFrame + i;
      if (frame <= 0) continue;
      const input = cloneInput(inputs[i]);
      input.b &= ~64;
      this.realInputs[slot].set(frame, input);
      const used = this.usedInputs.get(frame)?.[slot];
      if (used && !inputEquals(used, input)) this.pendingRollback = Math.min(this.pendingRollback ?? frame, frame);
    }
    this.advanceConfirmation();
  }

  private receiveHash(slot: number, frame: number, hash: number): void {
    let hashes = this.remoteHashes.get(frame);
    if (!hashes) {
      hashes = new Map<number, number>();
      this.remoteHashes.set(frame, hashes);
    }
    hashes.set(slot, hash >>> 0);
    this.compareHashes(frame);
  }

  private applyRollback(): void {
    const firstFrame = this.pendingRollback;
    if (firstFrame === null || firstFrame > this.state.frame) return;
    const depth = this.state.frame - firstFrame + 1;
    if (depth > this.maxRollback) {
      this.waiting = true;
      return;
    }
    const snapshot = this.snapshots.get(firstFrame - 1);
    if (!snapshot) throw new Error(`missing rollback snapshot for frame ${firstFrame - 1}`);
    const head = this.state.frame;
    this.state = cloneState(snapshot);
    for (let frame = firstFrame; frame <= head; frame++) {
      const inputs = this.inputsForFrame(frame);
      step(this.state, inputs);
      this.state.events.length = 0;
      this.usedInputs.set(frame, inputs.map(cloneInput));
      this.snapshots.set(frame, cloneState(this.state));
    }
    this.rollbackSamples.push({ at: Date.now(), frames: depth });
    this.pendingRollback = null;
  }

  private inputsForFrame(frame: number): InputFrame[] {
    return this.cpuLevels.map((level, slot) => {
      if (level > 0) return cpuInput(this.state, slot, level);
      const real = this.realInputs[slot].get(frame);
      if (real) return cloneInput(real);
      return this.predictedInput(slot, frame);
    });
  }

  private predictedInput(slot: number, frame: number): InputFrame {
    for (let previous = frame - 1; previous >= 1; previous--) {
      const input = this.realInputs[slot].get(previous);
      if (input) return cloneInput(input);
    }
    return cloneInput(EMPTY_INPUT);
  }

  private sendLocalWindow(newestFrame: number): void {
    // resend everything a remote might still be missing: from just before the slowest remote's sim frame, capped at 120 frames
    let firstFrame = newestFrame - 7;
    for (const slot of this.humanSlots) {
      if (slot === this.localSlot) continue;
      const newest = this.remoteNewest.get(slot);
      firstFrame = Math.min(firstFrame, newest === undefined ? 1 : newest - this.inputDelay - 4);
    }
    firstFrame = Math.max(1, firstFrame, newestFrame - 120);
    const inputs: InputFrame[] = [];
    for (let frame = firstFrame; frame <= newestFrame; frame++) {
      const input = this.realInputs[this.localSlot].get(frame);
      if (!input) throw new Error(`missing local input for frame ${frame}`);
      inputs.push(input);
    }
    this.transport.send(newestFrame, inputs);
  }

  private advanceConfirmation(): void {
    while (this.humanSlots.every((slot) => this.realInputs[slot].has(this.confirmedThrough + 1))) this.confirmedThrough++;
  }

  private sendConfirmedHashes(): void {
    while (this.nextHashFrame <= Math.min(this.confirmedThrough, this.state.frame)) {
      const snapshot = this.snapshots.get(this.nextHashFrame);
      if (!snapshot) throw new Error(`missing confirmed snapshot for hash frame ${this.nextHashFrame}`);
      const hash = hashState(snapshot);
      this.localHashes.set(this.nextHashFrame, hash);
      this.transport.sendHash(this.nextHashFrame, hash);
      this.compareHashes(this.nextHashFrame);
      this.nextHashFrame += 30;
    }
  }

  private compareHashes(frame: number): void {
    const localHash = this.localHashes.get(frame);
    if (localHash === undefined || this.desync) return;
    const hashes = this.remoteHashes.get(frame);
    if (!hashes) return;
    for (const [remoteSlot, remoteHash] of hashes) {
      if (remoteHash === localHash) continue;
      this.desync = { frame, localHash, remoteHash, remoteSlot };
      this.waiting = true;
      console.error(`SKETCH BATTLE DESYNC frame ${frame}: local ${localHash} remote ${remoteHash} (slot ${remoteSlot})`);
      this.onDesync?.(this.desync);
      return;
    }
  }

  private pruneHistory(): void {
    const oldest = this.state.frame - this.maxRollback;
    for (const frame of this.snapshots.keys()) if (frame < oldest) this.snapshots.delete(frame);
    for (const frame of this.usedInputs.keys()) if (frame < oldest + 1) this.usedInputs.delete(frame);
    this.realInputs.forEach((inputs, slot) => {
      const keep = slot === this.localSlot ? this.state.frame - 150 : oldest;
      for (const frame of inputs.keys()) if (frame < keep) inputs.delete(frame);
    });
    for (const hashesFrame of this.remoteHashes.keys()) if (hashesFrame < oldest - 30) this.remoteHashes.delete(hashesFrame);
  }
}
