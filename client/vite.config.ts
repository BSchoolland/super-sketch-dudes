import { defineConfig } from "vite";
import path from "node:path";
import { execSync } from "node:child_process";

let build = "dev";
try { build = execSync("git rev-parse --short HEAD").toString().trim(); } catch { /* no git */ }
const serverTarget = process.env.RINGOUT_SERVER ?? "http://localhost:3008";

export default defineConfig({
  root: path.resolve(__dirname),
  base: "/ringout/",
  define: { __BUILD__: JSON.stringify(build) },
  build: { outDir: path.resolve(__dirname, "../dist/client"), emptyOutDir: true, target: "es2022" },
  server: {
    port: 5175,
    proxy: {
      "/ringout/api": { target: serverTarget, rewrite: (p) => p.replace(/^\/ringout/, "") },
      "/ringout/ws": { target: serverTarget, ws: true, rewrite: (p) => p.replace(/^\/ringout/, "") },
    },
  },
});
