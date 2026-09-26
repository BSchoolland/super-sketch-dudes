import type { DeviceId } from "./input/devices";
import type { MatchConfig } from "../../shared/sim";
import type { SessionHandoff } from "./net/rollback";
import type { RelayMessage, RoomMember, WebSocketTransport } from "./net/transport";

/**
 * What one game bundle hands the next when the room switches bundles: the live relay
 * connection (the socket stays open across the swap), the room, and the match in flight.
 */
export interface Handoff {
  transport: WebSocketTransport;
  id: number;
  room: Extract<RelayMessage, { t: "room" }> | null;
  match?: {
    config: MatchConfig;
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
