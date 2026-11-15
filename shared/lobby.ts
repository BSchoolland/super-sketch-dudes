/**
 * The lobby's one rule about starting, shared by the relay and the client: having a fighter is being ready, and the
 * room can go to the stage screen once every slot (members and bots) has one.
 */
export interface LobbySlots {
  members: readonly { fighter: string; team: number }[];
  /** A bot's `fighter` is "" until someone puts its token on one; level 0 is a friend on the host's computer. */
  bots: readonly { fighter: string; team: number; level: number }[];
  teams: boolean;
}

/** What stops the room from fighting, or null when nothing does. */
export type FightBlock = "alone" | "picking" | "one team" | "friends online";

export function fightBlock(room: LobbySlots): FightBlock | null {
  const slots = [...room.members, ...room.bots];
  if (slots.length < 2) return "alone";
  if (slots.some((s) => s.fighter === "")) return "picking";
  if (room.teams && new Set(slots.map((s) => s.team)).size < 2) return "one team";
  // the relay only runs matches between computers; a friend on the host's keyboard plays locally
  if (room.members.length > 1 && room.bots.some((b) => b.level === 0)) return "friends online";
  return null;
}
