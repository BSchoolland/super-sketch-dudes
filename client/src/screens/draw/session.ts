import type { DrawClientMessage, DrawRoomState, DrawServerMessage } from "../../../../shared/draw";
import { WebSocketTransport, type RelayMessage } from "../../net/transport";
import { phaseMs } from "./logic";
import { matchTrace, type WideEvent } from "../../../../shared/wide";
import { clientEvent, finishEvent } from "../../telemetry/events";

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
  /** This client's wide event for the room it's in. */
  private event: WideEvent | null = null;

  constructor() {
    this.transport.onLobby((message) => this.receive(message as RelayMessage | DrawServerMessage));
    this.transport.onClose(() => { this.closed ||= "connection lost"; this.endEvent(this.closed); });
    this.transport.ready.catch((error) => {
      console.error(error);
      this.closed = "could not connect";
    });
    const saved = localStorage.getItem(PASSWORD_KEY);
    if (saved) this.authenticate(saved);
  }

  send(message: DrawClientMessage): void {
    if (this.closed) throw new Error(`draw session is closed (${this.closed})`);
    if (message.t === "drawSubmit" && this.event) this.push("submits", { round: message.round, bytes: message.png.length });
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
    this.endEvent("left");
  }

  close(): void {
    this.closed ||= "closed";
    this.endEvent(this.closed);
    this.transport.close();
  }

  private push(key: string, value: unknown): void {
    const list = (this.event!.business[key] ??= []) as unknown[];
    if (list.length < 60) list.push(value);
  }

  private endEvent(exit: string): void {
    if (this.event) finishEvent(this.event, exit);
    this.event = null;
  }

  /** Follows the room into this client's event: phases, its characters, the battles (each its own match event). */
  private track(room: DrawRoomState, previous: DrawRoomState | null): void {
    if (this.event && previous?.code !== room.code) this.endEvent("changed rooms");
    if (!this.event) this.event = clientEvent("draw", room.trace ?? `r-${room.code}`).set("room", { code: room.code, trace: room.trace ?? null });
    if (previous?.phase !== room.phase || previous?.round !== room.round) this.push("phases", { phase: room.phase, round: room.round, at: Date.now() - this.event.t0 });
    if (room.battle && room.battle.index !== previous?.battle?.index) this.push("battles", matchTrace(room.code, room.battle.seed));
    const me = room.players.find((p) => p.id === this.id);
    if (me) this.event.set("mine", me.characters.map((c) => ({ round: c.round, status: c.status, name: c.name, error: c.error })));
    if (room.phase === "over") this.event.set("result", { message: room.note });
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
      this.track(message.room, previous);
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
