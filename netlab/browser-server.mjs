// Runs inside a player container: a Playwright Chromium server the orchestrator drives over the control network,
// while the page's own traffic goes out the shaped game interface.
import { chromium } from "playwright";

const server = await chromium.launchServer({
  host: "0.0.0.0",
  port: 9300,
  wsPath: "pw",
  args: [
    // the relay is plain http on the lab network; give the page the APIs it gets on https in production
    `--unsafely-treat-insecure-origin-as-secure=${process.env.NETLAB_ORIGIN}`,
    "--autoplay-policy=no-user-gesture-required",
  ],
});
console.log(`ready ${server.wsEndpoint()}`);
process.on("SIGTERM", async () => { await server.close(); process.exit(0); });
