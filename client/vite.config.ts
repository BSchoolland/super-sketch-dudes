import { defineConfig } from "vite";
import path from "node:path";
import { execSync } from "node:child_process";

let build = "dev";
try { build = execSync("git rev-parse --short HEAD").toString().trim(); } catch { /* no git */ }
const serverTarget = process.env.SKETCHBATTLE_SERVER ?? "http://localhost:3008";

export default defineConfig({
  root: path.resolve(__dirname),
  base: process.env.SKETCHBATTLE_BASE ?? "/sketch-battle/",
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
      "/sketch-battle/api": { target: serverTarget, rewrite: (p) => p.replace(/^\/sketch-battle/, "") },
      "/sketch-battle/gen": { target: serverTarget },
      "/sketch-battle/games": { target: serverTarget },
      "/sketch-battle/ws": { target: serverTarget, ws: true, rewrite: (p) => p.replace(/^\/sketch-battle/, "") },
    },
  },
});
