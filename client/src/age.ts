/**
 * The birth-date question in front of email signup (only there: Discord and Google have their own age rules). The
 * answer never leaves the browser and isn't kept; a "no" is kept, in localStorage, so a different answer isn't asked
 * for (FTC COPPA FAQ D.7).
 */
export const ACCOUNT_AGE = 13;
const REFUSED_KEY = "sketchbattle.signupRefused";

export interface BirthAnswer { year: number; month?: number; day?: number }
/** Whether the answer makes them ACCOUNT_AGE or older today, or which part of the date decides it. Months are 1-12. */
export type AgeStep = { need: "month" | "day" } | { old: boolean };

export function ageStep(a: BirthAnswer, now: Date): AgeStep {
  const years = now.getFullYear() - a.year;
  if (years !== ACCOUNT_AGE) return { old: years > ACCOUNT_AGE };
  if (a.month === undefined) return { need: "month" };
  const month = now.getMonth() + 1;
  if (a.month !== month) return { old: a.month < month };
  if (a.day === undefined) return { need: "day" };
  return { old: a.day <= now.getDate() };
}

/** Why typed text isn't a birth year, or null. */
export function yearProblem(text: string, now: Date): string | null {
  const y = Number(text);
  return /^\d{4}$/.test(text) && y >= 1900 && y <= now.getFullYear() ? null : "type the year as four digits";
}

export function dayProblem(text: string): string | null {
  const d = Number(text);
  return /^\d{1,2}$/.test(text) && d >= 1 && d <= 31 ? null : "type the day of the month, 1 to 31";
}

export const signupRefused = (storage: Storage): boolean => storage.getItem(REFUSED_KEY) === "1";
export const refuseSignup = (storage: Storage): void => storage.setItem(REFUSED_KEY, "1");
