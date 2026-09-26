import type { DrawClientMessage, DrawRoomState, DrawServerMessage } from "../../../../shared/draw";
import { WebSocketTransport, type RelayMessage } from "../../net/transport";
import { phaseMs } from "./logic";

const PASSWORD_KEY = "sketchbattle.drawPassword";
export type StartMessage = Extract<DrawServerMessage, { t: "start" }>;

/** One connection to the relay for a whole DRAW BATTLE: auth, the room snapshot, errors, the battle start. */
export class DrawSession {
  readonly transport = new WebSocketTransport();
  id = 0;
  room: DrawRoomState | null = null;
  auth: "none" | "pending" | "ok" | "bad" = "none";
  authError = "";
  error: { text: string; at: number } | null = null;
  closed = "";
  pendingStart: StartMessage | null = null;
  /** Local epoch ms the current timed phase ends: measured from when its snapshot arrived, so a skewed device clock doesn't matter. */
  deadline = 0;
  private password = "";

  constructor() {
    this.transport.onLobby((message) => this.receive(message as RelayMessage | DrawServerMessage));
    this.transport.onClose(() => { this.closed ||= "connection lost"; });
    this.transport.ready.catch((error) => {
      console.error(error);
      this.closed = "could not connect";
    });
    const saved = localStorage.getItem(PASSWORD_KEY);
    if (saved) this.authenticate(saved);
  }

  send(message: DrawClientMessage): void {
    if (this.closed) throw new Error(`draw session is closed (${this.closed})`);
    this.transport.sendLobby(message);
  }

  authenticate(password: string): void {
    this.password = password;
    this.auth = "pending";
    this.send({ t: "drawAuth", password });
  }

  leave(): void {
    if (this.room && !this.closed) this.send({ t: "drawLeave" });
    this.room = null;
    this.deadline = 0;
  }

  close(): void {
    this.closed ||= "closed";
    this.transport.close();
  }

  get me() {
    return this.room?.players.find((p) => p.id === this.id) ?? null;
  }

  private receive(message: RelayMessage | DrawServerMessage): void {
    if (message.t === "hello") this.id = message.id;
    else if (message.t === "drawAuth") {
      this.auth = message.ok ? "ok" : "bad";
      this.authError = message.error ?? "";
      if (message.ok) localStorage.setItem(PASSWORD_KEY, this.password);
      else localStorage.removeItem(PASSWORD_KEY);
    } else if (message.t === "draw") {
      const previous = this.room;
      this.room = message.room;
      if (!message.room.deadline) this.deadline = 0;
      else if (message.room.deadline !== previous?.deadline) this.deadline = Date.now() + phaseMs(message.room);
    } else if (message.t === "start") {
      this.pendingStart = message as StartMessage;
    } else if (message.t === "error") {
      console.error(`draw server error: ${message.error}`);
      this.error = { text: message.error, at: performance.now() };
    }
  }
}
