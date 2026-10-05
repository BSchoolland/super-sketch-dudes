import { encodePing, KIND_PING, KIND_PONG, packetKind, pingTime } from "./wire";
import type { Unsubscribe } from "./transport";

/**
 * Peer-to-peer links between the members of a room: one RTCPeerConnection per pair with one unordered,
 * unreliable data channel, signaled over the relay. ICE tries a direct route first (host and STUN candidates)
 * and falls back to the TURN server on its own. A pair that can't connect, or whose link dies, simply isn't
 * linked: inputs always cross the relay as well (see NetLink), so nothing waits on a link.
 *
 * The member with the lower relay id offers and drives retries; the other answers whatever offer is newest
 * (`gen`). The mesh rides on the relay connection's lobby messages only, so it works on any relay connection
 * object a bundle swap hands over, and it survives the swap itself (see Handoff.mesh).
 */
export const MESH_VERSION = 1;

/** What the mesh needs from the relay connection. */
export interface RelaySignal {
  sendLobby(message: Record<string, unknown>): void;
  onLobby(cb: (message: { t: string } & Record<string, unknown>) => void): Unsubscribe;
}

export type Route = "direct" | "turn";

/** One link as telemetry reports it. */
export interface LinkStats {
  attempts: number;
  failures: number;
  /** ms from the first attempt to the first open channel; null until then. */
  firstOpenMs: number | null;
  opens: number;
  route: Route | null;
  /** Selected candidate pair, e.g. "srflx/host udp" or "relay/host udp (turn tcp)". */
  candidates: string | null;
  rttAvg: number;
  rttMax: number;
  rttSamples: number;
  sent: number;
  received: number;
  /** Sends skipped because the channel's buffer was backed up. */
  backedUp: number;
}

interface Peer {
  id: number;
  offerer: boolean;
  gen: number;
  pc: RTCPeerConnection | null;
  dc: RTCDataChannel | null;
  remoteSet: boolean;
  pendingCandidates: RTCIceCandidateInit[];
  open: boolean;
  heardAt: number;
  rtt: number;
  retries: number;
  timer: ReturnType<typeof setTimeout> | null;
  firstAttemptAt: number;
  stats: LinkStats;
}

const CONNECT_TIMEOUT_MS = 10_000;
/** A link that went "disconnected" gets this long to come back before it's rebuilt. */
const DISCONNECTED_GRACE_MS = 3000;
const RETRY_MS = [1000, 2000, 5000, 10_000, 20_000, 30_000];
const PING_MS = 500;
const STATS_MS = 3000;
/** Past this much queued in a channel, a send is dropped: the packet would only arrive stale. */
const BACKED_UP_BYTES = 16_384;
/** A mesh handed to a bundle that never adopts it (one from before the mesh) closes itself after this long. */
const ORPHAN_MS = 30_000;
const ICE_REFRESH_MS = 6 * 3600_000;

export class PeerMesh {
  readonly version = MESH_VERSION;
  private peers = new Map<number, Peer>();
  private ice: RTCIceServer[] | null = null;
  private iceAt = 0;
  private iceAsked = 0;
  private packetListeners = new Set<(id: number, data: ArrayBuffer) => void>();
  private unsubscribe: Unsubscribe;
  private pinger: ReturnType<typeof setInterval>;
  private statser: ReturnType<typeof setInterval>;
  private orphanTimer: ReturnType<typeof setTimeout> | null = null;
  private wanted: number[] = [];
  private closed = false;

  constructor(private relay: RelaySignal, private selfId: () => number) {
    this.unsubscribe = relay.onLobby((m) => {
      if (m.t === "rtc") this.signal(m);
      if (m.t === "ice" && Array.isArray(m.servers)) {
        this.ice = m.servers as RTCIceServer[];
        this.iceAt = Date.now();
        this.members(this.wanted);
      }
    });
    this.askIce();
    this.pinger = setInterval(() => this.ping(), PING_MS);
    this.statser = setInterval(() => this.pollStats(), STATS_MS);
  }

  /** The room's members (relay ids, ourselves included): links open to new ones and close to the ones gone. */
  members(ids: number[]): void {
    if (this.closed) return;
    this.wanted = [...ids];
    const self = this.selfId();
    if (!self) return;
    for (const [id, peer] of this.peers) if (!ids.includes(id)) { this.teardown(peer); this.peers.delete(id); }
    for (const id of ids) {
      if (id === self || this.peers.has(id)) continue;
      this.peers.set(id, {
        id, offerer: self < id, gen: 0, pc: null, dc: null, remoteSet: false, pendingCandidates: [], open: false, heardAt: 0, rtt: 0, retries: 0, timer: null, firstAttemptAt: 0,
        stats: { attempts: 0, failures: 0, firstOpenMs: null, opens: 0, route: null, candidates: null, rttAvg: 0, rttMax: 0, rttSamples: 0, sent: 0, received: 0, backedUp: 0 },
      });
    }
    // offers wait for the ICE servers (STUN and TURN): a link made without them could only ever be local
    if (this.ice) for (const peer of this.peers.values()) if (peer.offerer && peer.gen === 0) void this.offer(peer);
  }

  /** Sends on the link to `id` if it's open; false when there is none (the relay copy is all that goes). */
  send(id: number, data: ArrayBuffer): boolean {
    const peer = this.peers.get(id);
    if (!peer?.open || !peer.dc || peer.dc.readyState !== "open") return false;
    if (peer.dc.bufferedAmount > BACKED_UP_BYTES) { peer.stats.backedUp++; return false; }
    peer.dc.send(data);
    peer.stats.sent++;
    return true;
  }

  onPacket(cb: (id: number, data: ArrayBuffer) => void): Unsubscribe {
    this.packetListeners.add(cb);
    return () => this.packetListeners.delete(cb);
  }

  /** The link to `id` right now: open or not, its route, smoothed round trip, and ms since anything arrived on it. */
  link(id: number): { open: boolean; route: Route | null; rtt: number; heardMsAgo: number } {
    const peer = this.peers.get(id);
    if (!peer) return { open: false, route: null, rtt: 0, heardMsAgo: Infinity };
    return { open: peer.open, route: peer.stats.route, rtt: peer.rtt, heardMsAgo: peer.heardAt ? performance.now() - peer.heardAt : Infinity };
  }

  stats(id: number): LinkStats | null {
    return this.peers.get(id)?.stats ?? null;
  }

  /** Handed to another bundle: it calls adopt(), or the mesh closes itself (a bundle from before the mesh never will). */
  release(): void {
    if (this.orphanTimer) clearTimeout(this.orphanTimer);
    this.orphanTimer = setTimeout(() => this.close(), ORPHAN_MS);
  }

  adopt(): void {
    if (this.orphanTimer) clearTimeout(this.orphanTimer);
    this.orphanTimer = null;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribe();
    clearInterval(this.pinger);
    clearInterval(this.statser);
    if (this.orphanTimer) clearTimeout(this.orphanTimer);
    for (const peer of this.peers.values()) this.teardown(peer);
    this.peers.clear();
    this.packetListeners.clear();
  }

  private askIce(): void {
    this.iceAsked = Date.now();
    this.relay.sendLobby({ t: "ice" });
  }

  private build(peer: Peer): RTCPeerConnection {
    this.teardown(peer);
    if (Date.now() - this.iceAt > ICE_REFRESH_MS && Date.now() - this.iceAsked > 60_000) this.askIce();
    const pc = new RTCPeerConnection({ iceServers: this.ice ?? [] });
    const gen = peer.gen;
    peer.pc = pc;
    peer.remoteSet = false;
    peer.pendingCandidates = [];
    peer.stats.attempts++;
    if (!peer.firstAttemptAt) peer.firstAttemptAt = performance.now();
    // negotiated: both ends create the same channel, so neither waits on ondatachannel
    const dc = pc.createDataChannel("inputs", { negotiated: true, id: 0, ordered: false, maxRetransmits: 0 });
    dc.binaryType = "arraybuffer";
    peer.dc = dc;
    dc.onopen = () => {
      if (peer.gen !== gen) return;
      peer.open = true;
      peer.retries = 0;
      peer.stats.opens++;
      if (peer.stats.firstOpenMs === null) peer.stats.firstOpenMs = Math.round(performance.now() - peer.firstAttemptAt);
      this.clearTimer(peer);
      void this.readRoute(peer);
    };
    dc.onclose = () => {
      if (peer.gen !== gen) return;
      peer.open = false;
      this.lost(peer);
    };
    dc.onmessage = (e) => {
      if (!(e.data instanceof ArrayBuffer)) return;
      peer.heardAt = performance.now();
      peer.stats.received++;
      const kind = packetKind(e.data);
      if (kind === KIND_PING) { if (dc.readyState === "open") dc.send(encodePing(KIND_PONG, pingTime(e.data))); return; }
      if (kind === KIND_PONG) { this.pong(peer, pingTime(e.data)); return; }
      for (const listener of this.packetListeners) listener(peer.id, e.data);
    };
    pc.onicecandidate = (e) => {
      if (e.candidate && peer.gen === gen) this.relay.sendLobby({ t: "rtc", to: peer.id, gen, cand: e.candidate.toJSON() });
    };
    pc.onconnectionstatechange = () => {
      if (peer.gen !== gen) return;
      const state = pc.connectionState;
      if (state === "failed") { peer.open = false; this.lost(peer); }
      else if (state === "disconnected") {
        // ICE often recovers by itself from a short outage; past the grace the offerer rebuilds the link
        if (peer.offerer) this.setTimer(peer, DISCONNECTED_GRACE_MS, () => { if (pc.connectionState !== "connected") { peer.open = false; this.lost(peer); } });
      } else if (state === "connected" && peer.open) this.clearTimer(peer);
    };
    return pc;
  }

  private async offer(peer: Peer): Promise<void> {
    peer.gen++;
    const gen = peer.gen;
    const pc = this.build(peer);
    this.setTimer(peer, CONNECT_TIMEOUT_MS, () => { if (!peer.open) this.lost(peer); });
    try {
      await pc.setLocalDescription(await pc.createOffer());
      if (peer.gen !== gen) return;
      this.relay.sendLobby({ t: "rtc", to: peer.id, gen, offer: pc.localDescription!.sdp });
    } catch (error) {
      // an offer we can't even make is a broken link: count it and retry like any other failure
      console.error("rtc offer failed", error);
      if (peer.gen === gen) this.lost(peer);
    }
  }

  private async signal(m: Record<string, unknown>): Promise<void> {
    if (this.closed) return;
    const peer = this.peers.get(Number(m.from));
    const gen = Number(m.gen);
    if (!peer || !Number.isFinite(gen)) return;
    try {
      if (typeof m.offer === "string") {
        if (peer.offerer || gen < peer.gen) return;
        peer.gen = gen;
        const pc = this.build(peer);
        await pc.setRemoteDescription({ type: "offer", sdp: m.offer });
        peer.remoteSet = true;
        await this.flushCandidates(peer, pc);
        await pc.setLocalDescription(await pc.createAnswer());
        if (peer.gen !== gen) return;
        this.relay.sendLobby({ t: "rtc", to: peer.id, gen, answer: pc.localDescription!.sdp });
      } else if (typeof m.answer === "string") {
        if (!peer.offerer || gen !== peer.gen || !peer.pc) return;
        await peer.pc.setRemoteDescription({ type: "answer", sdp: m.answer });
        peer.remoteSet = true;
        await this.flushCandidates(peer, peer.pc);
      } else if (m.cand && typeof m.cand === "object") {
        if (gen !== peer.gen || !peer.pc) return;
        if (!peer.remoteSet) peer.pendingCandidates.push(m.cand as RTCIceCandidateInit);
        else await peer.pc.addIceCandidate(m.cand as RTCIceCandidateInit);
      }
    } catch (error) {
      console.error("rtc signaling failed", error);
      if (peer.gen === gen) this.lost(peer);
    }
  }

  private async flushCandidates(peer: Peer, pc: RTCPeerConnection): Promise<void> {
    const pending = peer.pendingCandidates;
    peer.pendingCandidates = [];
    for (const c of pending) await pc.addIceCandidate(c);
  }

  /** The link is down (failed, closed, timed out): the offerer tries again after a backoff. */
  private lost(peer: Peer): void {
    if (this.closed || !this.peers.has(peer.id)) return;
    peer.open = false;
    peer.stats.failures++;
    peer.stats.route = null;
    if (!peer.offerer) return;
    const wait = RETRY_MS[Math.min(peer.retries, RETRY_MS.length - 1)];
    peer.retries++;
    this.setTimer(peer, wait, () => void this.offer(peer));
  }

  private setTimer(peer: Peer, ms: number, fn: () => void): void {
    this.clearTimer(peer);
    peer.timer = setTimeout(() => { peer.timer = null; if (!this.closed) fn(); }, ms);
  }

  private clearTimer(peer: Peer): void {
    if (peer.timer) clearTimeout(peer.timer);
    peer.timer = null;
  }

  private teardown(peer: Peer): void {
    this.clearTimer(peer);
    peer.open = false;
    if (peer.dc) { peer.dc.onopen = peer.dc.onclose = peer.dc.onmessage = null; peer.dc.close(); }
    if (peer.pc) { peer.pc.onicecandidate = peer.pc.onconnectionstatechange = null; peer.pc.close(); }
    peer.dc = null;
    peer.pc = null;
  }

  private ping(): void {
    const now = performance.now();
    for (const peer of this.peers.values()) {
      if (peer.open && peer.dc?.readyState === "open" && peer.dc.bufferedAmount <= BACKED_UP_BYTES) peer.dc.send(encodePing(KIND_PING, now));
    }
    // the relay picks auto input delay from these for pairs with a link
    const rtt: Record<number, number> = {};
    for (const peer of this.peers.values()) if (peer.open && peer.stats.rttSamples) rtt[peer.id] = Math.round(peer.rtt);
    if (Object.keys(rtt).length && Math.floor(now / PING_MS) % 4 === 0) this.relay.sendLobby({ t: "peers", rtt });
  }

  private pong(peer: Peer, sentAt: number): void {
    const sample = performance.now() - sentAt;
    if (!(sample >= 0)) return;
    const s = peer.stats;
    peer.rtt = s.rttSamples ? peer.rtt + (sample - peer.rtt) * 0.2 : sample;
    s.rttAvg = Math.round((s.rttAvg * s.rttSamples + sample) / (s.rttSamples + 1));
    s.rttMax = Math.max(s.rttMax, Math.round(sample));
    s.rttSamples++;
  }

  private pollStats(): void {
    for (const peer of this.peers.values()) if (peer.open) void this.readRoute(peer);
  }

  /** Which candidate pair ICE settled on: through the TURN server or not. */
  private async readRoute(peer: Peer): Promise<void> {
    const pc = peer.pc;
    if (!pc) return;
    const report = new Map<string, Record<string, any>>();
    (await pc.getStats()).forEach((s: Record<string, any>) => report.set(s.id, s));
    let pairId: string | undefined;
    for (const s of report.values()) if (s.type === "transport" && s.selectedCandidatePairId) pairId = s.selectedCandidatePairId;
    if (!pairId) for (const s of report.values()) if (s.type === "candidate-pair" && s.nominated && s.state === "succeeded") pairId = s.id;
    const pair = pairId ? report.get(pairId) : undefined;
    if (!pair || pc !== peer.pc) return;
    const local = report.get(pair.localCandidateId), remote = report.get(pair.remoteCandidateId);
    if (!local || !remote) return;
    peer.stats.route = local.candidateType === "relay" || remote.candidateType === "relay" ? "turn" : "direct";
    peer.stats.candidates = `${local.candidateType}/${remote.candidateType} ${local.protocol}${local.relayProtocol ? ` (turn ${local.relayProtocol})` : ""}`;
  }
}
