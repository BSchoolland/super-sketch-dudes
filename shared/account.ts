import type { Fresh } from "./releases";

/** The game's version. Each player's record keeps the last one they played. */
export const GAME_VERSION = "0.2.0";
export const GAME_STAGE = "Alpha";

/** When a player last played, and which version. */
export interface LastPlayed { version: string; at: number }

/** NEW stickers for what changed since a returning player's last visit: `since` is when they first played this version; `seen` are the ones they've opened. */
export interface News { since: number; fresh: Fresh[]; seen: Fresh[] }

export type CharStatus = "queued" | "generating" | "ready" | "failed";

/** A player: a Discord or Google identity, an email account, or a guest (`guest-…`, a name the server picked). The id is the account. */
export interface Player {
  id: string;
  name: string;
  /** Avatar image URL, if Discord or Google has one; email accounts and guests never do. */
  avatar: string | null;
}

/** The longest a player's name can be. */
export const NAME_MAX = 14;

/** A name an account asked to go by: waiting for the moderator's judges, or refused by them (`reason` is for the player). */
export type NameRequest = { name: string; status: "waiting" } | { name: string; status: "refused"; reason: string };
/** GET /me/name: who they are now, their request, and whether the judges are up to check a waiting one. */
export interface NameStanding { player: Player; request: NameRequest | null; checkerUp: boolean }

/** Guests play without an account; their characters stay out of COMMUNITY until they sign in. */
export const isGuest = (id: string): boolean => id.startsWith("guest-");

/** One character in a player's library: a forge job's outcome, from queued to ready. */
export interface LibraryEntry {
  /** The fighter id (roster key), also the folder under /gen. */
  id: string;
  owner: string;
  status: CharStatus;
  stage: string;
  /** While it's queued or forging: when it moved onto `stage`, by the server's clock (ms). */
  stageAt?: number;
  error: string | null;
  name: string | null;
  tagline: string | null;
  description: string | null;
  drawingUrl: string;
  bundleUrl: string | null;
  sheetUrl: string | null;
  createdAt: number;
  /** Old entries may name the draw battle room they were drawn in. */
  origin: "creator" | { room: string; round: number };
  /** In every player's library from the start (a reference fighter); can't be deleted. */
  starter?: boolean;
  /** Listed in COMMUNITY for anyone to save. */
  public: boolean;
  /** In another player's library because they saved it, at this time; they can unsave it, not delete it. */
  saved?: number;
  /** Its creator deleted it while others had it saved: gone from theirs and from COMMUNITY, kept for the savers. */
  deleted?: boolean;
  /** A moderator judge flagged it: kept out of COMMUNITY and the menu brawl, whatever `public` says, until Ben releases it. */
  held?: boolean;
  /** It failed through no fault of the player: TRY AGAIN forges it once more without using up a forge of theirs. */
  retryable?: boolean;
}

/**
 * Where a player stands with the forge (server/budget.ts): what they may still start and, when they can't, why.
 * Times are epoch ms; the client words them in the player's own time zone.
 */
export interface ForgeStanding {
  /** Whose allowance: a signed-in player's daily one, a guest's lifetime one, or staff, who have a player's and may reset it. */
  kind: "player" | "guest" | "staff";
  /** Forges they may still start. */
  left: number;
  /** The allowance itself: per day for a player or staff, ever for a guest. */
  allowance: number;
  /** A signed-in player's daily allowance, for telling a guest what signing in gets them. */
  perPlayerPerDay: number;
  /** Why they can't start one now, or null if they can. */
  wall: null | "day" | "guest" | "network" | "waiting";
  /** When "day" or "network": when the next forge comes back. */
  moreAt: number | null;
  /** The forge isn't taking jobs: Ben paused it (`reason`), or this week's forges are spent (`until` the next week). */
  resting: { reason: string | null; until: number | null } | null;
  /** Their drawings queued for the forge (while it rests, waiting for it to open). */
  waiting: number;
  /** How many drawings one player may leave waiting while the forge rests. */
  waitingPerPlayer: number;
}

/** A character in COMMUNITY, as the caller sees it. */
export interface CommunityCharacter extends Pick<LibraryEntry, "id" | "name" | "tagline" | "drawingUrl" | "createdAt"> {
  bundleUrl: string;
  creator: Pick<Player, "name">;
  /** Online matches it was picked for. */
  plays: number;
  /** Players who have it saved. */
  saves: number;
  /** Hand-picked: it leads BEST. */
  best: boolean;
  /** In the caller's library by reference. */
  saved: boolean;
  /** The caller made it. */
  mine: boolean;
}
/** BEST: the hand-picked ones, newest pick first, then the rest by `bestScore`. */
export type CommunitySort = "best" | "new";
export const COMMUNITY_SORTS: readonly CommunitySort[] = ["best", "new"];
export const COMMUNITY_PAGE = 36;

/** A looks grade runs 1 to LOOK_MAX; LOOK_PLAIN neither helps nor hurts, and each point either side is worth LOOK_WEIGHT saves. */
export const LOOK_MAX = 10, LOOK_PLAIN = 5, LOOK_WEIGHT = 0.6;
/** What BEST ranks the characters nobody picked by: how many players saved it, moved by how cool it looks (ungraded: not moved). */
export const bestScore = (saves: number, look: number | null): number => saves + (look === null ? 0 : (look - LOOK_PLAIN) * LOOK_WEIGHT);

/** A fighter in the release card's lineup. */
export type FeaturedCharacter = Pick<LibraryEntry, "id" | "drawingUrl"> & { bundleUrl: string };
export const FEATURED = 8, FEATURED_PER_CREATOR = 2;

/** Longest side of the drawing the client uploads; the server rejects bigger. */
export const DRAW_PNG_MAX_BYTES = 900_000;
/** The optional name and description a player gives a new character. */
export const HINT_NAME_MAX = 28, HINT_DESCRIPTION_MAX = 720;

/** The Google OAuth client (project super-sketch-dudes) whose ID tokens the server accepts. */
export const GOOGLE_CLIENT_ID = "568376323404-395dbb6rf9c6p8n3mhnd1obh4u4r1gc3.apps.googleusercontent.com";

/** The Discord app players sign in with, on the website and as the Discord Activity. */
export const DISCORD_APP_ID = "1569520137055240272";

/** Header the client sends its session token in. */
export const SESSION_HEADER = "x-session";

/**
 * A fighter bundle a room member may name: a same-site path to a forged fighter or a house one,
 * whose folder is the fighter id. Bundles carry code every client runs, so nothing else is allowed.
 */
export function isBundlePath(url: string, fighter: string): boolean {
  const m = /^\/(?:[\w-]+\/)*(?:gen|house)\/([\w-]+)\/(?:[0-9a-f]{8}\/)?bundle\.json(?:\?v=[\w.-]+)?$/.exec(url);
  return !!m && m[1] === fighter;
}

