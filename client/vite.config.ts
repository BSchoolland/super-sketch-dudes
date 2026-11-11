import { defineConfig } from "vite";
import path from "node:path";
import { execSync } from "node:child_process";
import { frontPage } from "../server/home";

let build = "dev";
try { build = execSync("git rev-parse --short HEAD").toString().trim(); } catch { /* no git */ }
const serverTarget = process.env.SKETCHBATTLE_SERVER ?? "http://localhost:3008";

const base = process.env.SKETCHBATTLE_BASE ?? "/";
// the server answers /api and /ws at its root; /gen and /games under the base too
const unbased = (p: string): string => p.slice(base.length - 1);

export default defineConfig({
  root: path.resolve(__dirname),
  base,
  // <base>privacy and <base>terms, as the server serves them
  plugins: [{
    // the server renders the front page from the built index.html; here it has no community strip
    name: "front-page",
    apply: "serve",
    transformIndexHtml: (html, ctx) => (ctx.path === "/index.html" ? frontPage(html, base, []) : html),
  }, {
    name: "legal-pages",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const m = /^([^?]*\/)(privacy|terms)(\?.*)?$/.exec(req.url ?? "");
        if (m && m[1] === base) req.url = `${m[1]}${m[2]}.html${m[3] ?? ""}`;
        next();
      });
    },
  }],
  define: { __BUILD__: JSON.stringify(build) },
  // screen class names go into the session's wide event
  esbuild: { keepNames: true },
  build: {
    outDir: path.resolve(__dirname, "../dist/client"), emptyOutDir: true, target: "es2022",
    rollupOptions: { input: { main: path.resolve(__dirname, "index.html"), shell: path.resolve(__dirname, "shell.html") } },
  },
  server: {
    port: 5175,
    proxy: {
      [`${base}api/`]: { target: serverTarget, rewrite: unbased },
      [`${base}gen/`]: { target: serverTarget },
      [`${base}games/`]: { target: serverTarget },
      [`${base}ws`]: { target: serverTarget, ws: true, rewrite: unbased },
    },
  },
});
