import { site } from "./base";
import { GOOGLE_CLIENT_ID, SESSION_HEADER, type CommunityCharacter, type CommunitySort, type LastPlayed, type Player, type LibraryEntry } from "../../shared/account";
import { sessionTrace } from "./telemetry/events";

/**
 * Who's signed in, remembered in localStorage. Sign-in is Discord's implicit OAuth grant: the
 * browser goes to Discord, comes back to /auth with an access token in the URL fragment, and
 * `finishSignIn` trades it for a session token with the server. Google is the same round trip
 * with an ID token instead. Or an email and password.
 */
export const account: { session: string | null; player: Player | null } = { session: null, player: null };
/**
 * When this player last played before now, and on which version: null for a brand-new player,
 * undefined until the server has been told they're here. Compare with GAME_VERSION for "what's new".
 */
export let lastPlayed: LastPlayed | null | undefined;
const KEY = "sketchbattle.account";
const NONCE_KEY = "sketchbattle.googleNonce";
const PENDING_KEY = "sketchbattle.signingIn";
export const DISCORD_APP_ID = "1506034935838937201";

/** True when a saved session was restored. */
export function loadAccount(): boolean {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (saved?.session && saved?.player) { account.session = saved.session; account.player = saved.player; }
  } catch { /* ignore a bad value */ }
  return signedIn();
}
function save(): void {
  localStorage.setItem(KEY, JSON.stringify({ session: account.session, player: account.player }));
}

export function signedIn(): boolean {
  return !!account.session && !!account.player;
}

const authRedirect = (): string => encodeURIComponent(`${location.origin}${site.base}auth`);

export type OAuthProvider = "discord" | "google";
const PROVIDER_NAME: Record<OAuthProvider, string> = { discord: "Discord", google: "Google" };

/** Where the browser goes to sign in with Discord or Google; it comes back to /auth on this site. */
export function oauthSignInUrl(provider: OAuthProvider): string {
  sessionStorage.setItem(PENDING_KEY, provider);
  if (provider === "discord") return `https://discord.com/oauth2/authorize?client_id=${DISCORD_APP_ID}&response_type=token&redirect_uri=${authRedirect()}&scope=identify`;
  // the ID token comes back bound to a nonce kept for the trip
  const nonce = crypto.randomUUID();
  sessionStorage.setItem(NONCE_KEY, nonce);
  return `https://accounts.google.com/o/oauth2/v2/auth?client_id=${GOOGLE_CLIENT_ID}&response_type=id_token&redirect_uri=${authRedirect()}&scope=openid%20profile&nonce=${nonce}&prompt=select_account`;
}

function takePending(): OAuthProvider | null {
  const provider = sessionStorage.getItem(PENDING_KEY) as OAuthProvider | null;
  sessionStorage.removeItem(PENDING_KEY);
  return provider;
}

/**
 * Why the last trip to Discord or Google came back to this tab without a token (Back from a page a
 * school Chromebook blocks), or null. Asked once: the trip is forgotten.
 */
export function unfinishedSignIn(): string | null {
  const provider = takePending();
  return provider && `${PROVIDER_NAME[provider]} sign-in didn't finish. School Chromebooks often block it: try EMAIL & PASSWORD`;
}

/** Posts credentials to an /auth endpoint and keeps the session it hands back. Throws the server's reason on failure. */
async function authenticate(path: string, body: object): Promise<void> {
  const res = await fetch(`${site.base}api/auth/${path}`, { method: "POST", headers: { "content-type": "application/json", "x-trace-id": sessionTrace() }, body: JSON.stringify(body) });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text.startsWith("{") ? (JSON.parse(text) as { error: string }).error : `sign-in failed: HTTP ${res.status}`);
  }
  const signedInAs = (await res.json()) as { session: string; player: Player; lastPlayed: LastPlayed | null };
  account.session = signedInAs.session; account.player = signedInAs.player;
  lastPlayed = signedInAs.lastPlayed;
  save();
}

/** A restored session opening the game: the server notes this visit and says when the last one was. */
export async function markPlayed(): Promise<void> {
  lastPlayed = (await api<{ lastPlayed: LastPlayed | null }>("/me/played", { method: "POST" })).lastPlayed;
}

/**
 * Back from Discord or Google: the token is in the URL fragment, or the provider's refusal is in the
 * fragment (Google) or query (Discord). Resolves true when a session was made.
 */
export async function finishSignIn(): Promise<boolean> {
  const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
  const query = new URLSearchParams(location.search);
  const accessToken = hash.get("access_token"), idToken = hash.get("id_token");
  const refused = hash.has("error") ? hash : query.has("error") ? query : null;
  const refusal = refused && (refused.get("error_description") ?? refused.get("error"));
  if (!accessToken && !idToken && !refusal) return false;
  const provider = takePending();
  for (const key of ["error", "error_description", "error_uri", "state"]) query.delete(key);
  history.replaceState(null, "", `${site.base}${query.size ? `?${query}` : ""}`);
  if (refusal) throw new Error(`${provider ? PROVIDER_NAME[provider] : "sign-in"} said no: ${refusal}`);
  if (accessToken) await authenticate("discord", { accessToken });
  else {
    const nonce = sessionStorage.getItem(NONCE_KEY);
    sessionStorage.removeItem(NONCE_KEY);
    if (!nonce) throw new Error("sign-in expired, try again");
    await authenticate("google", { idToken, nonce });
  }
  return true;
}

export const emailSignIn = (email: string, password: string): Promise<void> => authenticate("login", { email, password });
export const emailSignUp = (email: string, password: string, name: string): Promise<void> => authenticate("signup", { email, password, name });

/** Local testing only: the server accepts a name when it runs with DEV_LOGIN=1. */
export const devSignIn = (name: string): Promise<void> => authenticate("dev", { name });

export function signOut(): void {
  if (account.session) void fetch(`${site.base}api/auth/logout`, { method: "POST", headers: { [SESSION_HEADER]: account.session, "x-trace-id": sessionTrace() } }).catch((error: unknown) => console.error("sign-out request failed", error));
  account.session = null; account.player = null;
  lastPlayed = undefined;
  localStorage.removeItem(KEY);
}

/** fetch with the session header; throws on HTTP errors so callers never see a half result. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> ?? {}), "x-trace-id": sessionTrace() };
  if (account.session) headers[SESSION_HEADER] = account.session;
  if (init.body && !headers["content-type"]) headers["content-type"] = "application/json";
  const res = await fetch(`${site.base}api${path}`, { ...init, headers });
  if (res.status === 401) { signOut(); throw new Error("signed out"); }
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export const library = {
  list: () => api<{ player: Player; characters: LibraryEntry[] }>("/library"),
  /** `n` random contenders for the brawl, none of `not`; a house fighter comes with no bundleUrl. */
  sample: (n: number, not: string[]) => api<{ characters: { id: string; name: string | null; bundleUrl: string | null }[] }>(`/characters/sample?n=${n}&not=${not.join(",")}`),
  dummy: () => api<{ character: LibraryEntry | null }>("/dummy"),
  remove: (id: string) => api<void>(`/library/${id}`, { method: "DELETE" }),
  setPublic: (id: string, pub: boolean) => api<{ character: LibraryEntry }>(`/library/${id}`, { method: "PATCH", body: JSON.stringify({ public: pub }) }),
  save: (id: string) => api<{ saves: number; saved: boolean }>(`/library/saved/${id}`, { method: "POST" }),
  unsave: (id: string) => api<{ saves: number; saved: boolean }>(`/library/saved/${id}`, { method: "DELETE" }),
  community: (sort: CommunitySort, page: number) => api<{ characters: CommunityCharacter[]; pages: number }>(`/characters/community?sort=${sort}&page=${page}`),
  /** `hint` is what the player typed on the describe page; the forge's design pass reads it. */
  create: (png: string, hint: { name: string; description: string }, pub: boolean) => api<{ character: LibraryEntry }>("/characters", { method: "POST", body: JSON.stringify({ png, ...hint, public: pub }) }),
  get: (id: string) => api<{ character: LibraryEntry }>(`/characters/${id}`),
};
