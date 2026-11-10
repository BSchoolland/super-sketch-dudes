import { DISCORD_APP_ID } from "../../shared/account";

/**
 * The game running as a Discord Activity: inside Discord's iframe on <app id>.discordsays.com, where every request
 * goes through Discord's proxy and WebRTC doesn't work. Only what the game uses of the Embedded App SDK.
 */
export interface ActivitySdk {
  instanceId: string;
  platform: string;
  ready(): Promise<void>;
  commands: { authorize(args: { client_id: string; response_type: "code"; state: string; prompt: "none"; scope: "identify"[] }): Promise<{ code: string }> };
}

export interface Activity {
  /** The launch everyone in the voice channel shares, as an opaque digest: the instance id itself names the server and channel. */
  key: string;
  platform: string;
}

/** Set once mount has Discord's handshake: this page is the Activity. */
export let activity: Activity | null = null;
let sdk: ActivitySdk | null = null;

export type ActivityLaunch = "discord" | "stub";

/**
 * Whether this page was launched as the Activity: Discord's launch parameters on its proxy domain, or (dev builds
 * only) `?activity=stub&instance=<any>&as=<name>`, which plays the Activity against a fake Discord.
 */
export function activityLaunch(params: URLSearchParams, host: string, dev: boolean): ActivityLaunch | null {
  if (host.endsWith(".discordsays.com") && params.has("frame_id") && params.has("instance_id") && params.has("platform")) return "discord";
  if (dev && params.get("activity") === "stub") return "stub";
  return null;
}

/** Hex SHA-256 of the instance id, cut to 128 bits. */
export async function instanceKey(instanceId: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(instanceId)));
  return [...digest.slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Loads the SDK (the website never does) and waits for Discord's handshake. */
export async function startActivity(launch: ActivityLaunch, params: URLSearchParams): Promise<Activity> {
  if (launch === "discord") {
    const { DiscordSDK } = await import("@discord/embedded-app-sdk");
    sdk = new DiscordSDK(DISCORD_APP_ID);
  } else if (import.meta.env.DEV) sdk = (await import("./activity-stub")).stubSdk(params);
  else throw new Error("the stub Discord is only in dev builds");
  await sdk.ready();
  activity = { key: await instanceKey(sdk.instanceId), platform: sdk.platform };
  return activity;
}

/** A one-time code for the server to trade for this player; silent after the first launch's consent. */
export async function discordCode(): Promise<string> {
  if (!sdk) throw new Error("Discord sign-in outside the Activity");
  const { code } = await sdk.commands.authorize({ client_id: DISCORD_APP_ID, response_type: "code", state: "", prompt: "none", scope: ["identify"] });
  return code;
}
