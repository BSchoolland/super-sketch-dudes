import type { InputFrame } from "../../../shared/input";

/**
 * Binary packets on the peer-to-peer data channels. An input packet is a run of consecutive frames of the
 * sender's inputs, run-length encoded (a held stick repeats for dozens of frames), with the sender's time sync
 * leads and acknowledgements. Little endian:
 *   u8 kind=1, u8 slot, u32 first frame, u16 frame count, u8 slots,
 *   per slot: i16 ahead*10, u32 ack,
 *   runs until count frames: u8 length, i8 x, i8 y, i8 cx, i8 cy, u8 buttons
 * Pings carry the sender's clock and come back unchanged: u8 kind=2|3, f64 ms.
 */
export const KIND_INPUTS = 1, KIND_PING = 2, KIND_PONG = 3;

export interface InputPacket {
  slot: number;
  first: number;
  inputs: InputFrame[];
  ahead: number[];
  acks: number[];
}

const HEADER = 9, PER_SLOT = 6, RUN = 6;
/** Frames per packet; past this a packet could outgrow one UDP datagram, and a fragment lost is the whole packet lost. */
export const MAX_FRAMES = 120;

const sameInput = (a: InputFrame, b: InputFrame): boolean => a.x === b.x && a.y === b.y && a.cx === b.cx && a.cy === b.cy && a.b === b.b;

export function encodeInputs(p: InputPacket): ArrayBuffer {
  if (p.inputs.length < 1 || p.inputs.length > MAX_FRAMES) throw new Error(`input packet of ${p.inputs.length} frames`);
  if (p.ahead.length !== p.acks.length) throw new Error("input packet ahead and acks differ in length");
  const runs: [number, InputFrame][] = [];
  for (const input of p.inputs) {
    const last = runs[runs.length - 1];
    if (last && last[0] < 255 && sameInput(last[1], input)) last[0]++;
    else runs.push([1, input]);
  }
  const buf = new ArrayBuffer(HEADER + p.acks.length * PER_SLOT + runs.length * RUN);
  const v = new DataView(buf);
  v.setUint8(0, KIND_INPUTS);
  v.setUint8(1, p.slot);
  v.setUint32(2, p.first, true);
  v.setUint16(6, p.inputs.length, true);
  v.setUint8(8, p.acks.length);
  let o = HEADER;
  for (let s = 0; s < p.acks.length; s++) {
    v.setInt16(o, Math.max(-32768, Math.min(32767, Math.round(p.ahead[s] * 10))), true);
    v.setUint32(o + 2, Math.max(0, p.acks[s]), true);
    o += PER_SLOT;
  }
  for (const [n, input] of runs) {
    v.setUint8(o, n);
    v.setInt8(o + 1, input.x);
    v.setInt8(o + 2, input.y);
    v.setInt8(o + 3, input.cx);
    v.setInt8(o + 4, input.cy);
    v.setUint8(o + 5, input.b);
    o += RUN;
  }
  return buf;
}

export function decodeInputs(buf: ArrayBuffer): InputPacket {
  const v = new DataView(buf);
  if (buf.byteLength < HEADER || v.getUint8(0) !== KIND_INPUTS) throw new Error("not an input packet");
  const slot = v.getUint8(1), first = v.getUint32(2, true), count = v.getUint16(6, true), slots = v.getUint8(8);
  if (count < 1 || count > MAX_FRAMES || slots > 4) throw new Error(`input packet with ${count} frames for ${slots} slots`);
  const ahead: number[] = [], acks: number[] = [];
  let o = HEADER;
  for (let s = 0; s < slots; s++) {
    ahead.push(v.getInt16(o, true) / 10);
    acks.push(v.getUint32(o + 2, true));
    o += PER_SLOT;
  }
  const inputs: InputFrame[] = [];
  while (inputs.length < count) {
    if (o + RUN > buf.byteLength) throw new Error("input packet cut short");
    const n = v.getUint8(o);
    if (n < 1 || inputs.length + n > count) throw new Error("input packet run overflows its frame count");
    const input = { x: v.getInt8(o + 1), y: v.getInt8(o + 2), cx: v.getInt8(o + 3), cy: v.getInt8(o + 4), b: v.getUint8(o + 5) };
    for (let k = 0; k < n; k++) inputs.push({ ...input });
    o += RUN;
  }
  if (o !== buf.byteLength) throw new Error("input packet has trailing bytes");
  return { slot, first, inputs, ahead, acks };
}

export function encodePing(kind: typeof KIND_PING | typeof KIND_PONG, ms: number): ArrayBuffer {
  const buf = new ArrayBuffer(9);
  const v = new DataView(buf);
  v.setUint8(0, kind);
  v.setFloat64(1, ms, true);
  return buf;
}

export function packetKind(buf: ArrayBuffer): number {
  return buf.byteLength ? new DataView(buf).getUint8(0) : 0;
}

export function pingTime(buf: ArrayBuffer): number {
  if (buf.byteLength !== 9) throw new Error("ping packet of the wrong size");
  return new DataView(buf).getFloat64(1, true);
}
