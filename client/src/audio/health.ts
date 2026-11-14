import { running } from "./engine";
import { sessionList } from "../telemetry/events";

/**
 * Notes, on the session event, when the audio clock falls behind the wall clock: the device couldn't render sound in
 * time, which a player hears as the whole mix stuttering. Also the context's rate, latency and state changes.
 */
const EVERY_MS = 1000;
/** Audio that advanced less than this share of the wall time it had is a stall. */
const BEHIND = 0.8;

/** Returns the stop. */
export function watchAudio(screen: () => string): () => void {
  let ctx: AudioContext | null = null;
  let lastAudio = 0, lastWall = 0;
  const t = () => Math.round(performance.now() / 100) / 10;
  const timer = setInterval(() => {
    const m = running();
    const now = performance.now();
    if (!m || document.hidden) { lastWall = 0; return; }
    if (m.c !== ctx) {
      ctx = m.c;
      sessionList("audio", ["ctx", ctx.sampleRate, ctx.baseLatency, (ctx as AudioContext & { outputLatency?: number }).outputLatency ?? null, t()], 40);
      ctx.addEventListener("statechange", () => sessionList("audio", ["state", ctx!.state, screen(), t()], 40));
    }
    const audio = m.c.currentTime;
    if (lastWall) {
      const wall = (now - lastWall) / 1000, heard = audio - lastAudio;
      if (heard < wall * BEHIND) {
        sessionList("audio", ["stall", screen(), Math.round(heard * 1000), Math.round(wall * 1000), t()], 40);
      }
    }
    lastAudio = audio; lastWall = now;
  }, EVERY_MS);
  return () => clearInterval(timer);
}
