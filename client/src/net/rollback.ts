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
  /** Continue a match another bundle was running: its confirmed state and every real input after it. */
  resume?: SessionHandoff;
}

/** Everything a session needs to carry on in another game bundle. Plain data apart from the state. */
export interface SessionHandoff {
  frame: number;
  state: State;
  /** Per slot: [frame, input] for every real input after `frame`; the local slot also carries the recent past, which resends draw on. */
  realInputs: [number, InputFrame][][];
  remoteNewest: [number, number][];
}

/** Time sync: samples averaged per remote, the lead below which nothing is done (network jitter), and how many
 * frames of lead make up one skipped tick per tick (the loop gain; the measurement lags about half a window). */
const AHEAD_WINDOW = 12;
const SYNC_DEAD_ZONE = 1.5;
const SYNC_GAIN = 12;

export class RollbackSession {
  state: State;
  readonly localSlot: number;
  readonly inputDelay: number;
  readonly maxRollback: number;
  readonly transport: Transport;
  waiting = false;
  desync: DesyncInfo | null = null;
  confirmedThrough = 0;
  /** Counted for the match's wide event: `stalls` are ticks spent waiting on remote inputs. */
  readonly stats = { rollbacks: 0, resimFrames: 0, maxDepth: 0, tooDeep: 0, stalls: 0, timeSyncSkips: 0 };

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
  /** Remote players who left mid-match: their slot plays empty inputs after this frame. */
  private gone = new Map<number, number>();
  /** Time sync: how far ahead of each remote we look (recent samples) and what each remote last reported about us. */
  private aheadSamples = new Map<number, number[]>();
  private remoteAhead = new Map<number, number>();
  private skipDebt = 0;
  private skippedLast = false;
  /** Snapshots from this frame on are kept whatever the rollback window, so a bundle swap can hand one over. */
  keepFrom: number | null = null;
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
    if (options.resume) this.resume(options.resume);
    this.unsubscribers = [
      this.transport.onInputs((slot, frame, inputs, ahead) => this.receiveInputs(slot, frame, inputs, ahead)),
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
    this.sampleAhead();
    this.sendLocalWindow(targetFrame);
    this.synchronize();

    const nextFrame = this.state.frame + 1;
    if (nextFrame - this.confirmedThrough > this.maxRollback) {
      this.waiting = true;
      this.stats.stalls++;
      return false;
    }
    if (this.timeSyncSkip()) { this.waiting = false; this.stats.timeSyncSkips++; return false; }

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

  private resume(h: SessionHandoff): void {
    this.state = cloneState(h.state);
    if (this.state.frame !== h.frame) throw new Error(`handoff state is at frame ${this.state.frame}, not ${h.frame}`);
    this.snapshots.clear();
    this.snapshots.set(h.frame, cloneState(this.state));
    this.realInputs.forEach((inputs) => inputs.clear());
    h.realInputs.forEach((list, slot) => { for (const [frame, input] of list) this.realInputs[slot].set(frame, cloneInput(input)); });
    this.remoteNewest = new Map(h.remoteNewest);
    this.confirmedThrough = h.frame;
    this.advanceConfirmation();
    // both sides must hash the same frames after the swap
    this.nextHashFrame = h.frame - (h.frame % 30) + 30;
  }

  /**
   * The match as of `frame`, for another bundle to continue: requires every input through `frame`
   * to be real and applied (call synchronize first). Null until that holds.
   */
  handoff(frame: number): SessionHandoff | null {
    if (this.desync) return null;
    if (this.confirmedThrough < frame || this.state.frame < frame) return null;
    if (this.pendingRollback !== null && this.pendingRollback <= frame) return null;
    const snapshot = this.snapshots.get(frame);
    if (!snapshot) throw new Error(`no snapshot for handoff frame ${frame}; keepFrom was ${this.keepFrom}`);
    return {
      frame,
      state: cloneState(snapshot),
      realInputs: this.realInputs.map((inputs, slot) => {
        const from = slot === this.localSlot ? frame - 150 : frame;
        return [...inputs].filter(([f]) => f > from).sort((a, b) => a[0] - b[0]).map(([f, i]) => [f, cloneInput(i)] as [number, InputFrame]);
      }),
      remoteNewest: [...this.remoteNewest],
    };
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

  /**
   * Time sync, GGPO's way. Every client measures how far ahead of each remote it looks: its frame minus the remote's
   * frame as of the remote's newest input. That includes the one-way latency, so it is never zero on its own; the
   * remote's measurement of us includes the same latency, and half the difference of the two is the real clock lead.
   * Equal clocks over any latency give zero and nobody slows down; a client that is genuinely ahead gives up ticks
   * in proportion, at most every other one, and the slower client never does.
   */
  private sampleAhead(): void {
    for (const slot of this.humanSlots) {
      if (slot === this.localSlot || this.gone.has(slot)) continue;
      const newest = this.remoteNewest.get(slot);
      if (newest === undefined) continue;
      const remoteFrame = newest - this.inputDelay - 1;
      let samples = this.aheadSamples.get(slot);
      if (!samples) { samples = []; this.aheadSamples.set(slot, samples); }
      samples.push(this.state.frame - remoteFrame);
      if (samples.length > AHEAD_WINDOW) samples.shift();
    }
  }

  /** Our averaged lead over each slot, sent with every input frame; 0 for ourselves, CPUs and slots we've not heard from. */
  aheadOf(): number[] {
    return this.cpuLevels.map((_, slot) => {
      const samples = this.aheadSamples.get(slot);
      if (!samples?.length) return 0;
      return Math.round((samples.reduce((sum, s) => sum + s, 0) / samples.length) * 10) / 10;
    });
  }

  /** The clock lead over the remote furthest behind us, in frames; 0 until both sides have measured. */
  clockLead(): number {
    let lead = 0;
    const mine = this.aheadOf();
    for (const [slot, theirs] of this.remoteAhead) {
      if (this.gone.has(slot) || !this.aheadSamples.get(slot)?.length) continue;
      lead = Math.max(lead, (mine[slot] - theirs) / 2);
    }
    return lead;
  }

  /** Human slots whose input for the next unconfirmed frame hasn't arrived: who a WAITING stall is waiting on. */
  waitingOn(): number[] {
    const frame = this.confirmedThrough + 1;
    return this.humanSlots.filter((slot) => slot !== this.localSlot && !this.gone.has(slot) && !this.realInputs[slot].has(frame));
  }

  private timeSyncSkip(): boolean {
    if (this.skippedLast) { this.skippedLast = false; return false; }
    const lead = this.clockLead();
    if (lead > SYNC_DEAD_ZONE) this.skipDebt += lead / SYNC_GAIN;
    else this.skipDebt = 0;
    if (this.skipDebt < 1) return false;
    this.skipDebt -= 1;
    this.skippedLast = true;
    return true;
  }

  /**
   * A remote player left for good. The relay delivers their inputs to everyone in the same order
   * before it announces the leave, so every client fills empty inputs from the same frame on.
   */
  drop(slot: number): void {
    if (slot === this.localSlot || !this.humanSlots.includes(slot) || this.gone.has(slot)) return;
    const last = this.remoteNewest.get(slot) ?? this.inputDelay;
    this.gone.set(slot, last);
    this.remoteNewest.delete(slot);
    this.remoteAhead.delete(slot);
    this.aheadSamples.delete(slot);
    for (const [frame, used] of this.usedInputs) {
      if (frame > last && !inputEquals(used[slot], EMPTY_INPUT)) this.pendingRollback = Math.min(this.pendingRollback ?? frame, frame);
    }
    this.advanceConfirmation();
  }

  private receiveInputs(slot: number, newestFrame: number, inputs: InputFrame[], ahead?: number[]): void {
    if (!this.humanSlots.includes(slot) || slot === this.localSlot) return;
    this.remoteNewest.set(slot, Math.max(this.remoteNewest.get(slot) ?? 0, newestFrame));
    if (ahead && Number.isFinite(ahead[this.localSlot])) this.remoteAhead.set(slot, ahead[this.localSlot]);
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
      this.stats.tooDeep++;
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
    this.stats.rollbacks++;
    this.stats.resimFrames += depth;
    this.stats.maxDepth = Math.max(this.stats.maxDepth, depth);
    this.pendingRollback = null;
  }

  private inputsForFrame(frame: number): InputFrame[] {
    return this.cpuLevels.map((level, slot) => {
      if (level > 0) return cpuInput(this.state, slot, level);
      if (frame > (this.gone.get(slot) ?? Infinity)) return cloneInput(EMPTY_INPUT);
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
      if (slot === this.localSlot || this.gone.has(slot)) continue;
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
    this.transport.send(newestFrame, inputs, this.aheadOf());
  }

  private advanceConfirmation(): void {
    const has = (slot: number, frame: number) => frame > (this.gone.get(slot) ?? Infinity) || this.realInputs[slot].has(frame);
    while (this.humanSlots.every((slot) => has(slot, this.confirmedThrough + 1))) this.confirmedThrough++;
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
      console.error(`SUPER SKETCH DUDES DESYNC frame ${frame}: local ${localHash} remote ${remoteHash} (slot ${remoteSlot})`);
      this.onDesync?.(this.desync);
      return;
    }
  }

  private pruneHistory(): void {
    const oldest = this.keepFrom === null ? this.state.frame - this.maxRollback : Math.min(this.keepFrom, this.state.frame - this.maxRollback);
    for (const frame of this.snapshots.keys()) if (frame < oldest) this.snapshots.delete(frame);
    for (const frame of this.usedInputs.keys()) if (frame < oldest + 1) this.usedInputs.delete(frame);
    this.realInputs.forEach((inputs, slot) => {
      const keep = slot === this.localSlot ? this.state.frame - 150 : oldest;
      for (const frame of inputs.keys()) if (frame < keep) inputs.delete(frame);
    });
    for (const hashesFrame of this.remoteHashes.keys()) if (hashesFrame < oldest - 30) this.remoteHashes.delete(hashesFrame);
  }
}
