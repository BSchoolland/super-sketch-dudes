import type { InputFrame } from "../../../shared/input";
import type { LinkStats, PeerMesh, Route } from "./mesh";
import type { HashCallback, InputsCallback, LocalInputs, RelayVerdicts, Transport, Unsubscribe, WebSocketTransport } from "./transport";
import { decodeInputs, encodeInputs, KIND_INPUTS, MAX_FRAMES } from "./wire";

/** What NetLink needs of the relay connection (any bundle's: see WebSocketTransport). */
export type RelayInputs = Pick<WebSocketTransport, "send" | "onInputs" | "sendHash" | "onHash" | "onLobby" | "rtt">
  // an older bundle's relay connection (handed across a swap) can't resume
  & Partial<Pick<WebSocketTransport, "onResumed" | "linkStats">>;

/** How one remote player's inputs reached us, and how long a peer-to-peer link to them was up. */
export interface PathStats {
  name: string;
  /** Input frames that arrived first over the link, and first over the relay. */
  framesViaLink: number;
  framesViaRelay: number;
  packetsViaLink: number;
  packetsViaRelay: number;
  /** ms of the match with the link open, and without one (relay only). */
  linkMs: number;
  relayOnlyMs: number;
  /** Times the link came up or went down during the match. */
  changes: number;
  route: Route | null;
  link: LinkStats | null;
}

/** A relay-only peer whose acknowledgement hasn't moved for this long gets the frames it lacks again. */
const STALE_ACK_MS = 1000;

/**
 * The match's transport: every input goes to the relay once, in order (reliable, so a pair without a link, a mixed
 * match or a dead link loses nothing), and to each player with an open peer-to-peer link as the whole run that
 * player hasn't acknowledged, every tick (unreliable and unordered: a lost packet is covered by the next one).
 * Whichever copy arrives first is the one that counts; the session ignores the other.
 */
export class NetLink implements Transport {
  private listeners = new Set<InputsCallback>();
  private verdicts = new Set<RelayVerdicts>();
  private slotOf = new Map<number, number>();
  private idOf = new Map<number, number>();
  private relaySent: number | null = null;
  /** The relay link resumed on a fresh socket: own inputs after this frame go to the relay again. */
  private resumedAt: number | null = null;
  private staleAcks = new Map<number, { ack: number; at: number }>();
  private lastStaleResend = 0;
  private lastTick = 0;
  private paths = new Map<number, PathStats>();
  private wasOpen = new Map<number, boolean>();
  private unsubscribers: Unsubscribe[];

  constructor(private relay: RelayInputs, private mesh: PeerMesh | null, members: { id: number; name: string; slot: number }[], private localSlot: number) {
    for (const m of members) {
      if (m.slot === localSlot) continue;
      this.slotOf.set(m.id, m.slot);
      this.idOf.set(m.slot, m.id);
      this.paths.set(m.slot, { name: m.name, framesViaLink: 0, framesViaRelay: 0, packetsViaLink: 0, packetsViaRelay: 0, linkMs: 0, relayOnlyMs: 0, changes: 0, route: null, link: null });
    }
    this.unsubscribers = [
      relay.onInputs((slot, frame, inputs, ahead, acks) => {
        const path = this.paths.get(slot);
        const fresh = this.emit(slot, frame, inputs, ahead, acks, true);
        if (path) { path.packetsViaRelay++; path.framesViaRelay += fresh; }
      }),
      relay.onLobby((m) => {
        if (m.t === "fill") for (const v of this.verdicts) v.fill(m.slot, m.from, m.through);
        if (m.t === "final") for (const v of this.verdicts) v.final(m.frame);
      }),
    ];
    if (mesh) this.unsubscribers.push(mesh.onPacket((id, data) => this.fromLink(id, data)));
    const resumed = relay.onResumed?.((ack) => { this.resumedAt = ack; });
    if (resumed) this.unsubscribers.push(resumed);
  }

  sendInputs(local: LocalInputs): void {
    this.account(local);
    const { newest } = local;
    if (this.relaySent === null) this.relaySent = Math.max(local.oldest, Math.min(newest, ...local.peerAcks.values())) - 1;
    if (this.resumedAt !== null) {
      // frames older than what's still held were played away by the relay meanwhile (it fills a silent player)
      this.relaySent = Math.min(this.relaySent, Math.max(this.resumedAt, local.oldest - 1));
      this.resumedAt = null;
    }
    if (newest > this.relaySent) {
      for (let from = this.relaySent + 1; from <= newest; from += MAX_FRAMES) this.toRelay(local, from, Math.min(newest, from + MAX_FRAMES - 1));
      this.relaySent = newest;
    }
    this.resendStale(local);
    if (!this.mesh) return;
    for (const [slot, ack] of local.peerAcks) {
      const id = this.idOf.get(slot);
      if (id === undefined || !this.mesh.link(id).open) continue;
      // always at least the newest frame: it carries our acks and time sync even when they have everything
      const first = Math.max(local.oldest, Math.min(ack + 1, newest));
      if (newest - first < MAX_FRAMES) this.toLink(id, local, first, newest);
      else {
        // a backlog too long for one packet (their acks aren't reaching us): the oldest they lack, and the newest
        this.toLink(id, local, first, first + MAX_FRAMES / 2 - 1);
        this.toLink(id, local, newest - MAX_FRAMES / 2 + 1, newest);
      }
    }
  }

  private toLink(id: number, local: LocalInputs, first: number, last: number): void {
    const inputs: InputFrame[] = [];
    for (let f = first; f <= last; f++) inputs.push(local.input(f));
    this.mesh!.send(id, encodeInputs({ slot: local.slot, first, inputs, ahead: local.ahead, acks: local.acks }));
  }

  onInputs(cb: InputsCallback): Unsubscribe {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  sendHash(frame: number, hash: number): void {
    this.relay.sendHash(frame, hash);
  }

  onHash(cb: HashCallback): Unsubscribe {
    return this.relay.onHash(cb);
  }

  onVerdicts(cb: RelayVerdicts): Unsubscribe {
    this.verdicts.add(cb);
    return () => this.verdicts.delete(cb);
  }

  /** The slowest player's round trip: over their link when it's open, else our own to the relay. */
  rtt(): number {
    let worst = 0;
    for (const slot of this.paths.keys()) {
      const link = this.linkTo(slot);
      worst = Math.max(worst, link?.open && link.rtt > 0 ? link.rtt : this.relay.rtt());
    }
    return worst;
  }

  /** How the relay connection healed itself this match (null from an older bundle's connection). */
  relayLink(): WebSocketTransport["linkStats"] | null {
    return this.relay.linkStats ? { ...this.relay.linkStats } : null;
  }

  /** Remote slots with an open link, out of all remote slots. */
  linked(): { open: number; of: number } {
    let open = 0;
    for (const slot of this.paths.keys()) if (this.linkTo(slot)?.open) open++;
    return { open, of: this.paths.size };
  }

  pathStats(): Record<number, PathStats> {
    const out: Record<number, PathStats> = {};
    for (const [slot, path] of this.paths) {
      const id = this.idOf.get(slot)!;
      path.link = this.mesh?.stats(id) ?? null;
      path.route = this.mesh?.link(id).route ?? null;
      out[slot] = { ...path, linkMs: Math.round(path.linkMs), relayOnlyMs: Math.round(path.relayOnlyMs) };
    }
    return out;
  }

  close(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers.length = 0;
    this.listeners.clear();
    this.verdicts.clear();
  }

  private linkTo(slot: number) {
    const id = this.idOf.get(slot);
    return id === undefined || !this.mesh ? null : this.mesh.link(id);
  }

  private toRelay(local: LocalInputs, from: number, to: number): void {
    const inputs: InputFrame[] = [];
    for (let f = from; f <= to; f++) inputs.push(local.input(f));
    this.relay.send(to, inputs, local.ahead, local.acks);
  }

  /**
   * The relay copy goes once, so a session that wasn't listening when it passed (across a bundle swap) would never
   * get it. A player without a link whose acknowledgement is stuck behind us gets the missing run again.
   */
  private resendStale(local: LocalInputs): void {
    const now = performance.now();
    let from = Infinity;
    for (const [slot, ack] of local.peerAcks) {
      const seen = this.staleAcks.get(slot);
      if (!seen || seen.ack !== ack) { this.staleAcks.set(slot, { ack, at: now }); continue; }
      if (ack >= local.newest || this.linkTo(slot)?.open || now - seen.at < STALE_ACK_MS) continue;
      from = Math.min(from, ack + 1);
    }
    if (from === Infinity || now - this.lastStaleResend < STALE_ACK_MS) return;
    this.lastStaleResend = now;
    from = Math.max(from, local.oldest);
    this.toRelay(local, from, Math.min(local.newest, from + MAX_FRAMES - 1));
  }

  private fromLink(id: number, data: ArrayBuffer): void {
    const slot = this.slotOf.get(id);
    if (slot === undefined) return;
    if (new DataView(data).getUint8(0) !== KIND_INPUTS) return;
    const p = decodeInputs(data);
    if (p.slot !== slot) throw new Error(`member ${id} plays slot ${slot} but sent inputs for slot ${p.slot}`);
    const path = this.paths.get(slot)!;
    path.packetsViaLink++;
    path.framesViaLink += this.emit(slot, p.first + p.inputs.length - 1, p.inputs, p.ahead, p.acks, false);
  }

  private emit(slot: number, frame: number, inputs: InputFrame[], ahead: number[] | undefined, acks: number[] | undefined, final: boolean): number {
    let fresh = 0;
    for (const listener of this.listeners) fresh += listener(slot, frame, inputs, ahead, acks, final) ?? 0;
    return fresh;
  }

  /** Per remote player: how long the match had a link to them, and how often it came and went. */
  private account(local: LocalInputs): void {
    const now = performance.now();
    const ms = this.lastTick ? Math.min(250, now - this.lastTick) : 0;
    this.lastTick = now;
    for (const [slot, path] of this.paths) {
      if (!local.peerAcks.has(slot)) continue;
      const open = !!this.linkTo(slot)?.open;
      if (open) path.linkMs += ms; else path.relayOnlyMs += ms;
      const was = this.wasOpen.get(slot);
      if (was !== undefined && was !== open) path.changes++;
      this.wasOpen.set(slot, open);
    }
  }
}
