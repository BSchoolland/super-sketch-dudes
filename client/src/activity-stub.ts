import type { ActivitySdk } from "./activity";

/**
 * Discord's side of the Activity, faked for dev builds: `?activity=stub&instance=<launch>&as=<name>`. Its code is
 * only good with a DEV_LOGIN server pointed at a fake Discord (DISCORD_API; scripts/fake-discord.mjs).
 */
export function stubSdk(params: URLSearchParams): ActivitySdk {
  const instance = params.get("instance"), name = params.get("as");
  if (!instance || !name) throw new Error("?activity=stub needs &instance=<launch>&as=<name>");
  return {
    instanceId: `stub-${instance}`,
    platform: params.get("platform") ?? "desktop",
    ready: async () => {},
    commands: { authorize: async () => ({ code: `stub-${name}` }) },
  };
}
