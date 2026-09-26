import type { AppController, MountOptions } from "./app";
import type { Handoff } from "./handoff";

/**
 * The swappable page. Loads the room's game bundle from /games/<hash>/app.js and, when the room
 * switches bundles, stops the running one and mounts the next with the match handed across.
 * The bundle is the whole game; this file is the only part that doesn't change.
 */
const base = import.meta.env.BASE_URL;
const canvas = document.getElementById("game") as HTMLCanvasElement;
const status = document.getElementById("status")!;
const params = new URLSearchParams(location.search);
let app: AppController | null = null;
let css: HTMLLinkElement | null = null;

async function currentHash(): Promise<string> {
  const fromUrl = params.get("game");
  if (fromUrl) return fromUrl;
  const res = await fetch(`${base}api/games/current`);
  if (!res.ok) throw new Error(`no current game bundle (HTTP ${res.status}); push one with scripts/push-game.sh --current`);
  return (await res.json()).hash;
}

async function load(hash: string, resume?: Handoff): Promise<void> {
  status.textContent = `loading ${hash}…`;
  status.hidden = false;
  const url = `${base}games/${hash}/app.js`;
  const mod = (await import(/* @vite-ignore */ url)) as { mount: (o: MountOptions) => Promise<AppController> };
  app?.stop();
  const link = document.createElement("link");
  link.rel = "stylesheet"; link.href = `${base}games/${hash}/style.css`;
  document.head.appendChild(link);
  css?.remove(); css = link;
  app = await mod.mount({ canvas, base, params, hash, resume, swap: (next, handoff) => { void load(next, handoff); } });
  history.replaceState(null, "", `?game=${hash}`);
  status.hidden = true;
}

load(await currentHash()).catch((e) => { status.textContent = String(e); status.hidden = false; console.error(e); });
