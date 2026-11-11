import { crazyGamesSignIn, guestSignIn, markPlayed, playingAsGuest, signOut, signedIn } from "./account";
import { everywhere } from "./telemetry/events";
import { setMuted } from "./audio/audio";
import type { RelayMessage } from "./net/transport";
import { MAX_PLAYERS } from "../../shared/sim";

/**
 * The game inside CrazyGames: the page CrazyGames frames (<base>crazygames) with their HTML5 SDK v3, loaded only there.
 * Only what the game uses of the SDK (https://docs.crazygames.com/sdk/intro/).
 */
export interface CrazyUser { username: string; profilePictureUrl: string }
export interface CrazyRoom { roomId?: string; isJoinable?: boolean; inviteParams?: Record<string, string> }
export interface CrazySettings { muteAudio: boolean; disableChat: boolean }
export interface CrazySdk {
  readonly environment: "local" | "crazygames" | "disabled" | "uninitialized";
  init(): Promise<void>;
  game: {
    loadingStart(): void;
    loadingStop(): void;
    gameplayStart(): void;
    gameplayStop(): void;
    happytime(): void;
    inviteLink(params: Record<string, string>): string;
    /** The params of the invite link this page was opened from, or null. */
    inviteParams: Record<string, string> | null;
    isInstantMultiplayer: boolean;
    updateRoom(room: CrazyRoom): void;
    leftRoom(): void;
    addJoinRoomListener(fn: (params: Record<string, string>) => void): void;
    settings: CrazySettings;
    addSettingsChangeListener(fn: (settings: CrazySettings) => void): void;
  };
  user: {
    /** False on sites CrazyGames distributes the game to that have no CrazyGames accounts. */
    isUserAccountAvailable: boolean;
    getUserToken(opts: { signingKeyType: "IN_GAME_AUTH" }): Promise<string>;
    showAuthPrompt(): Promise<CrazyUser>;
    addAuthListener(fn: (user: CrazyUser | null) => void): void;
  };
}

export interface CrazyGames {
  sdk: CrazySdk;
  environment: CrazySdk["environment"];
  /** CrazyGames accounts exist where the game runs: a guest is offered SIGN IN. */
  accounts: boolean;
  /** The room of the invite link this page was opened from, until it's been opened. */
  invite: string | null;
  /** Instant multiplayer (the player came to play with friends), until their first room is open. */
  instant: boolean;
}

/** Set once mount has the SDK up inside CrazyGames (or its local mode): this page is the CrazyGames build. */
export let crazyGames: CrazyGames | null = null;

export type CrazyGamesLaunch = "crazygames" | "stub";
const SDK_URL = "https://sdk.crazygames.com/crazygames-sdk-v3.js";

/**
 * Whether this page was opened as the CrazyGames build: the URL CrazyGames frames, or (dev builds only)
 * `?crazygames=stub&cgapi=<fake CrazyGames>[&user=<name>]`, which plays it against a fake CrazyGames.
 */
export function crazyGamesLaunch(params: URLSearchParams, pathname: string, base: string, dev: boolean): CrazyGamesLaunch | null {
  if (pathname === `${base}crazygames` || pathname === `${base}crazygames/`) return "crazygames";
  if (dev && params.get("crazygames") === "stub") return "stub";
  return null;
}

/**
 * Loads and starts the SDK, and says where it found itself. Only "crazygames" and "local" (the SDK's own mode on
 * localhost, with its demo users) set `crazyGames`; "disabled" is the URL opened anywhere else, which plays the website.
 */
export async function startCrazyGames(launch: CrazyGamesLaunch, params: URLSearchParams): Promise<CrazySdk["environment"]> {
  let sdk: CrazySdk;
  if (launch === "crazygames") {
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = SDK_URL;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`the CrazyGames SDK didn't load from ${SDK_URL}`));
      document.head.appendChild(script);
    });
    sdk = (window as unknown as { CrazyGames: { SDK: CrazySdk } }).CrazyGames.SDK;
  } else if (import.meta.env.DEV) sdk = (await import("./crazygames-stub")).stubSdk(params);
  else throw new Error("the stub CrazyGames is only in dev builds");
  await sdk.init();
  if (sdk.environment !== "crazygames" && sdk.environment !== "local") return sdk.environment;
  crazyGames = { sdk, environment: sdk.environment, accounts: sdk.user.isUserAccountAvailable, invite: sdk.game.inviteParams?.room ?? null, instant: sdk.game.isInstantMultiplayer };
  sdk.game.loadingStart();
  setMuted(sdk.game.settings.muteAudio);
  sdk.game.addSettingsChangeListener((s) => setMuted(s.muteAudio));
  return sdk.environment;
}

const sdk = (): CrazySdk => {
  if (!crazyGames) throw new Error("CrazyGames SDK used outside CrazyGames");
  return crazyGames.sdk;
};
const codeOf = (error: unknown): unknown => (error as { code?: unknown } | null)?.code;

/** The logged-in CrazyGames user's token, or null for a guest. */
async function userToken(): Promise<string | null> {
  if (!crazyGames?.accounts) return null;
  try {
    return await sdk().user.getUserToken({ signingKeyType: "IN_GAME_AUTH" });
  } catch (error) {
    if (codeOf(error) === "userNotAuthenticated") return null;
    throw error;
  }
}

/**
 * Who plays, at every launch and whenever the session is lost: the logged-in CrazyGames user (moving this browser's
 * guest to them), else this browser's guest, else a new guest. A CrazyGames player who logged out of CrazyGames
 * (which reloads the page) ends here, and plays on as a new guest.
 */
export async function crazyGamesPlayer(): Promise<void> {
  const token = await userToken();
  if (token) return crazyGamesSignIn(token);
  if (signedIn() && !playingAsGuest()) signOut();
  if (signedIn()) await markPlayed().catch((error: unknown) => everywhere("warn", "played", `marking this visit failed: ${error instanceof Error ? error.message : String(error)}`));
  if (!signedIn()) await guestSignIn();
}

let loggingIn: Promise<void> | null = null;

/** A guest logged in to CrazyGames (their SIGN IN, or CrazyGames' own login): they become that player, keeping what they made. */
export function crazyGamesLoggedIn(): Promise<void> {
  if (!playingAsGuest()) return Promise.resolve();
  loggingIn ??= (async () => {
    const token = await userToken();
    if (!token) throw new Error("CrazyGames says you're logged in but gave no sign-in token");
    await crazyGamesSignIn(token);
  })().finally(() => { loggingIn = null; });
  return loggingIn;
}

/** A guest's SIGN IN: CrazyGames' login prompt, then the sign-in. Closing the prompt signs nobody in. */
export async function crazyGamesLogin(): Promise<void> {
  try {
    await sdk().user.showAuthPrompt();
  } catch (error) {
    if (codeOf(error) === "userCancelled") return;
    if (codeOf(error) !== "userAlreadySignedIn") throw error;
  }
  await crazyGamesLoggedIn();
}

/** CrazyGames' own login, while the game runs. */
export function onCrazyGamesLogin(fn: () => void): void {
  sdk().user.addAuthListener((user) => { if (user) fn(); });
}

/**
 * Where the player starts: the room of the invite link they opened, a private room of their own for instant
 * multiplayer (null), or the title (undefined). Asked once: the next time is the title.
 */
export function takeFirstRoom(): string | null | undefined {
  if (!crazyGames) return undefined;
  const { invite, instant } = crazyGames;
  crazyGames.invite = null;
  crazyGames.instant = false;
  return invite ?? (instant ? null : undefined);
}

/** An invite accepted while the game runs (CrazyGames' own UI): `fn` gets the room. */
export function onCrazyGamesInvite(fn: (room: string) => void): void {
  sdk().game.addJoinRoomListener((params) => {
    if (!params.room) throw new Error(`a CrazyGames invite with no room: ${JSON.stringify(params)}`);
    fn(params.room);
  });
}

/**
 * The room a friend could be invited into: one that shows its code (not VS BOTS, SAME KEYBOARD or the Activity's call),
 * joinable while a person can still take a place (people take bots' places; mid-match they wait for the next one).
 */
export function invitableRoom(room: Extract<RelayMessage, { t: "room" }> | null, hidden?: "bots" | "local"): { code: string; joinable: boolean } | null {
  if (!room || hidden || room.call) return null;
  return { code: room.code, joinable: room.members.length < MAX_PLAYERS };
}

/** A link into room `code` for a friend, through CrazyGames. */
export const inviteLink = (code: string): string => sdk().game.inviteLink({ room: code });

let roomShown = "";
/** Tells CrazyGames which room the player is in (its own invite UI uses it), or that they're in none. Each tick; only changes go out. */
export function showRoom(room: { code: string; joinable: boolean } | null): void {
  const key = room ? `${room.code}:${room.joinable}` : "";
  if (key === roomShown) return;
  roomShown = key;
  if (room) sdk().game.updateRoom({ roomId: room.code, isJoinable: room.joinable, inviteParams: { room: room.code } });
  else sdk().game.leftRoom();
}

let playing = false, cheered: object | null = null, loaded = false;
/**
 * The SDK's events, each tick: loading ends when the first screen is up, gameplay runs while a match is on (not
 * paused, not over) or a drawing is being made, and `cheer` (a won match, a finished character) gets one happytime.
 */
export function followPlay(isPlaying: boolean, cheer: object | null): void {
  const game = sdk().game;
  if (!loaded) { loaded = true; game.loadingStop(); }
  if (isPlaying !== playing) { playing = isPlaying; if (isPlaying) game.gameplayStart(); else game.gameplayStop(); }
  if (cheer && cheer !== cheered) { cheered = cheer; game.happytime(); }
}
