/**
 * The canvas resolution. The backing store shrinks in steps while draws can't keep up with the sim's
 * 60 Hz, and grows back once they can: a slow machine renders softer instead of slower. It scales the
 * device pixel ratio, so a 1x screen gets the same steps as a 2x one.
 */
const SLOW_MS = 20;
const FAST_MS = 17.5;
const STEP = 0.125;
const FLOOR = 0.5;

export class FramePacer {
  /** Backing-store pixels per CSS pixel, before devicePixelRatio. */
  quality = 1;
  private lastDraw = -Infinity;
  /** Draw intervals since the last judgement; judged on the median, so hitches don't count. */
  private window: number[] = [];
  /** Loading and the first draws stutter on every machine: judge nothing until a second in. */
  private settledAt = performance.now() + 1000;
  /** A quality that proved too slow; growing stops below it so the pacer doesn't oscillate. */
  private ceiling = 1;

  constructor(private readonly onQuality: (quality: number) => void) {}

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
    if (median > SLOW_MS && this.quality > FLOOR) {
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
