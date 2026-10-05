import { describe, expect, it } from "vitest";
import { decodeInputs, encodeInputs, encodePing, KIND_PING, MAX_FRAMES, packetKind, pingTime } from "../client/src/net/wire";
import type { InputFrame } from "../shared/input";

const input = (x: number, b = 0): InputFrame => ({ x, y: 50 - Math.trunc(x / 2), cx: 100, cy: -100, b });

describe("peer-to-peer wire format", () => {
  it("round-trips a run of inputs with leads and acks", () => {
    const inputs = [input(0), input(0), input(0), input(-100, 2), input(-100, 2), input(-28, 255), input(37, 256 | 64)];
    const p = { slot: 3, first: 123456, inputs, ahead: [0, -2.5, 12.3, 0], acks: [123000, 0, 99999, 123462] };
    const buf = encodeInputs(p);
    // a 9-byte header, 6 bytes per slot, 7 per run of equal inputs
    expect(buf.byteLength).toBe(9 + 4 * 6 + 4 * 7);
    expect(decodeInputs(buf)).toEqual(p);
  });

  it("splits runs longer than a byte can count", () => {
    const inputs = Array.from({ length: MAX_FRAMES }, () => input(5));
    const p = { slot: 0, first: 1, inputs, ahead: [0, 0], acks: [0, 0] };
    expect(decodeInputs(encodeInputs(p))).toEqual(p);
    expect(() => encodeInputs({ ...p, inputs: [...inputs, input(1)] })).toThrow();
  });

  it("refuses a truncated packet", () => {
    const buf = encodeInputs({ slot: 1, first: 9, inputs: [input(1), input(2)], ahead: [0, 0], acks: [0, 0] });
    expect(() => decodeInputs(buf.slice(0, buf.byteLength - 1))).toThrow();
  });

  it("carries pings", () => {
    const buf = encodePing(KIND_PING, 1234.5);
    expect(packetKind(buf)).toBe(KIND_PING);
    expect(pingTime(buf)).toBe(1234.5);
  });
});
