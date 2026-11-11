/**
 * The game used to live at bschoolland.dev/sketch-battle/. A page asked for on that host is a small one that sends
 * the browser to the game's home, carrying this browser's game storage (sign-in, settings) in the URL fragment,
 * which never reaches a server; client/src/move.ts takes it in. The API and the relay still answer on the old host
 * for tabs that were open when the game moved.
 */
export const OLD_HOST = "bschoolland.dev";
export const GAME_URL = "https://supersketchdudes.com/play/";

export function oldHostPage(search: string): string {
  const to = JSON.stringify(`${GAME_URL}${search}`);
  return `<!doctype html><meta charset="utf-8"><title>Super Sketch Dudes has moved</title>
<script>
const kept = {};
for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith("sketchbattle.")) kept[k] = localStorage.getItem(k); }
location.replace(${to} + "#carry=" + encodeURIComponent(JSON.stringify(kept)));
</script>
<p>Super Sketch Dudes has moved to <a href=${to}>supersketchdudes.com</a>.</p>`;
}
