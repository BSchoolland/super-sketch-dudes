import { mount } from "./app";
import { takeCarried } from "./move";

// a browser sent here from the game's old host brings its sign-in along in the fragment
const hash = takeCarried(location.hash, localStorage);
if (hash !== location.hash) history.replaceState(null, "", `${location.pathname}${location.search}${hash}`);
// The classic single-build page: one bundle, mounted once. shell.html is the swappable version.
await mount({ canvas: document.getElementById("game") as HTMLCanvasElement, base: import.meta.env.BASE_URL, params: new URLSearchParams(location.search) });
