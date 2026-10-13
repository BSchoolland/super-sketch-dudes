/**
 * The canvas resolution. The backing store shrinks in steps while draws can't keep up with the sim's
 * 60 Hz, and grows back once they can: a slow machine renders softer instead of slower. It scales the
 * device pixel ratio, so a 1x screen gets the same steps as a 2x one. A step down is kept only if draws
 * got faster: a browser holding animation at 30 fps (battery saver) is slow at any resolution.
 */
const SLOW_MS = 20;
const FAST_MS = 17.5;
const STEP = 0.125;
const FLOOR = 0.5;
/** A step down has to cut the median draw interval by this much to stay. */
const MUST_GAIN = 0.85;
/** After a step that didn't help, how long before trying smaller again. */
const NO_GAIN_WAIT = 120_000;

export class FramePacer {
  /** Backing-store pixels per CSS pixel, before devicePixelRatio. */
  quality = 1;
  private lastDraw = -Infinity;
  /** Draw intervals since the last judgement; judged on the median, so hitches don't count. */
  private window: number[] = [];
  /** Loading and the first draws stutter on every machine: judge nothing until a second in. */
  private settledAt: number;
  /** A quality that proved too slow; growing stops below it so the pacer doesn't oscillate. */
  private ceiling = 1;
  /** The step down being judged: the quality before it and the median that made it. */
  private trial: { from: number; median: number } | null = null;
  /** No stepping down before this (a step that didn't help). */
  private noStepDownUntil = 0;

  constructor(private readonly onQuality: (quality: number) => void, start = performance.now()) {
    this.settledAt = start + 1000;
  }

  /** Call on every draw. */
  drew(now: number): void {
    const since = now - this.lastDraw;
    this.lastDraw = now;
    // a hidden tab or a one-off hitch says nothing about steady draw cost
    if (since < 250) this.observe(since, now);
  }

  private observe(interval: number, now: number): void {
    if (now < this.settledAt) return;
    this.window.push(interval);
    if (this.window.length < 60) return;
    const median = this.window.sort((a, b) => a - b)[30];
    this.window.length = 0;
    const trial = this.trial;
    this.trial = null;
    if (trial && median > trial.median * MUST_GAIN) {
      // fewer pixels bought nothing: put them back and leave the size alone for a while
      this.noStepDownUntil = now + NO_GAIN_WAIT;
      this.ceiling = trial.from;
      this.change(trial.from, now);
      return;
    }
    if (median > SLOW_MS && this.quality > FLOOR && now >= this.noStepDownUntil) {
      this.trial = { from: this.quality, median };
      this.ceiling = this.quality - STEP;
      this.change(Math.max(FLOOR, this.quality - STEP), now);
    } else if (median < FAST_MS && this.quality < 1 && now - this.settledAt > 8000) {
      // a step that proved too slow is retried only after a long fast stretch (the tab was busy, a match ended)
      if (this.quality >= this.ceiling && now - this.settledAt > 60000) this.ceiling = 1;
      if (this.quality < this.ceiling) this.change(Math.min(this.ceiling, this.quality + STEP), now);
    }
  }

  private change(quality: number, now: number): void {
    this.quality = quality;
    this.settledAt = now + 500;
    this.onQuality(quality);
  }
}
