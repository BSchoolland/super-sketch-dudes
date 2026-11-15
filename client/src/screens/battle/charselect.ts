import { VIEW_W } from "../../render/camera";
import { inkRect, PENCIL } from "../../render/paper";
import { claimPress, pointer } from "../../input/pointer";
import type { DeviceId, MenuInput } from "../../input/devices";
import { bindingsOf, keyName } from "../../input/bindings";
import type { FighterChoice } from "../../fighters";
import { tierName } from "../../../../shared/cpu-skill";
import type { FightBlock } from "../../../../shared/lobby";
import { sfx } from "../../audio/audio";
import { arrows, backRect, button, clicked, grow, hover, keysInHand, label, small, INK } from "../ui";
import { RosterGrid, type Tile } from "./roster";
import type { Rect } from "../scroll";
import { cardParts, drawGhostBox, drawSlotCard, drawTeamTag, slotRow, type SlotFighter, type SlotRow } from "./slots";
import { drawTether, drawToken, tokenR } from "./token";
import { BAND_IN, drawFightBand } from "./fightband";

/** Just under the FIGHT! band. */
const CANCEL_Y = 752;

/** One slot in the room as the character select shows it. */
export interface Seat {
  /** Stable while the slot's holder stays: a member's id, a bot's place among the bots. */
  key: string;
  /** Card header and token label: "Pat" and "P1", "CPU 1" and "CPU". */
  who: string;
  tag: string;
  color: string;
  team: number;
  /** "" while the token is in hand. */
  fighter: string;
  card: SlotFighter | null;
  /** This computer puts the token: its own member's, or (hosting) a bot's or a friend's here. */
  ours: boolean;
  mine: boolean;
  /** A bot (level 0: a friend on this computer with `device`), by its place in the room's bot list. */
  bot?: { index: number; level: number; device?: DeviceId };
}

/** The room as it is this frame. `block`: what keeps it from FIGHT! (see shared/lobby.ts); `loading`: the match is. */
export interface SelectRoom {
  seats: Seat[];
  teams: boolean;
  host: boolean;
  canAdd: boolean;
  block: FightBlock | null;
  loading: boolean;
  back: string;
}

export interface SelectActions {
  /** Puts the seat's token on `choice`, or (null) back in hand. */
  pick(seat: Seat, choice: FighterChoice | null): void;
  fight(): void;
  addBot(): void;
  removeBot(index: number): void;
  stepLevel(index: number, d: number): void;
  stepTeam(seat: Seat, d: number): void;
  toggleTeams(): void;
  leave(): void;
}

/** Keyboard focus below the roster: your team, a bot's card (Enter takes its token), team or level, + ADD BOT, TEAMS, BACK. */
type Focus = "grid" | "team" | `seat:${string}` | `botTeam:${number}` | `botLevel:${number}` | "addBot" | "teams" | "leave";
/** A press travelling this far carries the token instead of tapping it. */
const DRAG = 12;

/**
 * The lobby's character select: the roster across the top, a card per slot under it, and each slot's token. A token
 * goes on a fighter by dragging it there, or tapping it and then the fighter; tapping a fighter with nothing in hand
 * puts your own there. Picking a placed token up takes its pick away. Keyboards and pads move a highlight over the
 * roster and confirm. With every slot on a fighter the screen says FIGHT!, and any press goes.
 */
export class CharacterSelect {
  readonly grid = new RosterGrid();
  /** The token a pointer holds: carried (`drag`) or tapped up, to be tapped down on a fighter. */
  private hand: { key: string; drag: boolean } | null = null;
  private press: { key: string; moved: boolean } | null = null;
  /** When a carried token came to rest at the roster's top or bottom edge: held there a moment, the roster scrolls. */
  private edgeAt: number | null = null;
  private wasDown = false;
  /** Keyboard 1's highlight on the roster, what it carries (a bot's token taken from its card, else your own), and its focus below. */
  private cursor = -1;
  private keyHand: string | null = null;
  focus: Focus = "grid";
  /** Friends here, by device: their highlights. */
  private cursors = new Map<DeviceId, number>();
  /** Keyboard 1 has been used since the pointer last moved: its highlight shows. */
  private keyed = false;
  private seen = { x: -1, y: -1 };
  private bandAt: number | null = null;
  /** This frame's tap or click has done something already. */
  private used = false;

  constructor(private room: () => SelectRoom, private act: SelectActions) {}

  private seat(key: string | null): Seat | undefined {
    return key === null ? undefined : this.room().seats.find((s) => s.key === key);
  }

  private get mine(): Seat | undefined {
    return this.room().seats.find((s) => s.mine);
  }

  private ready(room: SelectRoom): boolean {
    return room.block === null && !room.loading;
  }

  /** Puts `seat`'s token on tile `i` (RANDOM: on one of the fighters, there and then). */
  private place(seat: Seat, i: number): void {
    const tiles = this.grid.tiles;
    let tile: Tile | undefined = tiles[i];
    if (tile === undefined) return;
    if (tile === null) {
      const fighters = this.grid.fighters;
      if (!fighters.length) return;
      tile = fighters[Math.floor(Math.random() * fighters.length)];
      i = this.grid.indexOf(tile.id);
      this.grid.reveal(i);
      if (seat.mine || seat.key === this.keyHand) this.cursor = i;
      else if (seat.bot?.device) this.cursors.set(seat.bot.device, i);
    }
    this.act.pick(seat, tile);
    sfx.menuConfirm();
  }

  private lift(seat: Seat): void {
    if (seat.fighter) { this.act.pick(seat, null); sfx.menuBack(); }
  }

  /** Out of FIGHT!: your token back in your hand, to choose again. */
  private cancel(): void {
    const me = this.mine;
    if (!me) return;
    this.lift(me);
    this.focus = "grid";
    this.keyHand = null;
  }

  // --- keyboards and pads -------------------------------------------------------------------------------------------

  private items(room: SelectRoom): Focus[] {
    const items: Focus[] = ["grid"];
    if (room.teams) items.push("team");
    if (room.host) {
      for (const s of room.seats) {
        if (!s.bot) continue;
        items.push(`seat:${s.key}`);
        if (room.teams) items.push(`botTeam:${s.bot.index}`);
        if (s.bot.level > 0) items.push(`botLevel:${s.bot.index}`);
      }
      if (room.canAdd) items.push("addBot");
      items.push("teams");
    }
    items.push("leave");
    return items;
  }

  /** Keyboard 1 (and whatever plays as it: the arrows when nobody's on keyboard 2, an unclaimed pad). */
  update(m: MenuInput): void {
    const room = this.room();
    if (room.loading) return;
    const dir = m.up || m.down || m.left || m.right;
    if (dir || m.confirm) this.keyed = true;
    const me = this.mine;
    if (this.cursor < 0) this.cursor = Math.max(0, this.grid.indexOf(me?.fighter ?? ""));
    if (this.keyHand && !this.seat(this.keyHand)?.ours) this.keyHand = null;
    if (this.ready(room)) {
      if (m.confirm || m.start) { this.act.fight(); return; }
      if (m.back) { this.cancel(); return; }
      if (!dir || !me) return;
      // choosing again: your token comes back to your hand
      this.lift(me);
      this.focus = "grid";
      this.keyHand = null;
    }
    const items = this.items(room);
    if (!items.includes(this.focus)) this.focus = "grid";
    if (this.focus === "grid") {
      if (dir) {
        const next = this.grid.step(this.cursor, m.left ? -1 : m.right ? 1 : 0, m.up ? -1 : m.down ? 1 : 0);
        if (next === null) this.focus = items[1] ?? "grid";
        else { this.cursor = next; this.grid.reveal(next); }
        sfx.menuMove();
      }
      if (m.confirm) {
        const seat = this.seat(this.keyHand) ?? me;
        if (seat) this.place(seat, this.cursor);
        if (this.keyHand) { this.focus = `seat:${this.keyHand}`; this.keyHand = null; }
      }
      if (m.back) {
        if (this.keyHand) { this.focus = `seat:${this.keyHand}`; this.keyHand = null; sfx.menuBack(); }
        else this.act.leave();
      }
      return;
    }
    if (m.up || m.down) {
      const i = Math.max(0, items.indexOf(this.focus));
      this.focus = items[(i + (m.down ? 1 : items.length - 1)) % items.length];
      sfx.menuMove();
    }
    const [kind, n] = this.focus.split(":");
    if (m.left || m.right) {
      const d = m.right ? 1 : -1;
      if (kind === "botTeam") { const s = room.seats.find((x) => x.bot?.index === Number(n)); if (s) this.act.stepTeam(s, d); }
      else if (kind === "botLevel") this.act.stepLevel(Number(n), d);
      else if (kind === "team" && me) this.act.stepTeam(me, d);
      else if (kind === "teams") this.act.toggleTeams();
    }
    if (m.confirm) {
      if (kind === "seat") {
        const s = this.seat(n);
        if (s) {
          this.keyHand = s.key;
          this.lift(s);
          this.cursor = Math.max(0, this.grid.indexOf(s.fighter));
          this.grid.reveal(this.cursor);
          this.focus = "grid";
          sfx.menuConfirm();
        }
      } else if (kind === "botTeam") { const s = room.seats.find((x) => x.bot?.index === Number(n)); if (s) this.act.stepTeam(s, 1); }
      else if (kind === "team" && me) this.act.stepTeam(me, 1);
      else if (kind === "addBot") this.act.addBot();
      else if (kind === "teams") this.act.toggleTeams();
      else if (kind === "leave") this.act.leave();
    }
    if (m.back) this.act.leave();
  }

  /** A friend here on their own keyboard or pad: their highlight, their token; a pad's B takes them out. */
  updateFriend(seat: Seat, m: MenuInput): void {
    const room = this.room(), device = seat.bot?.device;
    if (room.loading || !device) return;
    const dir = m.up || m.down || m.left || m.right;
    let at = this.cursors.get(device) ?? Math.max(0, this.grid.indexOf(seat.fighter));
    if (m.back && this.ready(room)) { this.lift(seat); return; }
    if (m.back) { this.act.removeBot(seat.bot!.index); this.cursors.delete(device); return; }
    if (this.ready(room)) {
      if (m.confirm || m.start) { this.act.fight(); return; }
      if (!dir) return;
      this.lift(seat);
    }
    if (dir) {
      at = this.grid.step(at, m.left ? -1 : m.right ? 1 : 0, m.up ? -1 : m.down ? 1 : 0) ?? at;
      this.grid.reveal(at);
      sfx.menuMove();
    }
    this.cursors.set(device, at);
    if (m.confirm) this.place(seat, at);
  }

  // --- the pointer and the drawing -----------------------------------------------------------------------------------

  /** Where each placed token sits on the roster, and the rest on their cards. */
  private tokenSpots(room: SelectRoom, row: SlotRow): Map<string, { x: number; y: number; onGrid: boolean; tile: number; k: number }> {
    const spots = new Map<string, { x: number; y: number; onGrid: boolean; tile: number; k: number }>();
    const onTile = new Map<number, number>();
    room.seats.forEach((s, i) => {
      const tile = this.grid.indexOf(s.fighter);
      if (s.fighter) {
        if (tile < 0) return;
        const k = onTile.get(tile) ?? 0;
        onTile.set(tile, k + 1);
        const r = this.grid.rect(tile);
        spots.set(s.key, { x: r.x + k * tokenR() * 1.7, y: r.y, onGrid: true, tile, k });
        return;
      }
      const p = cardParts(row.h);
      spots.set(s.key, { x: row.x(i) + row.w / 2, y: row.y + p.artY + p.artH / 2, onGrid: false, tile: -1, k: 0 });
    });
    return spots;
  }

  /** The band covers these rows: what's under it can't be reached. */
  private underBand(y: number): boolean {
    return y > 330 && y < 730;
  }

  private tokenAt(room: SelectRoom, spots: ReturnType<CharacterSelect["tokenSpots"]>, x: number, y: number): Seat | undefined {
    const v = this.grid.scroll.view, r = tokenR() * (small() ? 1.4 : 1.15);
    return room.seats.filter((s) => s.ours).reverse().find((s) => {
      const at = spots.get(s.key);
      if (!at || Math.hypot(x - at.x, y - at.y) > r) return false;
      if (at.onGrid && (at.y < v.y - r / 2 || at.y > v.y + v.h)) return false;
      return !(this.ready(room) && this.underBand(at.y));
    });
  }

  /** Presses on a token: carried, or tapped up into the hand. */
  private pointerTokens(room: SelectRoom, spots: ReturnType<CharacterSelect["tokenSpots"]>, t: number): void {
    if (room.loading) { this.press = null; this.hand = null; this.wasDown = pointer.down; return; }
    if (pointer.down && !this.wasDown) {
      const s = this.tokenAt(room, spots, pointer.downX, pointer.downY);
      if (s) { this.press = { key: s.key, moved: false }; claimPress(); this.grid.scroll.passPress(); }
    }
    const press = this.press, seat = this.seat(press?.key ?? null);
    if (press && !seat?.ours) this.press = null;
    else if (press && seat) {
      if (pointer.down) {
        if (!press.moved && Math.hypot(pointer.x - pointer.downX, pointer.y - pointer.downY) > DRAG) {
          press.moved = true;
          this.hand = { key: seat.key, drag: true };
          this.lift(seat);
        }
        if (press.moved) this.edgeScroll(t);
      } else {
        if (press.moved) {
          const tile = this.grid.at(pointer.x, pointer.y);
          if (tile >= 0) this.place(seat, tile);
          this.hand = null;
        } else this.tapToken(seat);
        this.press = null;
      }
    }
    this.wasDown = pointer.down;
  }

  /** A token tapped: up into the hand (its pick gone), or back down on its card if it was already there. */
  private tapToken(seat: Seat): void {
    if (this.hand?.key === seat.key && !seat.fighter) { this.hand = null; return; }
    this.lift(seat);
    this.hand = { key: seat.key, drag: false };
    sfx.menuMove();
  }

  private edgeScroll(t: number): void {
    const v = this.grid.scroll.view, x = pointer.x >= v.x && pointer.x <= v.x + v.w;
    const d = !x ? 0 : pointer.y > v.y && pointer.y < v.y + 50 ? -1 : pointer.y > v.y + v.h - 50 && pointer.y < v.y + v.h ? 1 : 0;
    if (!d) { this.edgeAt = null; return; }
    this.edgeAt ??= t;
    if (t - this.edgeAt > 0.35) this.grid.scroll.nudge(d * 14);
  }

  /** The row of boxes under the roster this frame: the slots, + ADD BOT, and where a friend here could drop in. */
  private layout(room: SelectRoom): { row: SlotRow; friendHere: boolean; spots: ReturnType<CharacterSelect["tokenSpots"]> } {
    const friendHere = room.host && keysInHand() && room.seats.length < 6;
    const row = slotRow(room.seats.length + (room.canAdd ? 1 : 0) + (friendHere ? 1 : 0));
    return { row, friendHere, spots: this.tokenSpots(room, row) };
  }

  /** Where the tiles, tokens and cards are on screen (view pixels), for the checks that tap them. */
  where(): { tiles: (Rect & { id: string | null; shown: boolean })[]; seats: { key: string; tag: string; token: { x: number; y: number } | null; card: Rect }[]; addBot: Rect | null; levelArrows: (i: number) => { left: { x: number; y: number }; right: { x: number; y: number } } } {
    const room = this.room(), { row, spots } = this.layout(room), p = cardParts(row.h);
    return {
      tiles: this.grid.tiles.map((tile, i) => ({ ...this.grid.rect(i), id: tile?.id ?? null })),
      seats: room.seats.map((s, i) => ({ key: s.key, tag: s.tag, token: spots.get(s.key) ?? null, card: { x: row.x(i), y: row.y, w: row.w, h: row.h } })),
      addBot: room.canAdd ? { x: row.x(room.seats.length), y: row.y, w: row.w, h: row.h } : null,
      levelArrows: (i) => {
        const x = row.x(i), y = row.y + p.level;
        return { left: { x: x + 38, y: y - 10 }, right: { x: x + row.w - 38, y: y - 10 } };
      },
    };
  }

  draw(ctx: CanvasRenderingContext2D, t: number): void {
    const room = this.room(), ready = this.ready(room), live = !ready && !room.loading;
    if (pointer.x !== this.seen.x || pointer.y !== this.seen.y) { if (this.seen.x >= 0) this.keyed = false; this.seen = { x: pointer.x, y: pointer.y }; }
    if (this.hand && !this.seat(this.hand.key)?.ours) this.hand = null;
    const { row, friendHere, spots } = this.layout(room);
    this.pointerTokens(room, spots, t);
    const held = this.seat(this.hand?.key ?? null);
    // a mouse carries the token it holds; a finger leaves it lifted on its card
    const follows = !!held && (this.hand!.drag || (pointer.present && keysInHand()));
    this.used = false;
    // a tap quicker than a frame never shows as a press: the token under it is still what it meant
    if (pointer.clicked && !this.press && !room.loading) {
      const tapped = this.tokenAt(room, spots, pointer.tapX, pointer.tapY);
      if (tapped) { this.tapToken(tapped); this.used = true; }
    }

    const over = this.grid.at(pointer.x, pointer.y);
    this.grid.draw(ctx, t, () => {
      for (const s of room.seats) {
        const at = spots.get(s.key);
        if (!at?.onGrid) continue;
        const r = this.grid.rect(at.tile), pad = 6 + at.k * 6;
        inkRect(ctx, r.x - pad, r.y - pad, r.w + pad * 2, r.h + pad * 2, s.color, 3);
      }
      if (held && follows && over >= 0) {
        const r = this.grid.rect(over);
        inkRect(ctx, r.x - 6, r.y - 6, r.w + 12, r.h + 12, held.color, 2);
      }
      if (live && keysInHand()) this.drawCursors(ctx, room);
      for (const s of room.seats) {
        const at = spots.get(s.key);
        if (at?.onGrid && s.key !== this.hand?.key) drawToken(ctx, at.x, at.y, s.tag, s.color, { seed: at.tile });
      }
    });
    if (live && over >= 0 && !this.press) document.body.style.cursor = "pointer";
    if (!this.press && this.tokenAt(room, spots, pointer.x, pointer.y)) document.body.style.cursor = "grab";

    room.seats.forEach((s, i) => this.drawCard(ctx, room, row, s, i, live, spots));
    let x = room.seats.length;
    if (room.canAdd && drawGhostBox(ctx, row.x(x++), row.y, row.w, row.h, ["+ ADD BOT"], { button: live, focused: this.keyed && this.focus === "addBot" }) && live) { this.act.addBot(); this.used = true; }
    if (friendHere) drawGhostBox(ctx, row.x(x), row.y, row.w, row.h, ["a friend here?", `press ${keyName(bindingsOf("kb2").attack[0] ?? "")} (keyboard 2)`, "or A on a controller"]);

    const back = backRect(), size = small() ? 40 : 30;
    if (button(ctx, back.x, back.y, back.w, back.h, room.back, { size, focused: this.keyed && this.focus === "leave" }) && !room.loading) { this.act.leave(); this.used = true; }
    if (room.host) {
      const w = small() ? 300 : 240, tx = VIEW_W - back.x - w;
      if (button(ctx, tx, back.y, w, back.h, room.teams ? "TEAMS: ON" : "TEAMS: OFF", { size, focused: this.keyed && this.focus === "teams" }) && !room.loading) { this.focus = "teams"; this.act.toggleTeams(); this.used = true; }
    }

    if (live && pointer.clicked && !this.used && !this.press) {
      const tile = this.grid.at(pointer.tapX, pointer.tapY);
      const seat = this.seat(this.hand?.key ?? null) ?? this.mine;
      if (tile >= 0 && seat) { this.place(seat, tile); this.hand = null; }
      else if (this.hand) this.hand = null;
    }

    if (held && follows) {
      const i = room.seats.findIndex((s) => s.key === held.key), r = tokenR();
      drawTether(ctx, row.x(i) + row.w / 2, row.y - 6, pointer.x + r * 0.6, pointer.y + r * 0.55 + 30, PENCIL);
      drawToken(ctx, pointer.x + r * 0.6, pointer.y + r * 0.55, held.tag, held.color, { lifted: true });
    }

    if (ready || (room.loading && room.block === null)) {
      if (this.bandAt === null) { this.bandAt = t; sfx.menuConfirm(); }
      drawFightBand(ctx, t - this.bandAt, room.loading ? `loading ${".".repeat(1 + (Math.floor(t * 3) % 3))}` : "");
      if (ready && t - this.bandAt > BAND_IN && this.mine) {
        const w = small() ? 340 : 260, h = small() ? 110 : 70;
        if (button(ctx, VIEW_W / 2 - w / 2, CANCEL_Y, w, h, "CANCEL", { size: small() ? 40 : 30, key: "Esc" }) && !this.used) { this.cancel(); this.used = true; }
      }
      // on the band fights; anywhere else backs out of it
      if (ready && !this.used && pointer.clicked && t - this.bandAt > BAND_IN / 2) {
        if (this.underBand(pointer.tapY)) this.act.fight();
        else this.cancel();
      }
    } else this.bandAt = null;
  }

  /** Keyboard 1's highlight (once the keys are in use) and each friend's, in the colour of the token they'd put down. */
  private drawCursors(ctx: CanvasRenderingContext2D, room: SelectRoom): void {
    const mark = (i: number, seat: Seat | undefined, n: number) => {
      if (!seat || i < 0) return;
      const r = this.grid.rect(i), pad = 12 + n * 6;
      ctx.save(); ctx.strokeStyle = seat.color; ctx.lineWidth = 4;
      ctx.strokeRect(r.x - pad, r.y - pad, r.w + pad * 2, r.h + pad * 2);
      ctx.restore();
      if (!seat.fighter) drawToken(ctx, r.x + r.w, r.y, seat.tag, seat.color, { lifted: true });
    };
    if (this.keyed && this.focus === "grid") mark(this.cursor, this.seat(this.keyHand) ?? this.mine, 0);
    let n = 1;
    for (const s of room.seats) {
      const device = s.bot?.device;
      if (device && this.cursors.has(device)) mark(this.cursors.get(device)!, s, n++);
    }
  }

  /** A slot's card and what the host can do on a bot's: take its token, remove it, its level, its team. */
  private drawCard(ctx: CanvasRenderingContext2D, room: SelectRoom, row: SlotRow, s: Seat, i: number, live: boolean, spots: ReturnType<CharacterSelect["tokenSpots"]>): void {
    const x = row.x(i), y = row.y, w = row.w, h = row.h, p = cardParts(h), cx = x + w / 2;
    const bot = s.bot, hosting = room.host && !!bot && live;
    drawSlotCard(ctx, `card:${s.key}`, x, y, w, h, room.teams ? "" : s.who, s.color, s.card, { focused: this.keyed && this.focus === `seat:${s.key}`, team: room.teams });
    if (room.teams) {
      const canSwitch = live && (s.mine || hosting);
      const focus: Focus = s.mine ? "team" : `botTeam:${bot?.index ?? -1}`;
      if (drawTeamTag(ctx, x, y, w, s.team, s.who, { canSwitch, focused: this.keyed && this.focus === focus, room: hosting ? 50 : 0 })) { this.act.stepTeam(s, 1); this.used = true; }
    }
    if (bot && room.host) {
      const hit = small() ? 90 : 48, hx = x + w - hit, over = live && hover(hx, y, hit, hit);
      label(ctx, "×", x + w - 26, y + 44, grow(30, 14) * (over ? 1.2 : 1), over ? "#c8402c" : PENCIL, "center", 400);
      if (over) document.body.style.cursor = "pointer";
      if (live && !this.used && clicked(hx, y, hit, hit)) { this.act.removeBot(bot.index); this.used = true; return; }
    }
    if (bot && bot.level > 0) {
      const ly = y + p.level, focused = this.keyed && this.focus === `botLevel:${bot.index}`;
      label(ctx, tierName(bot.level), cx, ly, grow(30, 12), focused ? INK : PENCIL, "center", 400, small() && hosting ? w - 140 : undefined);
      const size = small() ? 40 : 30;
      if (hosting) {
        const d = small() ? arrows(ctx, cx, ly, w / 2 - 50, size, { w: w / 2 - 6, h: 76 }) : arrows(ctx, cx, ly, w / 2 - 50, size);
        if (d && !this.used) { this.focus = `botLevel:${bot.index}`; this.act.stepLevel(bot.index, d); this.used = true; }
        // under FIGHT! they show, as arrows() draws them, but take nothing
      } else if (room.host) for (const dir of [-1, 1]) label(ctx, dir < 0 ? "◀" : "▶", cx + dir * (w / 2 - 50 + size * 0.4), ly, size, INK);
    } else if (bot?.device) label(ctx, bot.device === "kb2" ? "keyboard 2" : `pad ${Number(bot.device.slice(3)) + 1}`, cx, y + p.level, grow(24, 11), PENCIL, "center", 400);
    const at = spots.get(s.key);
    const carried = (this.hand?.key === s.key && (this.hand.drag || (pointer.present && keysInHand()))) || (this.keyed && this.focus === "grid" && this.keyHand === s.key)
      || (!!s.bot?.device && this.cursors.has(s.bot.device) && keysInHand());
    if (at && !at.onGrid && !carried) drawToken(ctx, at.x, at.y, s.tag, s.color, { lifted: this.hand?.key === s.key, seed: i });
    // the rest of an own card takes its token, like the token itself
    if (!this.used && live && s.ours && clicked(x, y, w, h) && !this.press) {
      this.tapToken(s);
      this.used = true;
    }
  }
}
