import type { FighterId, StageId } from "../../../shared/types";
import { roster } from "../../../shared/fighters/index";
import { stageList } from "../../../shared/stages/index";
import type { MatchConfig } from "../../../shared/sim";
import { VIEW_W } from "../render/camera";
import { drawBanner } from "../render/hud";
import type { DeviceId, MenuInput } from "../input/devices";
import { logClient } from "../telemetry";
import { RollbackMatch } from "../net/match";
import { RollbackSession, type SessionHandoff } from "../net/rollback";
import { swap } from "../handoff";
import type { RelayMessage, RoomMember, Unsubscribe, WebSocketTransport } from "../net/transport";
import { VersusScreen } from "./versus";
import { label, type Screen, INK } from "./ui";
import { site } from "../base";
import { isBundlePath } from "../../../shared/account";

/**
 * The match a `start` message describes, and the bundle each player's fighter loads from ("" for
 * a fighter this client already has, as in DRAW BATTLE). Fighters with a bundle may not be
 * registered yet: load them before building the match.
 */
export function startConfig(value: unknown, seed: number): { match: MatchConfig; inputDelay: number; bundles: string[] } {
  if (!value || typeof value !== "object") throw new Error("online start missing config");
  const raw = value as Record<string, unknown>;
  const stage = String(raw.stage ?? "") as StageId;
  if (!stageList.some((s) => s.id === stage)) throw new Error(`online start has unknown stage ${stage}`);
  if (!Array.isArray(raw.players) || raw.players.length < 2 || raw.players.length > 4) throw new Error("online start has invalid players");
  const bundles: string[] = [];
  const players = raw.players.map((player) => {
    const p = player as Record<string, unknown>;
    const fighter = String(p.fighter ?? "") as FighterId;
    const bundleUrl = typeof p.bundleUrl === "string" ? p.bundleUrl : "";
    if (bundleUrl && !isBundlePath(bundleUrl, fighter)) throw new Error(`online start has a bad bundle for ${fighter}: ${bundleUrl}`);
    if (!bundleUrl && !roster[fighter]) throw new Error(`online start has unknown fighter ${fighter}`);
    bundles.push(bundleUrl);
    return { fighter };
  });
  if (!raw.rules || typeof raw.rules !== "object") throw new Error("online start has invalid rules");
  const rules = raw.rules as MatchConfig["rules"];
  const inputDelay = Math.max(1, Math.min(6, Number(raw.inputDelay ?? 2) | 0));
  return { match: { stage, players, rules, seed }, inputDelay, bundles };
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
  /** Each slot's fighter bundle, carried across a bundle swap so the next build can load them. */
  bundles?: string[];
  exit: (reason: NetExit) => Screen;
  onLobby?: (message: RelayMessage) => void;
  /** Polled every frame; true hands control back with "done" without waiting for a button. */
  finished?: () => boolean;
  /** Continue a match another bundle was running. */
  resume?: SessionHandoff;
  /** Whether this client answers a `game` message with the swap frame (the room's host). */
  isHost: () => boolean;
  /** The room as this bundle last saw it, for the handoff. */
  roomState: () => RelayMessage & { t: "room" } | null;
  localId: () => number;
}

/** A rollback match over the relay, shared by classic online rooms and DRAW BATTLE. */
export class NetVersusScreen extends VersusScreen {
  readonly session: RollbackSession;
  protected failure: { title: string; detail: string; automatic: boolean } | null = null;
  private failureTime = 0;
  private pingTime = 0;
  private waitingFor = 0;
  private unsubscribers: Unsubscribe[] = [];
  private cleanupMatch: () => void;
  private swapAt: { hash: string; frame: number } | null = null;

  constructor(protected opts: NetVersusOptions) {
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
      resume: opts.resume,
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
    if (opts.resume) this.countdown = 0;
    this.unsubscribers.push(
      opts.transport.onLobby((message) => {
        opts.onLobby?.(message);
        if (message.t === "left" && message.duringMatch) {
          this.failure = { title: "PLAYER DISCONNECTED", detail: "Returning to the room", automatic: true };
          this.session.waiting = true;
        }
        // a bundle switch: the host names a frame far enough ahead that everyone can confirm it
        if (message.t === "game" && opts.isHost()) opts.transport.sendLobby({ t: "gameAt", hash: message.hash, frame: this.session.state.frame + 90 });
        if (message.t === "gameAt" && message.hash !== swap.hash) { this.swapAt = { hash: message.hash, frame: message.frame }; this.session.keepFrom = message.frame; }
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
    this.waitingFor = this.session.waiting ? this.waitingFor + dt : 0;
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
    if (this.swapAt) {
      this.session.synchronize();
      const handoff = this.session.handoff(this.swapAt.frame);
      if (handoff) {
        const { hash } = this.swapAt;
        this.swapAt = null;
        this.cleanupMatch();
        swap.request(hash, {
          transport: this.opts.transport, id: this.opts.localId(), room: this.opts.roomState(),
          match: { config: this.opts.config, bundles: this.opts.bundles ?? [], members: this.opts.members, localSlot: this.opts.localSlot, device: this.opts.device, inputDelay: this.opts.inputDelay, session: handoff },
        });
        return null;
      }
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
    label(ctx, swap.hash ? `bundle ${swap.hash}` : `build ${site.build}`, VIEW_W - 24, 56, 15, "rgba(41,39,34,0.55)", "right", 400);
    if (this.swapAt) label(ctx, `switching at frame ${this.swapAt.frame}`, VIEW_W - 24, 78, 15, "#c8402c", "right", 700);
    if (this.failure) drawBanner(ctx, this.failure.title, this.failure.detail, "#ff4d2e", this.failureTime);
    else if (this.waitingFor > 0.5) drawBanner(ctx, "WAITING", "Connection is catching up", INK, 1);
  }

  netDebug(frame = this.session.state.frame): { frame: number; hash: number | null } {
    return { frame, hash: this.session.stateHashAt(frame) };
  }
}
