import { defineConfig } from "vite";
import path from "node:path";
import { execSync } from "node:child_process";

// The swappable build: the whole game as one ES module (+ style.css) that shell.html mounts
// from /games/<hash>/. Assets resolve relative to the module; the site's /api and /ws come
// from the base the shell passes to mount().
let build = "dev";
try { build = execSync("git rev-parse --short HEAD").toString().trim(); } catch { /* no git */ }

export default defineConfig({
  root: path.resolve(__dirname),
  base: "./",
  define: { __BUILD__: JSON.stringify(build) },
  // screen class names go into the session's wide event
  esbuild: { keepNames: true },
  build: {
    outDir: path.resolve(__dirname, "../dist/game"),
    emptyOutDir: true,
    target: "es2022",
    lib: { entry: path.resolve(__dirname, "src/app.ts"), formats: ["es"], fileName: () => "app.js" },
    cssCodeSplit: false,
    copyPublicDir: false,
    rollupOptions: { output: { assetFileNames: "[name][extname]" } },
  },
});
