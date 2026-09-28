import { packInput, unpackInput, type InputFrame } from "../../../shared/input";
import { site } from "../base";
import { sessionTrace } from "../telemetry/events";
import type { MapDoc } from "../../../shared/maps";

export type Unsubscribe = () => void;
/**
 * What a sender reports alongside its inputs for time sync: its smoothed round trip to the relay in
 * ms, and by slot how many frames it reckons it is ahead of each player. Absent from older clients.
 */
export interface SyncReport { rtt?: number; leads?: number[] }
export type InputsCallback = (slot: number, frame: number, inputs: InputFrame[], report: SyncReport) => void;
export type HashCallback = (slot: number, frame: number, hash: number) => void;

export interface Transport {
  send(frame: number, inputs: InputFrame[], leads: number[]): void;
  onInputs(cb: InputsCallback): Unsubscribe;
  sendHash(frame: number, hash: number): void;
  onHash(cb: HashCallback): Unsubscribe;
  ping(): void;
  rtt(): number;
  close(): void;
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
  | { t: "left"; id: number; slot: number; duringMatch: boolean }
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

export class WebSocketTransport implements Transport {
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

  send(frame: number, inputs: InputFrame[], leads: number[]): void {
    this.sendMessage({ t: "inputs", frame, inputs: inputs.map(packInput), r: Math.round(this.roundTrip), l: leads.map((lead) => Math.round(lead * 10) / 10) });
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

  /** A closed relay is already reported through onClose; a ping after it has nothing to measure. */
  ping(): void {
    if (this.ws.readyState === WebSocket.CLOSING || this.ws.readyState === WebSocket.CLOSED) return;
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
      const report: SyncReport = {
        rtt: typeof message.rtt === "number" ? message.rtt : undefined,
        leads: Array.isArray(message.leads) ? message.leads.map(Number) : undefined,
      };
      for (const listener of this.inputListeners) listener(message.slot | 0, message.frame | 0, inputs, report);
      return;
    }
    if (message.t === "hash") {
      for (const listener of this.hashListeners) listener(message.slot | 0, message.frame | 0, message.hash >>> 0);
      return;
    }
    if (message.t === "pong") {
      const sample = Math.max(0, Date.now() - Number(message.at));
      this.roundTrip = this.roundTrip ? this.roundTrip + (sample - this.roundTrip) * 0.25 : sample;
      return;
    }
    for (const listener of this.lobbyListeners) listener(message as RelayMessage);
  }
}
