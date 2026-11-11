import type { CrazyRoom, CrazySdk, CrazyUser } from "./crazygames";

/** What the stub was told, for scripts/crazygamescheck.mjs: `window.__crazygames`. */
export interface StubRecord {
  calls: string[];
  room: CrazyRoom | null;
  /** Accept an invite from CrazyGames' own UI while the game runs. */
  join(params: Record<string, string>): void;
}

/** The stub's own params; everything else on an invite link is the invite's. */
const OWN = ["crazygames", "cgapi", "user", "login", "accounts", "instantJoin", "muteAudio", "czy_invite", "utm_source", "czy_invite_params"];

/** An invite link's params as the real SDK reads them back: its other params, and those packed into czy_invite_params. */
function inviteOf(params: URLSearchParams): Record<string, string> | null {
  if (params.get("czy_invite") !== "true") return null;
  const packed = Object.fromEntries(new URLSearchParams(params.get("czy_invite_params") ?? ""));
  return { ...packed, ...Object.fromEntries([...params].filter(([k]) => !OWN.includes(k))) };
}

/**
 * CrazyGames' side of the CrazyGames build, faked for dev builds: `?crazygames=stub&cgapi=<fake CrazyGames>` (a guest),
 * `&user=<name>` (logged in to CrazyGames), `&login=<name>` (who the login prompt logs in), `&accounts=false`,
 * `&instantJoin=true`, `&muteAudio=true`, and an invite link's `&czy_invite=true&czy_invite_params=room%3D<code>`. Its tokens are only
 * good with a DEV_LOGIN server that trusts the fake's keys (CRAZYGAMES_JWKS; scripts/fake-crazygames.mjs).
 */
export function stubSdk(params: URLSearchParams): CrazySdk {
  const api = params.get("cgapi");
  if (!api) throw new Error("?crazygames=stub needs &cgapi=<fake CrazyGames>");
  let user = params.get("user");
  const authListeners: ((u: CrazyUser | null) => void)[] = [], joinListeners: ((p: Record<string, string>) => void)[] = [];
  const failure = (code: string) => Object.assign(new Error(`stub CrazyGames: ${code}`), { code });
  const asUser = (name: string): CrazyUser => ({ username: name, profilePictureUrl: "" });
  const record: StubRecord = { calls: [], room: null, join: (p) => { for (const fn of joinListeners) fn(p); } };
  (window as unknown as { __crazygames: StubRecord }).__crazygames = record;
  const call = (name: string) => () => { record.calls.push(name); };
  return {
    environment: "crazygames",
    init: async () => {},
    game: {
      loadingStart: call("loadingStart"),
      loadingStop: call("loadingStop"),
      gameplayStart: call("gameplayStart"),
      gameplayStop: call("gameplayStop"),
      happytime: call("happytime"),
      inviteLink: (invite) => {
        const link = new URL(location.pathname, location.origin);
        link.searchParams.set("crazygames", "stub");
        link.searchParams.set("cgapi", api);
        link.searchParams.set("czy_invite", "true");
        link.searchParams.set("utm_source", "invite");
        link.searchParams.set("czy_invite_params", new URLSearchParams(invite).toString());
        return link.href;
      },
      inviteParams: inviteOf(params),
      isInstantMultiplayer: params.get("instantJoin") === "true",
      updateRoom: (room) => { record.calls.push(`updateRoom ${JSON.stringify(room)}`); record.room = room; },
      leftRoom: () => { record.calls.push("leftRoom"); record.room = null; },
      addJoinRoomListener: (fn) => { joinListeners.push(fn); },
      settings: { muteAudio: params.get("muteAudio") === "true", disableChat: false },
      addSettingsChangeListener: () => {},
    },
    user: {
      isUserAccountAvailable: params.get("accounts") !== "false",
      getUserToken: async () => {
        if (!user) throw failure("userNotAuthenticated");
        const r = await fetch(`${api}/token?user=${encodeURIComponent(user)}`);
        if (!r.ok) throw new Error(`the fake CrazyGames wouldn't mint a token: ${r.status} ${await r.text()}`);
        return ((await r.json()) as { token: string }).token;
      },
      showAuthPrompt: async () => {
        if (user) throw failure("userAlreadySignedIn");
        record.calls.push("showAuthPrompt");
        user = params.get("login") ?? "Stub_Player";
        for (const fn of authListeners) fn(asUser(user));
        return asUser(user);
      },
      addAuthListener: (fn) => { authListeners.push(fn); },
    },
  };
}
