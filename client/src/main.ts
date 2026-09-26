import { mount } from "./app";

// The classic single-build page: one bundle, mounted once. shell.html is the swappable version.
await mount({ canvas: document.getElementById("game") as HTMLCanvasElement, base: import.meta.env.BASE_URL, params: new URLSearchParams(location.search) });
