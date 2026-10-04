import { describe, expect, it } from "vitest";
import { inClassTime } from "../server/school";

// 2026-10-05 is a Monday; Pacific is UTC-7 in October
const pacific = (day: string, hm: string) => new Date(`${day}T${hm}:00-07:00`);

describe("class time", () => {
  it("is 8:15 to 2:45 Pacific on weekdays", () => {
    expect(inClassTime(pacific("2026-10-05", "08:14"))).toBe(false);
    expect(inClassTime(pacific("2026-10-05", "08:15"))).toBe(true);
    expect(inClassTime(pacific("2026-10-05", "12:30"))).toBe(true);
    expect(inClassTime(pacific("2026-10-05", "14:44"))).toBe(true);
    expect(inClassTime(pacific("2026-10-05", "14:45"))).toBe(false);
  });
  it("is never on weekends", () => {
    expect(inClassTime(pacific("2026-10-03", "10:00"))).toBe(false);
    expect(inClassTime(pacific("2026-10-04", "10:00"))).toBe(false);
  });
});
