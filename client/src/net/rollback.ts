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
  /** The most frames the sim runs ahead of the inputs it has (the prediction window's ceiling; see `window`). */
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
/** A remote not heard from for this many ticks has no clock to sync to: its samples are dropped until it's back. */
const SYNC_STALE_TICKS = 20;
/**
 * The prediction window: how far the sim may run past the newest frame it has every input for. A full-depth
 * rollback re-simulates the whole window in one tick, so the window is what RESIM_BUDGET_MS of measured step time
 * buys on this machine, between MIN_WINDOW and the session's ceiling.
 */
const MAX_WINDOW = 30;
const MIN_WINDOW = 8;
const RESIM_BUDGET_MS = 6;
/** Step timings before this many are JIT warm-up and don't count. */
const COST_WARMUP = 120;
/** Local inputs kept for resends, at least: a remote that acknowledged nothing for longer than this has been dropped. */
const LOCAL_HISTORY = 150;

export class RollbackSession {
  state: State;
  readonly localSlot: number;
  readonly inputDelay: number;
  /** The prediction window's ceiling, and the snapshots kept for rollback. */
  readonly maxRollback: number;
  readonly transport: Transport;
  /** True while the sim is behind the match clock and can't step: frozen (WAITING). */
  waiting = false;
  desync: DesyncInfo | null = null;
  confirmedThrough = 0;
  /**
   * The match clock: ticks of real time since the match started, less time sync's skips. The local input for
   * clock + inputDelay is taken and sent every tick whatever the sim is doing, so a client that is frozen waiting
   * on one player keeps feeding everyone else. The sim follows the clock and catches up after a stall.
   */
  clock = 0;
  /**
   * Counted for the match's wide event: `stalls` are ticks frozen waiting on remote inputs; `catchupFrames` frames
   * stepped beyond one a tick to get back to the clock after one (fast-forward); `maxBehind` the furthest the sim
   * fell behind the clock; `window` the prediction window now and `minWindow` its lowest; `stepUs` the measured cost
   * of one sim step plus its snapshot.
   */
  readonly stats = { rollbacks: 0, resimFrames: 0, maxDepth: 0, tooDeep: 0, stalls: 0, timeSyncSkips: 0, catchupFrames: 0, maxBehind: 0, window: 0, minWindow: 0, stepUs: 0 };

  private humanSlots: number[];
  private cpuLevels: number[];
  private realInputs: Map<number, InputFrame>[];
  /** Per slot, the frame through which every input is in hand: sent to the others as acknowledgements. */
  private held: number[];
  /** Per remote slot still playing, the frame through which it holds every input of ours. */
  private peerAcks = new Map<number, number>();
  private localOldest = 1;
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
  private ticks = 0;
  /** Per remote slot, the tick its newest input frame last moved forward. */
  private heardAt = new Map<number, number>();
  private stepCostMs = 0;
  private costSamples = 0;
  private window: number;
  /** Snapshots from this frame on are kept whatever the rollback window, so a bundle swap can hand one over. */
  keepFrom: number | null = null;
  private unsubscribers: Unsubscribe[];
  private onDesync?: (info: DesyncInfo) => void;

  constructor(options: RollbackOptions) {
    this.localSlot = options.localSlot;
    this.inputDelay = Math.max(1, Math.min(6, options.inputDelay ?? 2));
    this.maxRollback = options.maxRollback ?? MAX_WINDOW;
    this.window = this.maxRollback;
    this.stats.window = this.stats.minWindow = this.window;
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
    this.held = this.cpuLevels.map((level) => level > 0 ? 0 : this.inputDelay);
    for (const slot of this.humanSlots) if (slot !== this.localSlot) this.peerAcks.set(slot, this.inputDelay);
    this.confirmedThrough = this.inputDelay;
    this.snapshots.set(0, cloneState(this.state));
    if (options.resume) this.resume(options.resume);
    this.unsubscribers = [
      this.transport.onInputs((slot, frame, inputs, ahead, acks) => this.receiveInputs(slot, frame, inputs, ahead, acks)),
      this.transport.onHash((slot, frame, hash) => this.receiveHash(slot, frame, hash)),
    ];
  }

  /**
   * One tick of the match clock: takes the local input, sends, applies whatever arrived, and steps the sim toward
   * the clock. True when the sim stepped (one frame, or several catching up).
   */
  advance(localInput: InputFrame): boolean {
    if (this.desync) return false;
    this.ticks++;
    if (this.timeSyncSkip()) this.stats.timeSyncSkips++;
    else {
      this.clock++;
      const target = this.clock + this.inputDelay;
      if (!this.realInputs[this.localSlot].has(target)) {
        const input = cloneInput(localInput);
        input.b &= ~64;
        this.realInputs[this.localSlot].set(target, input);
        this.held[this.localSlot] = Math.max(this.held[this.localSlot], target);
      }
    }
    this.sampleAhead();
    this.sendLocal();
    this.synchronize();
    return this.stepTowardClock();
  }

  /** As many frames as the clock is ahead, within the window: several a tick after a stall, so the sim catches up quickly. */
  private stepTowardClock(): boolean {
    const behind = this.clock - this.state.frame;
    if (behind <= 0) { this.waiting = false; return false; }
    const most = Math.min(behind, 8, 1 + Math.ceil((behind - 1) / 4));
    let steps = 0;
    while (steps < most && this.state.frame + 1 - this.confirmedThrough <= this.window) {
      this.stepOnce();
      steps++;
    }
    this.waiting = steps === 0;
    if (this.waiting) this.stats.stalls++;
    this.stats.catchupFrames += Math.max(0, steps - 1);
    this.stats.maxBehind = Math.max(this.stats.maxBehind, this.clock - this.state.frame);
    if (steps) {
      this.pruneHistory();
      this.sendConfirmedHashes();
    }
    return steps > 0;
  }

  private stepOnce(): void {
    const t0 = performance.now();
    const nextFrame = this.state.frame + 1;
    const inputs = this.inputsForFrame(nextFrame);
    step(this.state, inputs);
    this.usedInputs.set(nextFrame, inputs.map(cloneInput));
    // Re-simulated frames never enter this queue, so effects and audio fire at most once.
    this.events.push(...this.state.events);
    this.state.events.length = 0;
    this.snapshots.set(nextFrame, cloneState(this.state));
    this.measure(performance.now() - t0);
  }

  /** One step plus its snapshot, timed: the window is what the re-simulation budget buys at this cost. */
  private measure(ms: number): void {
    if (++this.costSamples <= COST_WARMUP) return;
    this.stepCostMs = this.costSamples === COST_WARMUP + 1 ? ms : this.stepCostMs + (ms - this.stepCostMs) * 0.02;
    this.window = Math.max(MIN_WINDOW, Math.min(this.maxRollback, Math.floor(RESIM_BUDGET_MS / Math.max(this.stepCostMs, 0.001))));
    this.stats.window = this.window;
    this.stats.minWindow = Math.min(this.stats.minWindow, this.window);
    this.stats.stepUs = Math.round(this.stepCostMs * 1000);
  }

  private resume(h: SessionHandoff): void {
    this.state = cloneState(h.state);
    if (this.state.frame !== h.frame) throw new Error(`handoff state is at frame ${this.state.frame}, not ${h.frame}`);
    this.snapshots.clear();
    this.snapshots.set(h.frame, cloneState(this.state));
    this.realInputs.forEach((inputs) => inputs.clear());
    h.realInputs.forEach((list, slot) => { for (const [frame, input] of list) this.realInputs[slot].set(frame, cloneInput(input)); });
    this.remoteNewest = new Map(h.remoteNewest);
    this.clock = h.frame;
    // everyone confirmed through the handoff frame, so everyone holds every input up to it
    for (const slot of this.humanSlots) {
      let held = h.frame;
      while (this.realInputs[slot].has(held + 1)) held++;
      this.held[slot] = held;
      if (slot !== this.localSlot) this.peerAcks.set(slot, h.frame);
    }
    this.localOldest = Math.min(h.frame + 1, ...this.realInputs[this.localSlot].keys());
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

  /** How many frames our clock is ahead of the slowest remote's, estimated from the newest input frame each remote has sent. */
  frameLead(): number {
    let lead = 0;
    for (const [, newest] of this.remoteNewest) lead = Math.max(lead, this.clock - (newest - this.inputDelay));
    return lead;
  }

  /**
   * Time sync, GGPO's way, on the match clocks. Every client measures how far ahead of each remote it looks: its clock
   * minus the remote's clock as of the remote's newest input. That includes the one-way latency, so it is never zero on its own; the
   * remote's measurement of us includes the same latency, and half the difference of the two is the real clock lead.
   * Equal clocks over any latency give zero and nobody slows down; a client that is genuinely ahead gives up ticks
   * in proportion, at most every other one, and the slower client never does.
   */
  private sampleAhead(): void {
    for (const slot of this.humanSlots) {
      if (slot === this.localSlot || this.gone.has(slot)) continue;
      const newest = this.remoteNewest.get(slot);
      if (newest === undefined) continue;
      // a remote gone quiet (our downlink or their uplink) isn't behind: its old frames would read as a lead and slow us for nothing
      if (this.ticks - (this.heardAt.get(slot) ?? 0) > SYNC_STALE_TICKS) { this.aheadSamples.delete(slot); continue; }
      const remoteClock = newest - this.inputDelay;
      let samples = this.aheadSamples.get(slot);
      if (!samples) { samples = []; this.aheadSamples.set(slot, samples); }
      samples.push(this.clock - remoteClock);
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
   * A remote player left for good. `frame` is the relay's last input frame from them: every client has every input
   * up to it (the relay delivers them before the leave) and plays empty inputs after the later of it and what it
   * holds itself. Clients can differ there, but a leaver mid-match is out of stocks (the sim ignores an eliminated
   * fighter's input) or the match is over (and hashes stop at the end), so the difference never shows.
   */
  drop(slot: number, frame: number): void {
    if (slot === this.localSlot || !this.humanSlots.includes(slot) || this.gone.has(slot)) return;
    const last = Math.max(frame, this.held[slot]);
    this.gone.set(slot, last);
    for (const f of this.realInputs[slot].keys()) if (f > last) this.realInputs[slot].delete(f);
    this.remoteNewest.delete(slot);
    this.remoteAhead.delete(slot);
    this.aheadSamples.delete(slot);
    this.peerAcks.delete(slot);
    for (const [f, used] of this.usedInputs) {
      if (f > last && !inputEquals(used[slot], EMPTY_INPUT)) this.pendingRollback = Math.min(this.pendingRollback ?? f, f);
    }
    this.advanceConfirmation();
  }

  /** Stores a run of a remote's inputs ending at `newestFrame`; returns how many frames were new. */
  private receiveInputs(slot: number, newestFrame: number, inputs: InputFrame[], ahead?: number[], acks?: number[]): number {
    if (!this.humanSlots.includes(slot) || slot === this.localSlot || this.gone.has(slot)) return 0;
    if (newestFrame > (this.remoteNewest.get(slot) ?? 0)) { this.remoteNewest.set(slot, newestFrame); this.heardAt.set(slot, this.ticks); }
    if (ahead && Number.isFinite(ahead[this.localSlot])) this.remoteAhead.set(slot, ahead[this.localSlot]);
    const ack = acks?.[this.localSlot];
    if (ack !== undefined && Number.isFinite(ack)) this.peerAcks.set(slot, Math.max(this.peerAcks.get(slot) ?? 0, ack));
    const firstFrame = newestFrame - inputs.length + 1;
    let fresh = 0;
    for (let i = 0; i < inputs.length; i++) {
      const frame = firstFrame + i;
      // everything up to `held` is in hand or already applied and pruned
      if (frame <= this.held[slot] || this.realInputs[slot].has(frame)) continue;
      const input = cloneInput(inputs[i]);
      input.b &= ~64;
      this.realInputs[slot].set(frame, input);
      fresh++;
      const used = this.usedInputs.get(frame)?.[slot];
      if (used && !inputEquals(used, input)) this.pendingRollback = Math.min(this.pendingRollback ?? frame, frame);
    }
    if (!fresh) return 0;
    while (this.realInputs[slot].has(this.held[slot] + 1)) this.held[slot]++;
    this.advanceConfirmation();
    return fresh;
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
    for (let previous = frame - 1; previous >= Math.max(1, this.held[slot]); previous--) {
      const input = this.realInputs[slot].get(previous);
      if (input) return cloneInput(input);
    }
    return cloneInput(EMPTY_INPUT);
  }

  /** Hands the transport our inputs and acknowledgements; it sends each player what they haven't acknowledged. */
  private sendLocal(): void {
    const own = this.realInputs[this.localSlot];
    const newest = this.held[this.localSlot];
    this.transport.sendInputs({
      slot: this.localSlot,
      newest,
      oldest: this.localOldest,
      input: (frame) => {
        const input = own.get(frame);
        if (!input) throw new Error(`missing local input for frame ${frame} (held ${this.localOldest}-${newest})`);
        return input;
      },
      ahead: this.aheadOf(),
      acks: this.held.map((held, slot) => (this.gone.has(slot) ? 0 : held)),
      peerAcks: this.peerAcks,
    });
  }

  private advanceConfirmation(): void {
    const has = (slot: number, frame: number) => frame > (this.gone.get(slot) ?? Infinity) || this.realInputs[slot].has(frame);
    while (this.humanSlots.every((slot) => has(slot, this.confirmedThrough + 1))) this.confirmedThrough++;
  }

  private sendConfirmedHashes(): void {
    while (this.nextHashFrame <= Math.min(this.confirmedThrough, this.state.frame)) {
      const snapshot = this.snapshots.get(this.nextHashFrame);
      if (!snapshot) throw new Error(`missing confirmed snapshot for hash frame ${this.nextHashFrame}`);
      // hashes stop with the match: a player leaving the result screen drops at a frame the clients needn't agree on
      if (snapshot.ended) return;
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
    // our own inputs stay until every remote has them (and long enough back for a handoff's resends)
    let localKeep = this.state.frame - LOCAL_HISTORY;
    for (const ack of this.peerAcks.values()) localKeep = Math.min(localKeep, ack + 1);
    this.realInputs.forEach((inputs, slot) => {
      const keep = slot === this.localSlot ? localKeep : oldest;
      for (const frame of inputs.keys()) if (frame < keep) inputs.delete(frame);
    });
    this.localOldest = Math.max(this.localOldest, Math.min(localKeep, this.held[this.localSlot]));
    for (const hashesFrame of this.remoteHashes.keys()) if (hashesFrame < oldest - 30) this.remoteHashes.delete(hashesFrame);
  }
}
