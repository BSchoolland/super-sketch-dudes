import { defineConfig } from "vite";
import path from "node:path";
import { execSync } from "node:child_process";

let build = "dev";
try { build = execSync("git rev-parse --short HEAD").toString().trim(); } catch { /* no git */ }

export default defineConfig({
  root: path.resolve(__dirname),
  base: "/ringout/",
  define: { __BUILD__: JSON.stringify(build) },
  build: { outDir: path.resolve(__dirname, "../dist/client"), emptyOutDir: true, target: "es2022" },
  server: {
    port: 5175,
    proxy: {
      "/ringout/api": { target: "http://localhost:3008", rewrite: (p) => p.replace(/^\/ringout/, "") },
      "/ringout/ws": { target: "ws://localhost:3008", ws: true, rewrite: (p) => p.replace(/^\/ringout/, "") },
    },
  },
});
