/**
 * How often the canvas is painted and at what resolution. A paint is skipped when the last one was
 * under a 75 Hz frame ago (a 144 Hz screen gets every other refresh; the sim only moves at 60), and
 * the backing store shrinks in steps while paints can't keep 50 fps, growing back once they can.
 * A slow machine renders softer instead of slower; the sim and the network never wait on paints.
 */
const MIN_PAINT_MS = 1000 / 75 - 1;
const SLOW_MS = 20;
const FAST_MS = 17.5;
const STEP = 0.125;
const FLOOR = 0.5;

export class FramePacer {
  /** Backing-store pixels per CSS pixel, before devicePixelRatio. */
  quality = 1;
  private lastPaint = -Infinity;
  /** Paint intervals since the last judgement; judged on the median, so hitches don't count. */
  private window: number[] = [];
  /** Loading and the first paints stutter on every machine: judge nothing until a second in. */
  private settledAt = performance.now() + 1000;
  /** A quality that proved too slow; growing stops below it so the pacer doesn't oscillate. */
  private ceiling = 1;

  constructor(private readonly onQuality: (quality: number) => void) {}

  /** Call once per animation frame; true when this frame should paint. Only a frame that may skip is capped. */
  shouldPaint(now: number, mayskip: boolean): boolean {
    const since = now - this.lastPaint;
    if (mayskip && since < MIN_PAINT_MS) return false;
    this.lastPaint = now;
    // a hidden tab or a one-off hitch says nothing about steady paint cost
    if (since < 250) this.observe(since, now);
    return true;
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
