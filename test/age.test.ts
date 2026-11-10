import { describe, expect, it } from "vitest";
import { ageStep, dayProblem, refuseSignup, signupRefused, yearProblem } from "../client/src/age";

/** 9 June 2026, local time. */
const NOW = new Date(2026, 5, 9, 12);

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return { get length() { return m.size; }, clear: () => m.clear(), getItem: (k) => m.get(k) ?? null, key: (i) => [...m.keys()][i] ?? null, removeItem: (k) => { m.delete(k); }, setItem: (k, v) => { m.set(k, String(v)); } };
}

describe("the email signup age question", () => {
  it("decides from the year alone unless the player turns 13 this year", () => {
    expect(ageStep({ year: 2012 }, NOW)).toEqual({ old: true }); // 14 this year: at least 13 now
    expect(ageStep({ year: 2014 }, NOW)).toEqual({ old: false }); // 12 this year at most
    expect(ageStep({ year: 2013 }, NOW)).toEqual({ need: "month" });
  });

  it("decides from the month unless it's this month, then from the day", () => {
    expect(ageStep({ year: 2013, month: 5 }, NOW)).toEqual({ old: true });
    expect(ageStep({ year: 2013, month: 7 }, NOW)).toEqual({ old: false });
    expect(ageStep({ year: 2013, month: 6 }, NOW)).toEqual({ need: "day" });
    expect(ageStep({ year: 2013, month: 6, day: 9 }, NOW)).toEqual({ old: true }); // the 13th birthday is today
    expect(ageStep({ year: 2013, month: 6, day: 10 }, NOW)).toEqual({ old: false });
    expect(ageStep({ year: 2013, month: 1 }, new Date(2026, 0, 1))).toEqual({ need: "day" });
    expect(ageStep({ year: 2013, month: 12 }, new Date(2026, 11, 31))).toEqual({ need: "day" });
  });

  it("takes only a four-digit year up to this one, and a day of the month", () => {
    expect(yearProblem("2013", NOW)).toBeNull();
    expect(yearProblem("2027", NOW)).not.toBeNull();
    expect(yearProblem("13", NOW)).not.toBeNull();
    expect(yearProblem("", NOW)).not.toBeNull();
    expect(dayProblem("31")).toBeNull();
    expect(dayProblem("0")).not.toBeNull();
    expect(dayProblem("32")).not.toBeNull();
  });

  it("remembers a no, and only that", () => {
    const s = memoryStorage();
    expect(signupRefused(s)).toBe(false);
    refuseSignup(s);
    expect(signupRefused(s)).toBe(true);
    expect(s.length).toBe(1);
    expect(s.getItem(s.key(0)!)).toBe("1");
  });
});
