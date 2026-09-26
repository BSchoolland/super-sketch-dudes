import type { FighterId, StageId } from "../../../shared/types";
import { roster } from "../../../shared/fighters/index";
import { stages } from "../../../shared/stages/index";
import type { MatchConfig } from "../../../shared/sim";
import { VIEW_W } from "../render/camera";
import { drawBanner } from "../render/hud";
import type { DeviceId, MenuInput } from "../input/devices";
import { logClient } from "../telemetry";
import { RollbackMatch } from "../net/match";
import { RollbackSession } from "../net/rollback";
import type { RelayMessage, RoomMember, Unsubscribe, WebSocketTransport } from "../net/transport";
import { VersusScreen } from "./versus";
import { label, type Screen, INK } from "./ui";

export function startConfig(value: unknown, seed: number): { match: MatchConfig; inputDelay: number } {
  if (!value || typeof value !== "object") throw new Error("online start missing config");
  const raw = value as Record<string, unknown>;
  const stage = String(raw.stage ?? "") as StageId;
  if (!stages[stage]) throw new Error(`online start has unknown stage ${stage}`);
  if (!Array.isArray(raw.players) || raw.players.length < 2 || raw.players.length > 4) throw new Error("online start has invalid players");
  const players = raw.players.map((player) => {
    const fighter = String((player as Record<string, unknown>).fighter ?? "") as FighterId;
    if (!roster[fighter]) throw new Error(`online start has unknown fighter ${fighter}`);
    return { fighter };
  });
  if (!raw.rules || typeof raw.rules !== "object") throw new Error("online start has invalid rules");
  const rules = raw.rules as MatchConfig["rules"];
  const inputDelay = Math.max(1, Math.min(6, Number(raw.inputDelay ?? 2) | 0));
  return { match: { stage, players, rules, seed }, inputDelay };
}

/**
 * Why a networked match hands control back: "done" (the players left the result screen, or the
 * mode's `finished` said so), "left" (a player dropped mid-match), "failure" (desync), "closed".
 */
export type NetExit = "done" | "left" | "failure" | "closed";

export interface NetVersusOptions {
  transport: WebSocketTransport;
  config: MatchConfig;
  members: Pick<RoomMember, "id" | "name" | "slot">[];
  localSlot: number;
  device: DeviceId;
  inputDelay: number;
  exit: (reason: NetExit) => Screen;
  onLobby?: (message: RelayMessage) => void;
  /** Polled every frame; true hands control back with "done" without waiting for a button. */
  finished?: () => boolean;
}

/** A rollback match over the relay, shared by classic online rooms and DRAW BATTLE. */
export class NetVersusScreen extends VersusScreen {
  readonly session: RollbackSession;
  private failure: { title: string; detail: string; automatic: boolean } | null = null;
  private failureTime = 0;
  private pingTime = 0;
  private unsubscribers: Unsubscribe[] = [];
  private cleanupMatch: () => void;

  constructor(private opts: NetVersusOptions) {
    let cleanup: (() => void) | null = null;
    const done = () => {
      if (!cleanup) throw new Error("online match cleanup is not initialized");
      cleanup();
      return opts.exit("done");
    };
    const session = new RollbackSession({
      config: opts.config,
      localSlot: opts.localSlot,
      transport: opts.transport,
      inputDelay: opts.inputDelay,
      onDesync: (info) => logClient("desync", { frame: info.frame, localHash: info.localHash, remoteHash: info.remoteHash, remoteSlot: info.remoteSlot }),
    });
    const driver = new RollbackMatch(session, opts.device);
    const names = opts.config.players.map((_, slot) => {
      const member = opts.members.find((candidate) => candidate.slot === slot);
      if (!member) throw new Error(`start message omitted slot ${slot}`);
      return member.name;
    });
    super(opts.config, driver.sources, done, done, false, driver);
    this.session = session;
    this.renderer.names = names;
    this.unsubscribers.push(
      opts.transport.onLobby((message) => {
        opts.onLobby?.(message);
        if (message.t === "left" && message.duringMatch) {
          this.failure = { title: "PLAYER DISCONNECTED", detail: "Returning to the room", automatic: true };
          this.session.waiting = true;
        }
      }),
      opts.transport.onClose(() => {
        this.failure = { title: "CONNECTION LOST", detail: "The relay closed", automatic: false };
        this.session.waiting = true;
      }),
    );
    this.cleanupMatch = () => {
      this.session.close();
      for (const unsubscribe of this.unsubscribers) unsubscribe();
      this.unsubscribers.length = 0;
      this.music.stop();
    };
    cleanup = this.cleanupMatch;
  }

  override update(dt: number, menu: MenuInput): Screen | null {
    this.pingTime += dt;
    if (this.pingTime >= 1) {
      this.pingTime -= 1;
      this.opts.transport.ping();
    }
    if (this.session.desync && !this.failure) {
      const desync = this.session.desync;
      this.failure = { title: "DESYNC", detail: `frame ${desync.frame} · ${desync.localHash} ≠ ${desync.remoteHash}`, automatic: false };
    }
    if (this.failure) {
      this.failureTime += dt;
      this.renderer.fx.update(dt);
      if (this.failure.automatic && this.failureTime >= 2) {
        this.cleanupMatch();
        return this.opts.exit("left");
      }
      if (menu.back || menu.confirm) {
        this.cleanupMatch();
        return this.opts.exit(this.failure.title === "CONNECTION LOST" ? "closed" : "failure");
      }
      return null;
    }
    if (this.opts.finished?.()) {
      this.cleanupMatch();
      return this.opts.exit("done");
    }
    return super.update(dt, menu);
  }

  override draw(ctx: CanvasRenderingContext2D, dt: number): void {
    super.draw(ctx, dt);
    const rollback = this.session.rollbackFramesPerSecond();
    const quality = this.session.connectionQuality();
    const color = quality > 0.72 ? "#4dff88" : quality > 0.38 ? INK : "#ff6b5c";
    const status = this.session.waiting ? "WAITING" : `${Math.round(this.opts.transport.rtt())} ms · ${rollback} rb/s`;
    label(ctx, status, VIEW_W - 24, 34, 17, color, "right", 700);
    if (this.failure) drawBanner(ctx, this.failure.title, this.failure.detail, "#ff4d2e", this.failureTime);
    else if (this.session.waiting) drawBanner(ctx, "WAITING", "Connection is catching up", INK, 1);
  }

  netDebug(frame = this.session.state.frame): { frame: number; hash: number | null } {
    return { frame, hash: this.session.stateHashAt(frame) };
  }
}
