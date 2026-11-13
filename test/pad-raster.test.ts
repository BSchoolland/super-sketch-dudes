import { describe, expect, it } from "vitest";
import { deflateSync } from "node:zlib";
import { decodePng, encodePng } from "../client/src/screens/png";
import { Raster } from "../client/src/screens/raster";
import { fillPixels } from "../client/src/screens/fill";

const PAPER: [number, number, number] = [244, 239, 228], INK: [number, number, number] = [41, 39, 34];

describe("png", () => {
  it("round-trips RGBA exactly", async () => {
    const w = 37, h = 11, data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < data.length; i++) data[i] = (i * 97 + (i >> 3)) & 255;
    const back = await decodePng(await encodePng({ w, h, data }));
    expect(back.w).toBe(w);
    expect(back.h).toBe(h);
    expect(Array.from(back.data)).toEqual(Array.from(data));
  });

  it("reads a palette PNG with transparency", async () => {
    const crcless = (type: string, body: Uint8Array) => {
      // decodePng doesn't check CRCs, so zeros stand in
      const out = new Uint8Array(12 + body.length);
      new DataView(out.buffer).setUint32(0, body.length);
      for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
      out.set(body, 8);
      return out;
    };
    const ihdr = new Uint8Array(13);
    new DataView(ihdr.buffer).setUint32(0, 2); new DataView(ihdr.buffer).setUint32(4, 1);
    ihdr.set([8, 3, 0, 0, 0], 8);
    const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), crcless("IHDR", ihdr), crcless("PLTE", new Uint8Array([255, 0, 0, 0, 0, 255])),
      crcless("tRNS", new Uint8Array([128])), crcless("IDAT", new Uint8Array(deflateSync(Buffer.from([0, 0, 1])))), crcless("IEND", new Uint8Array())];
    const png = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) { png.set(p, at); at += p.length; }
    expect(Array.from((await decodePng(png)).data)).toEqual([255, 0, 0, 128, 0, 0, 255, 255]);
  });
});

describe("raster", () => {
  it("draws a stroke as ink along its path with an antialiased edge, and leaves paper elsewhere", () => {
    const r = new Raster(64);
    r.paper(PAPER);
    r.stroke([10, 32.25, 30, 32.25, 54, 32.25], 8, INK);
    expect(r.pixel(32, 32)).toEqual(INK);
    expect(r.pixel(32, 10)).toEqual(PAPER);
    const edge = r.pixel(32, 36)[0];
    expect(edge).toBeGreaterThan(INK[0]);
    expect(edge).toBeLessThan(PAPER[0]);
  });

  it("paints a dot for a single point", () => {
    const r = new Raster(32);
    r.paper(PAPER);
    r.stroke([16, 16], 6, INK);
    expect(r.pixel(16, 16)).toEqual(INK);
    expect(r.pixel(16, 24)).toEqual(PAPER);
  });

  it("fills a closed ring drawn on it", () => {
    const r = new Raster(64);
    r.paper(PAPER);
    r.stroke([16, 16, 48, 16, 48, 48, 16, 48, 16, 16, 48, 16], 4, INK);
    const px = fillPixels(r.data, 64, 32, 32, [228, 72, 63]);
    expect(px).not.toBeNull();
    r.fill(px!);
    expect(r.pixel(32, 32)).toEqual([228, 72, 63]);
    expect(r.pixel(4, 4)).toEqual(PAPER);
  });

  it("lays a picture scaled to fit, centred", () => {
    const r = new Raster(64);
    r.paper(PAPER);
    const red = new Uint8ClampedArray(32 * 16 * 4);
    for (let i = 0; i < red.length; i += 4) red.set([200, 0, 0, 255], i);
    r.picture({ w: 32, h: 16, data: red });
    expect(r.pixel(32, 32)).toEqual([200, 0, 0]);
    expect(r.pixel(32, 4)).toEqual(PAPER);
  });
});
