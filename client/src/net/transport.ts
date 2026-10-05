import { packInput, unpackInput, type InputFrame } from "../../../shared/input";
import { site } from "../base";
import { sessionTrace } from "../telemetry/events";
import type { MapDoc } from "../../../shared/maps";
import { CLOSE_CANNOT_RESUME, CLOSE_SUPERSEDED, RESUME_GRACE_MS } from "../../../shared/resume";

/** Mid-match, own inputs the relay hasn't confirmed (`final`) for this long mean the link is stuck: a fresh socket takes over. */
const STUCK_MS = 600;
/** While no attempt has connected, another starts this often: TCP backs its retries off, a fresh socket doesn't. */
const RETRY_MS = 1000;
const MAX_CONNECTING = 4;
/** An attempt that connected but got no answer to its resume this long after starting is dropped. */
const RESUME_WAIT_MS = 3000;

export type Unsubscribe = () => void;
/**
 * A run of one slot's inputs ending at `frame`. `ahead`: the sender's averaged frame lead over each slot, for time
 * sync (see RollbackSession); `acks`: per slot, the frame through which the sender holds every input. Either is
 * absent from clients that don't send it. Returns how many of the frames were new to the session.
 */
export type InputsCallback = (slot: number, frame: number, inputs: InputFrame[], ahead?: number[], acks?: number[], final?: boolean) => number | void;
/**
 * The relay's word on the match, final everywhere: `fill`, the frames it decided a player away (their inputs had
 * stopped reaching it); `final`, the frame through which it has every input of ours. Inputs that arrive over the
 * relay are final too (`final` on InputsCallback); inputs over a peer-to-peer link are provisional until then.
 */
export interface RelayVerdicts {
  fill(slot: number, from: number, through: number): void;
  final(frame: number): void;
}
export type HashCallback = (slot: number, frame: number, hash: number) => void;

/** What a rollback session hands its transport every tick: its own inputs, and what it knows of everyone's. */
export interface LocalInputs {
  slot: number;
  /** Newest frame with a local input. */
  newest: number;
  /** Oldest frame whose local input is still held. */
  oldest: number;
  input(frame: number): InputFrame;
  ahead: number[];
  /** Per slot, the frame through which this session holds every input (its own slot: `newest`). */
  acks: number[];
  /** Per remote slot still playing: the frame through which it has acknowledged every input of ours. */
  peerAcks: Map<number, number>;
}

/** How a rollback session reaches the other players. */
export interface Transport {
  sendInputs(local: LocalInputs): void;
  onInputs(cb: InputsCallback): Unsubscribe;
  sendHash(frame: number, hash: number): void;
  onHash(cb: HashCallback): Unsubscribe;
  onVerdicts(cb: RelayVerdicts): Unsubscribe;
  /** Round trip to the players, for the connection indicator. */
  rtt(): number;
}

export interface RoomMember {
  id: number;
  name: string;
  slot: number;
  /** "" until the member first picks. */
  fighter: string;
  bundleUrl: string;
  ready: boolean;
}

export interface PublicRoom { code: string; host: string; members: string[] }

export type RelayMessage =
  | { t: "hello"; id: number }
  /** `trace` is the room's wide-event trace; absent from servers older than wide events. */
  | { t: "room"; code: string; trace?: string; host: number; started: boolean; public: boolean; picking: { stage: string; stocks: number; time: number; map?: MapDoc } | null; members: RoomMember[]; game: string | null }
  | { t: "start"; seed: number; config: unknown; members: Pick<RoomMember, "id" | "name" | "slot">[] }
  /** `frame`: the leaver's last input frame at the relay; every client has every input up to it, and drops the slot after it. */
  | { t: "left"; id: number; slot: number; duringMatch: boolean; frame: number }
  /** Every member's match screen is up: the countdown starts. */
  | { t: "go" }
  /** See RelayVerdicts. */
  | { t: "fill"; slot: number; from: number; through: number }
  | { t: "final"; frame: number }
  /** ICE servers for peer-to-peer links, and the links' signaling (see PeerMesh). */
  | { t: "ice"; servers: unknown[] }
  | { t: "rtc"; from: number; gen: number }
  /** The room's game bundle changed; the host answers with gameAt. */
  | { t: "game"; hash: string }
  /** Everyone swaps to the bundle at this sim frame (or now, outside a match). */
  | { t: "gameAt"; hash: string; frame: number }
  /** Public rooms with a free slot, for JOIN ROOM. */
  | { t: "rooms"; rooms: PublicRoom[] }
  | { t: "error"; error: string }
  /** A fresh socket took this client over mid-match; the relay has every input of ours through `ack`. */
  | { t: "resumed"; ack: number };

function removeListener<T>(listeners: Set<T>, listener: T): Unsubscribe {
  return () => listeners.delete(listener);
}

export function relayWebSocketUrl(): string {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}${site.base}ws?trace=${sessionTrace()}`;
}

/**
 * The relay connection: the lobby, hashes, and a reliable copy of every input. Its methods keep the shape older
 * bundles call (a bundle swap hands this object across builds both ways), so `send` and `onInputs` stay as they were.
 */
export class WebSocketTransport {
  readonly ready: Promise<void>;
  /** Mid-match: how often a fresh socket took over, how many were tried, and the longest the link was stuck first. */
  readonly linkStats = { resumes: 0, attempts: 0, longestStuckMs: 0 };
  private ws: WebSocket;
  private queued: string[] = [];
  private inputListeners = new Set<InputsCallback>();
  private hashListeners = new Set<HashCallback>();
  private lobbyListeners = new Set<(message: RelayMessage) => void>();
  private closeListeners = new Set<() => void>();
  private resumeListeners = new Set<(ack: number) => void>();
  private roundTrip = 0;
  private id = 0;
  private token = "";
  /** Set while a match runs: per slot, the frame through which this client holds the relay's final inputs. */
  private match: (() => number[]) | null = null;
  /** Own input sends the relay hasn't confirmed yet: [frame, sent at]. */
  private unconfirmed: [number, number][] = [];
  /** Fresh sockets still connecting, and the one that connected and asked to resume (only ever one). */
  private connecting: { ws: WebSocket; at: number }[] = [];
  private resuming: { ws: WebSocket; at: number } | null = null;
  private stuckAt: number | null = null;
  private closed = false;

  constructor(private url = relayWebSocketUrl()) {
    this.ws = new WebSocket(url);
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener("open", () => {
        for (const message of this.queued) this.ws.send(message);
        this.queued.length = 0;
        resolve();
      }, { once: true });
      this.ws.addEventListener("error", () => reject(new Error(`websocket connection failed: ${url}`)), { once: true });
    });
    this.listen(this.ws);
  }

  send(frame: number, inputs: InputFrame[], ahead: number[], acks?: number[]): void {
    if (this.match) this.unconfirmed.push([frame, performance.now()]);
    this.sendMessage({ t: "inputs", frame, inputs: inputs.map(packInput), ahead, ...(acks ? { acks } : {}) });
  }

  /**
   * Mid-match the link heals itself: TCP backs off for seconds after a wifi dropout, so a stuck link is replaced by a
   * fresh socket that resumes this client (the relay resends what it missed) instead of being waited out. `final`
   * says what the relay must resend; null ends the watch.
   */
  watchMatch(final: (() => number[]) | null): void {
    this.match = final;
    this.unconfirmed.length = 0;
    if (final) Object.assign(this.linkStats, { resumes: 0, attempts: 0, longestStuckMs: 0 });
  }

  /** A fresh socket took over: every own input after `ack` has to go to the relay again. */
  onResumed(cb: (ack: number) => void): Unsubscribe {
    this.resumeListeners.add(cb);
    return removeListener(this.resumeListeners, cb);
  }

  /** Every tick mid-match: a stuck or broken link gets fresh sockets, one more each RETRY_MS until one connects. */
  watch(now = performance.now()): void {
    if (!this.match || this.closed || !this.id) return;
    const oldest = this.unconfirmed.length ? now - this.unconfirmed[0][1] : 0;
    if (this.stuckAt === null) {
      if (oldest < STUCK_MS && this.ws.readyState === WebSocket.OPEN) return;
      this.stuckAt = now - Math.max(0, oldest);
    }
    if (now - this.stuckAt > RESUME_GRACE_MS) { this.fail(); return; }
    if (this.resuming) {
      if (now - this.resuming.at < RESUME_WAIT_MS) return;
      this.resuming.ws.close(1000);
      this.resuming = null;
    }
    const newest = this.connecting.reduce((at, a) => Math.max(at, a.at), -Infinity);
    if (now - newest < RETRY_MS) return;
    // a long dropout piles attempts up: the oldest goes (its SYNs are the furthest backed off)
    if (this.connecting.length >= MAX_CONNECTING) this.connecting.shift()?.ws.close(1000);
    const ws = new WebSocket(this.url);
    const attempt = { ws, at: now };
    this.linkStats.attempts++;
    this.connecting.push(attempt);
    ws.addEventListener("open", () => {
      this.connecting = this.connecting.filter((a) => a !== attempt);
      if (this.resuming || this.closed || !this.match) { ws.close(1000); return; }
      for (const a of this.connecting) a.ws.close(1000);
      this.connecting = [];
      this.resuming = { ws, at: performance.now() };
      ws.send(JSON.stringify({ t: "resume", id: this.id, token: this.token, final: this.match() }));
    }, { once: true });
    this.listen(ws);
  }

  onInputs(cb: InputsCallback): Unsubscribe {
    this.inputListeners.add(cb);
    return removeListener(this.inputListeners, cb);
  }

  sendHash(frame: number, hash: number): void {
    this.sendMessage({ t: "hash", frame, hash: hash >>> 0 });
  }

  onHash(cb: HashCallback): Unsubscribe {
    this.hashListeners.add(cb);
    return removeListener(this.hashListeners, cb);
  }

  ping(): void {
    this.sendMessage({ t: "ping", at: Date.now() });
  }

  rtt(): number {
    return this.roundTrip;
  }

  sendLobby(message: Record<string, unknown>): void {
    this.sendMessage(message);
  }

  onLobby(cb: (message: RelayMessage) => void): Unsubscribe {
    this.lobbyListeners.add(cb);
    return removeListener(this.lobbyListeners, cb);
  }

  onClose(cb: () => void): Unsubscribe {
    this.closeListeners.add(cb);
    return removeListener(this.closeListeners, cb);
  }

  close(): void {
    this.closed = true;
    this.queued.length = 0;
    this.dropAttempts();
    this.ws.close();
  }

  private dropAttempts(): void {
    for (const a of this.connecting) a.ws.close(1000);
    this.connecting = [];
    this.resuming?.ws.close(1000);
    this.resuming = null;
  }

  private fail(): void {
    if (this.closed) return;
    this.closed = true;
    this.dropAttempts();
    for (const listener of this.closeListeners) listener();
  }

  private listen(ws: WebSocket): void {
    ws.addEventListener("message", (event) => this.receive(ws, String(event.data)));
    ws.addEventListener("close", (event) => {
      this.connecting = this.connecting.filter((a) => a.ws !== ws);
      if (this.resuming?.ws === ws) {
        this.resuming = null;
        if (event.code === CLOSE_CANNOT_RESUME) { console.error("the relay can no longer catch this client up"); this.fail(); }
        return;
      }
      if (ws !== this.ws || this.closed || event.code === CLOSE_SUPERSEDED) return;
      // mid-match a broken socket is replaced (see watch); the relay's own verdicts and a clean close end it
      if (this.match && event.code !== 1000 && event.code !== 4001) { this.stuckAt ??= performance.now(); return; }
      this.closed = true;
      for (const listener of this.closeListeners) listener();
    });
  }

  private sendMessage(message: Record<string, unknown>): void {
    const encoded = JSON.stringify(message);
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(encoded);
      return;
    }
    if (this.ws.readyState === WebSocket.CONNECTING) {
      this.queued.push(encoded);
      return;
    }
    // a broken link mid-match: inputs go again after the resume; hashes and pings are only missed
    if (this.match && !this.closed) return;
    throw new Error("cannot send on a closed websocket");
  }

  private receive(ws: WebSocket, encoded: string): void {
    let message: any;
    try {
      message = JSON.parse(encoded);
    } catch (error) {
      console.error("invalid websocket message", error);
      return;
    }
    if (!message || typeof message.t !== "string") {
      console.error("invalid websocket message shape", message);
      return;
    }
    if (ws !== this.ws) {
      // a fresh socket: its own hello (it's about to become this client), then the relay's answer to the resume
      if (message.t === "resumed") this.resumed(ws, message.ack | 0);
      else if (message.t === "error") { console.error(`resuming the relay link failed: ${message.error}`); this.fail(); }
      else if (message.t !== "hello") console.error(`a ${message.t} message on a socket that hasn't resumed`);
      return;
    }
    if (message.t === "hello") { this.id = message.id | 0; this.token = String(message.token ?? ""); }
    if (message.t === "final") this.confirmed(message.frame | 0);
    if (message.t === "inputs") {
      if (!Array.isArray(message.inputs)) {
        console.error("invalid input relay message", message);
        return;
      }
      const inputs = message.inputs.map((input: number[]) => unpackInput(input));
      const ahead = Array.isArray(message.ahead) ? message.ahead.map(Number) : undefined;
      const acks = Array.isArray(message.acks) ? message.acks.map((a: unknown) => Number(a) | 0) : undefined;
      for (const listener of this.inputListeners) listener(message.slot | 0, message.frame | 0, inputs, ahead, acks);
      return;
    }
    if (message.t === "hash") {
      for (const listener of this.hashListeners) listener(message.slot | 0, message.frame | 0, message.hash >>> 0);
      return;
    }
    if (message.t === "pong") {
      this.roundTrip = Math.max(0, Date.now() - Number(message.at));
      return;
    }
    for (const listener of this.lobbyListeners) listener(message as RelayMessage);
  }

  private confirmed(frame: number): void {
    while (this.unconfirmed.length && this.unconfirmed[0][0] <= frame) this.unconfirmed.shift();
  }

  private resumed(ws: WebSocket, ack: number): void {
    const old = this.ws;
    this.ws = ws;
    if (this.resuming?.ws === ws) this.resuming = null;
    old.close(1000);
    const now = performance.now();
    this.linkStats.resumes++;
    if (this.stuckAt !== null) this.linkStats.longestStuckMs = Math.max(this.linkStats.longestStuckMs, Math.round(now - this.stuckAt));
    this.stuckAt = null;
    this.unconfirmed.length = 0;
    for (const listener of this.resumeListeners) listener(ack);
  }
}
