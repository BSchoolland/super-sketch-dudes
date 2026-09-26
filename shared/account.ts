import type { CharStatus } from "./draw";

/** A signed-in player: their Discord identity. The id is the account. */
export interface Player {
  id: string;
  name: string;
  /** Avatar image URL, if Discord has one. */
  avatar: string | null;
}

/** One character in a player's library: a forge job's outcome, from queued to ready. */
export interface LibraryEntry {
  /** The fighter id (roster key), also the folder under /gen. */
  id: string;
  owner: string;
  status: CharStatus;
  stage: string;
  error: string | null;
  name: string | null;
  tagline: string | null;
  description: string | null;
  card: string[] | null;
  drawingUrl: string;
  bundleUrl: string | null;
  sheetUrl: string | null;
  createdAt: number;
  /** Drawn in the creator, or in a draw battle room. */
  origin: "creator" | { room: string; round: number };
}

/** Header the client sends its session token in. */
export const SESSION_HEADER = "x-session";
