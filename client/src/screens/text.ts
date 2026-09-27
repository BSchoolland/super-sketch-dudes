import { FONT } from "./ui";

/** Word-wraps `text` into at most `maxLines` lines no wider than `maxW`; the last kept line ends in "…" if cut. */
export function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number, size: number, maxLines: number, weight = 700): string[] {
  ctx.save();
  ctx.font = `${weight} ${size}px ${FONT}`;
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= maxW || !line) { line = next; continue; }
    lines.push(line);
    line = word;
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    let last = lines[maxLines - 1];
    while (last.length > 1 && ctx.measureText(`${last}…`).width > maxW) last = last.slice(0, -1);
    lines[maxLines - 1] = `${last}…`;
  }
  ctx.restore();
  return lines;
}

export function wrapped(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, size: number, color: string, maxLines = 3, align: CanvasTextAlign = "center", weight = 700): number {
  const lines = wrapLines(ctx, text, maxW, size, maxLines, weight);
  ctx.save();
  ctx.textAlign = align;
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.fillStyle = color;
  lines.forEach((l, i) => ctx.fillText(l, x, y + i * size * 1.15));
  ctx.restore();
  return lines.length * size * 1.15;
}

export function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
