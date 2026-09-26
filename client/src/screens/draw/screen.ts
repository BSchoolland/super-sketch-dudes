import { VIEW_H, VIEW_W } from "../../render/camera";
import { PENCIL } from "../../render/paper";
import type { DeviceId, MenuInput } from "../../input/devices";
import { consumeTaps, type ViewPoint } from "../../input/pointer";
import { sfx } from "../../audio/audio";
import { startConfig, type NetExit } from "../netversus";
import { bg, label, title, type Screen } from "../ui";
import { ButtonMenu, inside, type Button } from "./buttons";
import { DrawBattleScreen } from "./battle";
import { RED } from "./character";
import { DrawingView } from "./drawing";
import { LineupView } from "./lineup";
import { AuthView, EntryView, LobbyView } from "./lobby";
import { abandonedResult, battleReporter } from "./logic";
import { ResultsView } from "./results";
import { RevealView } from "./reveal";
import { DrawSession, type StartMessage } from "./session";
import type { DrawHost, DrawView } from "./view";

const LEAVE = { x: 20, y: 16, w: 170, h: 70 };

/** DRAW BATTLE: one connection, one view per server phase, the rollback match in between. */
export class DrawScreen implements Screen, DrawHost {
  t = 0;
  device: DeviceId = "kb1";
  readonly session = new DrawSession();
  private view: DrawView | null = null;
  private viewKey = "";
  private exiting = false;
  private leaveArmed = -1;
  private closedMenu = new ButtonMenu();

  constructor(private onExit: () => Screen) {}

  exit(): void {
    this.exiting = true;
  }

  update(dt: number, m: MenuInput): Screen | null {
    this.t += dt;
    if (m.from) this.device = m.from;
    const taps = consumeTaps();
    const s = this.session;
    if (s.pendingStart) {
      const start = s.pendingStart;
      s.pendingStart = null;
      const local = start.members.find((member) => member.id === s.id);
      if (local) return this.battle(start, local.slot);
    }
    this.syncView();
    if (this.view) {
      const inRoom = !!s.room && s.room.phase !== "lobby" && s.room.phase !== "over";
      if (inRoom && this.leaveRequested(m, taps)) return null;
      this.view.update(m, taps, dt);
    } else if (this.closedMenu.update(this.closedButtons(), m, taps) || m.back) this.exit();
    if (this.exiting) {
      this.view?.dispose?.();
      this.session.close();
      return this.onExit();
    }
    return null;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    // a finished match hands control back and gets drawn before the next update
    this.syncView();
    bg(ctx, this.t);
    const s = this.session;
    if (!this.view) {
      title(ctx, s.closed.toUpperCase(), VIEW_W / 2, VIEW_H / 2 - 40, 80, RED);
      this.closedMenu.draw(ctx, this.closedButtons());
      return;
    }
    this.view.draw(ctx);
    const room = s.room;
    if (room && room.phase !== "lobby" && room.phase !== "over") {
      const armed = this.leaveArmed >= 0 && this.t - this.leaveArmed < 2.5;
      label(ctx, armed ? "again to leave" : `✕  ${room.code}`, LEAVE.x + 10, LEAVE.y + 44, 26, armed ? RED : PENCIL, "left");
    }
    if (s.error && performance.now() - s.error.at < 5000) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, (5000 - (performance.now() - s.error.at)) / 600);
      label(ctx, s.error.text, VIEW_W / 2, 44, 32, RED, "center", 800);
      ctx.restore();
    }
  }

  /** Debug hook for scripts/drawshots.mjs. */
  get drawDebug(): { view: string; code: string | null; id: number; phase: string | null } {
    return { view: this.viewKey, code: this.session.room?.code ?? null, id: this.session.id, phase: this.session.room?.phase ?? null };
  }

  private closedButtons(): Button[] {
    return [{ id: "back", x: VIEW_W / 2 - 200, y: VIEW_H / 2 + 60, w: 400, h: 96, text: "BACK", size: 44 }];
  }

  private syncView(): void {
    const key = this.keyFor();
    if (key === this.viewKey) return;
    this.view?.dispose?.();
    this.view = key === "closed" ? null : this.makeView(key);
    this.viewKey = key;
    this.leaveArmed = -1;
  }

  private keyFor(): string {
    const s = this.session;
    if (s.closed) return "closed";
    if (s.auth !== "ok") return "auth";
    const room = s.room;
    if (!room) return "entry";
    switch (room.phase) {
      case "lobby": return "lobby";
      case "draw": case "reveal": return `${room.phase}:${room.round}`;
      case "loading": case "battle": return `${room.phase}:${room.battle?.index ?? -1}`;
      case "between": return `between:${room.battles.length}`;
      case "over": return "over";
    }
  }

  private makeView(key: string): DrawView {
    const [kind] = key.split(":");
    const round = this.session.room?.round ?? 0;
    switch (kind) {
      case "auth": return new AuthView(this);
      case "entry": return new EntryView(this);
      case "lobby": return new LobbyView(this);
      case "draw": return new DrawingView(this, round);
      case "reveal": return new RevealView(this, round);
      case "loading": return new LineupView(this, "loading");
      case "battle": return new LineupView(this, "battle");
      case "between": return new ResultsView(this, false);
      case "over": return new ResultsView(this, true);
    }
    throw new Error(`no draw view for ${key}`);
  }

  /** Back (or the corner) twice leaves the game; the first press only warns. */
  private leaveRequested(m: MenuInput, taps: ViewPoint[]): boolean {
    const tapped = taps.some((tap) => inside(tap, LEAVE));
    if (!m.back && !tapped) return false;
    if (this.leaveArmed >= 0 && this.t - this.leaveArmed < 2.5) {
      sfx.menuBack();
      this.session.leave();
      this.leaveArmed = -1;
    } else {
      this.leaveArmed = this.t;
    }
    return true;
  }

  private battle(start: StartMessage, localSlot: number): Screen {
    const s = this.session;
    const config = startConfig(start.config, start.seed);
    const isReporter = () => !!s.room && battleReporter(s.room) === s.id;
    const screen: DrawBattleScreen = new DrawBattleScreen({
      transport: s.transport,
      config: config.match,
      members: start.members,
      localSlot,
      device: this.device,
      inputDelay: config.inputDelay,
      finished: () => !!s.room && s.room.phase !== "battle",
      exit: (reason: NetExit) => {
        if ((reason === "left" || reason === "failure") && isReporter() && s.room?.phase === "battle") this.reportAbandoned(screen);
        return this;
      },
    }, {
      isReporter,
      send: (winner, standings) => s.send({ t: "drawBattleEnd", winner, standings }),
    });
    return screen;
  }

  /** A battle that lost a player (or desynced) ends where it stopped. */
  private reportAbandoned(screen: DrawBattleScreen): void {
    const room = this.session.room!;
    const battle = room.battle!;
    const gone = battle.participants.map((id, slot) => (room.players.find((p) => p.id === id)?.connected ? -1 : slot)).filter((slot) => slot >= 0);
    const result = abandonedResult(screen.session.state.fighters, gone);
    this.session.send({ t: "drawBattleEnd", winner: result.winner, standings: result.standings });
  }
}
