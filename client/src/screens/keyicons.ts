import { FONT } from "../render/paper";

/** Keyboard player 1's controls as little inked SVG pictures: keycaps and a mouse with one button pressed. */
export type KeyIcon = { key: string } | { space: true } | { mouse: "left" | "right" };

const INK = "#292722", PAPER = "#f4efe4";
const cache = new Map<string, HTMLImageElement>();

function svgFor(icon: KeyIcon): { svg: string; w: number; h: number } {
  const stroke = `stroke="${INK}" stroke-width="3" stroke-linejoin="round"`;
  if ("mouse" in icon) {
    const lit = icon.mouse === "left" ? "M5 28 V20 A15 15 0 0 1 20 5 V28 Z" : "M35 28 V20 A15 15 0 0 0 20 5 V28 Z";
    return {
      w: 40, h: 56,
      svg: `<rect x="5" y="5" width="30" height="46" rx="15" fill="${PAPER}" ${stroke}/>` +
        `<path d="${lit}" fill="${INK}"/><path d="M5 28 H35 M20 5 V28" fill="none" ${stroke}/>`,
    };
  }
  const w = "space" in icon ? 120 : Math.max(48, 20 + icon.key.length * 15);
  const face = "space" in icon
    ? `<path d="M34 30 V36 H86 V30" fill="none" ${stroke}/>`
    : "";
  return { w, h: 48, svg: `<rect x="3" y="3" width="${w - 6}" height="42" rx="7" fill="${PAPER}" ${stroke}/><path d="M7 38 H${w - 7}" stroke="${INK}" stroke-width="1.5" opacity="0.35"/>${face}` };
}

function imageFor(icon: KeyIcon): { img: HTMLImageElement; w: number; h: number } {
  const { svg, w, h } = svgFor(icon);
  const id = JSON.stringify(icon);
  let img = cache.get(id);
  if (!img) {
    img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${svg}</svg>`)}`;
    cache.set(id, img);
  }
  return { img, w, h };
}

/** Draws the icons left to right from (x, y) at `height` tall, with a "+" between them. */
export function drawKeyIcons(ctx: CanvasRenderingContext2D, icons: KeyIcon[], x: number, y: number, height: number): void {
  let cx = x;
  icons.forEach((icon, i) => {
    if (i > 0) {
      ctx.save();
      ctx.fillStyle = INK; ctx.font = `900 ${Math.round(height * 0.5)}px ${FONT}`; ctx.textBaseline = "middle"; ctx.textAlign = "center";
      ctx.fillText("+", cx + height * 0.25, y + height / 2);
      ctx.restore();
      cx += height * 0.5;
    }
    const { img, w, h } = imageFor(icon);
    const k = height / 48;
    if (img.complete) ctx.drawImage(img, cx, y + (height - h * k) / 2, w * k, h * k);
    // the letter goes on with the game's font, which an SVG drawn as an image can't reach
    if ("key" in icon) {
      ctx.save();
      ctx.fillStyle = INK; ctx.font = `900 ${Math.round(height * 0.5)}px ${FONT}`; ctx.textBaseline = "middle"; ctx.textAlign = "center";
      ctx.fillText(icon.key, cx + (w * k) / 2, y + height * 0.46);
      ctx.restore();
    }
    cx += w * k + 4;
  });
}
