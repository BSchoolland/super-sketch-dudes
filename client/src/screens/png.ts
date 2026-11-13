/**
 * PNG in and out of plain RGBA bytes, so a drawing never goes through canvas readback: privacy settings (Firefox's
 * fingerprinting protection, canvas-blocker add-ons) hand back noise from getImageData and toDataURL.
 */
export interface Pixels { w: number; h: number; data: Uint8ClampedArray<ArrayBuffer> }

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function through(bytes: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
  return out;
}

/** RGBA, 8 bits a channel, each row Sub-filtered (drawings are mostly flat runs). */
export async function encodePng({ w, h, data }: Pixels): Promise<Uint8Array<ArrayBuffer>> {
  const stride = w * 4;
  const raw = new Uint8Array((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    const o = y * (stride + 1), r = y * stride;
    raw[o] = 1;
    for (let i = 0; i < stride; i++) raw[o + 1 + i] = (data[r + i] - (i >= 4 ? data[r + i - 4] : 0)) & 255;
  }
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, w); v.setUint32(4, h);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const parts = [new Uint8Array(SIGNATURE), chunk("IHDR", ihdr), chunk("IDAT", await through(raw, new CompressionStream("deflate"))), chunk("IEND", new Uint8Array())];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

export const isPng = (bytes: Uint8Array): boolean => SIGNATURE.every((b, i) => bytes[i] === b);

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** Non-interlaced 8-bit grey, grey+alpha, palette, RGB or RGBA (what browsers, editors and this pad write); anything else throws. */
export async function decodePng(bytes: Uint8Array): Promise<Pixels> {
  if (!isPng(bytes)) throw new Error("not a PNG");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let w = 0, h = 0, type = -1;
  const idat: Uint8Array[] = [];
  let palette: Uint8Array | null = null, alphas: Uint8Array | null = null;
  for (let at = 8; at < bytes.length;) {
    const len = view.getUint32(at);
    const name = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const body = bytes.subarray(at + 8, at + 8 + len);
    if (name === "IHDR") {
      w = view.getUint32(at + 8); h = view.getUint32(at + 12);
      const depth = body[8], interlace = body[12];
      type = body[9];
      if (depth !== 8 || !(type in CHANNELS) || interlace !== 0) throw new Error(`PNG with depth ${depth}, colour type ${type}, interlace ${interlace} isn't supported`);
    } else if (name === "IDAT") idat.push(body);
    else if (name === "PLTE") palette = body;
    else if (name === "tRNS") alphas = body;
    else if (name === "IEND") break;
    at += 12 + len;
  }
  if (!w || !h) throw new Error("PNG has no IHDR");
  const joined = new Uint8Array(idat.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of idat) { joined.set(p, o); o += p.length; }
  const raw = await through(joined, new DecompressionStream("deflate"));

  const ch = CHANNELS[type], stride = w * ch;
  if (raw.length < (stride + 1) * h) throw new Error(`PNG data is ${raw.length} bytes, ${(stride + 1) * h} expected`);
  const rows = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? rows[dst + i - ch] : 0, b = y ? rows[dst - stride + i] : 0, c = y && i >= ch ? rows[dst - stride + i - ch] : 0;
      let pred: number;
      switch (f) {
        case 0: pred = 0; break;
        case 1: pred = a; break;
        case 2: pred = b; break;
        case 3: pred = (a + b) >> 1; break;
        case 4: { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; break; }
        default: throw new Error(`PNG row ${y} has filter ${f}`);
      }
      rows[dst + i] = (raw[src + i] + pred) & 255;
    }
  }
  const data = new Uint8ClampedArray(w * h * 4);
  if (type === 3) {
    if (!palette) throw new Error("palette PNG has no PLTE");
    for (let i = 0; i < w * h; i++) {
      const e = rows[i];
      data.set(palette.subarray(e * 3, e * 3 + 3), i * 4);
      data[i * 4 + 3] = alphas && e < alphas.length ? alphas[e] : 255;
    }
    return { w, h, data };
  }
  for (let i = 0, j = 0; i < w * h; i++, j += ch) {
    const grey = ch < 3;
    data[i * 4] = rows[j]; data[i * 4 + 1] = rows[grey ? j : j + 1]; data[i * 4 + 2] = rows[grey ? j : j + 2];
    data[i * 4 + 3] = ch === 4 ? rows[j + 3] : ch === 2 ? rows[j + 1] : 255;
  }
  return { w, h, data };
}
