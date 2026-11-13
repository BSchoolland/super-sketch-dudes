import type { LibraryEntry } from "../../../shared/account";
import { FORGE_STEPS } from "../../../shared/forge-steps";
import { serverNow } from "../account";
import { everywhere } from "../telemetry/events";

/** A typical forge from claim to done, in seconds. */
const TOTAL_S = FORGE_STEPS.reduce((t, s) => t + s.s, 0);

/** Each step's share of the bar: it starts where the steps before it typically add up to. */
const SPANS = FORGE_STEPS.map((step, i) => {
  const before = FORGE_STEPS.slice(0, i).reduce((t, s) => t + s.s, 0);
  return { stage: step.stage, label: step.label, s: step.s, start: before / TOTAL_S, end: (before + step.s) / TOTAL_S };
});

/**
 * How much of a step `x` (its elapsed time over its typical time) has filled: in step with the clock until
 * 85%, then easing on toward the step's end without reaching it, so a long step slows but never stops.
 */
const filled = (x: number): number => x <= 0.85 ? x : 1 - 0.15 * Math.exp(-(x - 0.85) / 0.6);

export interface ForgeProgress {
  label: string;
  /** 0..1 of the bar. */
  done: number;
  /** Seconds it likely has left; null while it waits in line (no honest guess). */
  etaS: number | null;
}

/**
 * Where a queued or forging character is, from its stage and when the server says it got there: the same
 * on every page and every visit.
 */
export function forgeProgress(e: Pick<LibraryEntry, "status" | "stage" | "stageAt">): ForgeProgress {
  const step = SPANS.find((s) => s.stage === e.stage);
  if (!step) { unknownStage(e.stage); return { label: e.stage, done: 0, etaS: null }; }
  if (e.status === "queued" || step.s === 0) return { label: step.label, done: 0, etaS: null };
  if (e.stageAt === undefined) throw new Error(`forging character at "${e.stage}" has no stageAt`);
  const x = Math.max(0, (serverNow() - e.stageAt) / 1000 / step.s);
  const after = (1 - step.end) * TOTAL_S;
  return { label: step.label, done: step.start + (step.end - step.start) * filled(x), etaS: after + step.s * (1 - filled(x)) };
}

/** A stage this page has no step for (the worker is newer than the page): reported once, shown as it came. */
const reported = new Set<string>();
function unknownStage(stage: string): void {
  if (reported.has(stage)) return;
  reported.add(stage);
  everywhere("warn", "forge-stage", `no step for forge stage "${stage}"`);
}

/** An ETA in words: "about 3 min left", "less than a minute left". */
export function etaWords(s: number): string {
  return s < 60 ? "less than a minute left" : `about ${Math.round(s / 60)} min left`;
}
