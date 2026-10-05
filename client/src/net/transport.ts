import { packInput, unpackInput, type InputFrame } from "../../../shared/input";
import { site } from "../base";
import { sessionTrace } from "../telemetry/events";
import type { MapDoc } from "../../../shared/maps";

export type Unsubscribe = () => void;
/**
 * A run of one slot's inputs ending at `frame`. `ahead`: the sender's averaged frame lead over each slot, for time
 * sync (see RollbackSession); `acks`: per slot, the frame through which the sender holds every input. Either is
 * absent from clients that don't send it. Returns how many of the frames were new to the session.
 */
export type InputsCallback = (slot: number, frame: number, inputs: InputFrame[], ahead?: number[], acks?: number[]) => number | void;
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
  /** ICE servers for peer-to-peer links, and the links' signaling (see PeerMesh). */
  | { t: "ice"; servers: unknown[] }
  | { t: "rtc"; from: number; gen: number }
  /** The room's game bundle changed; the host answers with gameAt. */
  | { t: "game"; hash: string }
  /** Everyone swaps to the bundle at this sim frame (or now, outside a match). */
  | { t: "gameAt"; hash: string; frame: number }
  /** Public rooms with a free slot, for JOIN ROOM. */
  | { t: "rooms"; rooms: PublicRoom[] }
  | { t: "error"; error: string };

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
  private ws: WebSocket;
  private queued: string[] = [];
  private inputListeners = new Set<InputsCallback>();
  private hashListeners = new Set<HashCallback>();
  private lobbyListeners = new Set<(message: RelayMessage) => void>();
  private closeListeners = new Set<() => void>();
  private roundTrip = 0;

  constructor(url = relayWebSocketUrl()) {
    this.ws = new WebSocket(url);
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener("open", () => {
        for (const message of this.queued) this.ws.send(message);
        this.queued.length = 0;
        resolve();
      }, { once: true });
      this.ws.addEventListener("error", () => reject(new Error(`websocket connection failed: ${url}`)), { once: true });
    });
    this.ws.addEventListener("message", (event) => this.receive(String(event.data)));
    this.ws.addEventListener("close", () => {
      for (const listener of this.closeListeners) listener();
    });
  }

  send(frame: number, inputs: InputFrame[], ahead: number[], acks?: number[]): void {
    this.sendMessage({ t: "inputs", frame, inputs: inputs.map(packInput), ahead, ...(acks ? { acks } : {}) });
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
    this.queued.length = 0;
    this.ws.close();
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
    throw new Error("cannot send on a closed websocket");
  }

  private receive(encoded: string): void {
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
}
