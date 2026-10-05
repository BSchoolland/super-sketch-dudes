import type { DeviceId } from "./input/devices";
import type { MatchConfig } from "../../shared/sim";
import type { SessionHandoff } from "./net/rollback";
import type { RelayMessage, RoomMember, WebSocketTransport } from "./net/transport";
import type { PeerMesh } from "./net/mesh";

/**
 * What one game bundle hands the next when the room switches bundles: the live relay
 * connection (the socket stays open across the swap), the peer links, the room, and the match in flight.
 */
export interface Handoff {
  transport: WebSocketTransport;
  /** The room's peer-to-peer links, kept open across the swap; a bundle that doesn't know this version makes its own. */
  mesh?: PeerMesh | null;
  id: number;
  room: Extract<RelayMessage, { t: "room" }> | null;
  /** The page session's wide-event trace, so the next bundle's events file under the same session. */
  session?: string;
  match?: {
    config: MatchConfig;
    /** Each slot's fighter bundle ("" for one every build has); the next build loads them before resuming. */
    bundles: string[];
    members: Pick<RoomMember, "id" | "name" | "slot">[];
    localSlot: number;
    device: DeviceId;
    inputDelay: number;
    session: SessionHandoff;
  };
}

/** Set by mount: which bundle this is, and how to ask the shell for another one. */
export const swap = {
  hash: "",
  request: (_hash: string, _handoff: Handoff): void => { throw new Error("this build can't swap bundles (no shell)"); },
};
