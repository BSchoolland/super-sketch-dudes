import { site } from "./base";
import { SESSION_HEADER, type Player, type LibraryEntry } from "../../shared/account";
import { sessionTrace } from "./telemetry/events";

/**
 * Who's signed in, remembered in localStorage. Sign-in is Discord's implicit OAuth grant: the
 * browser goes to Discord, comes back to /auth with an access token in the URL fragment, and
 * `finishSignIn` trades it for a session token with the server.
 */
export const account: { session: string | null; player: Player | null } = { session: null, player: null };
const KEY = "sketchbattle.account";
export const DISCORD_APP_ID = "1506034935838937201";

export function loadAccount(): void {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (saved?.session && saved?.player) { account.session = saved.session; account.player = saved.player; }
  } catch { /* ignore a bad value */ }
}
function save(): void {
  localStorage.setItem(KEY, JSON.stringify({ session: account.session, player: account.player }));
}

export function signedIn(): boolean {
  return !!account.session && !!account.player;
}

/** Where Discord sends the browser to sign in; it comes back to /auth on this site. */
export function discordSignInUrl(): string {
  const redirect = `${location.origin}${site.base}auth`;
  return `https://discord.com/oauth2/authorize?client_id=${DISCORD_APP_ID}&response_type=token&redirect_uri=${encodeURIComponent(redirect)}&scope=identify`;
}

/** Back from Discord: the access token is in the URL fragment. Resolves true when a session was made. */
export async function finishSignIn(): Promise<boolean> {
  const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
  const accessToken = hash.get("access_token");
  if (!accessToken) return false;
  history.replaceState(null, "", `${site.base}${location.search}`);
  const res = await fetch(`${site.base}api/auth/discord`, { method: "POST", headers: { "content-type": "application/json", "x-trace-id": sessionTrace() }, body: JSON.stringify({ accessToken }) });
  if (!res.ok) throw new Error(`sign-in failed: HTTP ${res.status}`);
  const { session, player } = (await res.json()) as { session: string; player: Player };
  account.session = session; account.player = player;
  save();
  return true;
}

/** Local testing only: the server accepts a name when it runs with DEV_LOGIN=1. */
export async function devSignIn(name: string): Promise<void> {
  const res = await fetch(`${site.base}api/auth/dev`, { method: "POST", headers: { "content-type": "application/json", "x-trace-id": sessionTrace() }, body: JSON.stringify({ name }) });
  if (!res.ok) throw new Error(`dev sign-in failed: HTTP ${res.status}`);
  const { session, player } = (await res.json()) as { session: string; player: Player };
  account.session = session; account.player = player;
  save();
}

export function signOut(): void {
  if (account.session) void fetch(`${site.base}api/auth/logout`, { method: "POST", headers: { [SESSION_HEADER]: account.session, "x-trace-id": sessionTrace() } }).catch((error: unknown) => console.error("sign-out request failed", error));
  account.session = null; account.player = null;
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
  everyone: () => api<{ characters: { id: string; name: string | null; bundleUrl: string }[] }>("/characters/everyone"),
  remove: (id: string) => api<void>(`/library/${id}`, { method: "DELETE" }),
  /** `hint` is what the player typed on the describe page; the forge's design pass reads it. */
  create: (png: string, hint: { name: string; description: string }) => api<{ character: LibraryEntry }>("/characters", { method: "POST", body: JSON.stringify({ png, ...hint }) }),
  get: (id: string) => api<{ character: LibraryEntry }>(`/characters/${id}`),
};
