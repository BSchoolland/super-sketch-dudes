import { api } from "./account";

const PASS_KEY = "sketchbattle.classPass";

/** Whether the server says this is a school Chromebook during class; polled once a minute. */
export const classTime: { blocked: boolean; characters: number | null } = { blocked: false, characters: null };

const check = (pass: string | null) => api<{ blocked: boolean; passed: boolean; characters: number | null }>("/class", pass ? { headers: { "x-class-pass": pass } } : {});

export function watchClassTime(): () => void {
  const poll = () => check(localStorage.getItem(PASS_KEY)).then(
    (r) => { classTime.blocked = r.blocked; if (r.characters !== null) classTime.characters = r.characters; },
    (e: unknown) => console.error("class-time check failed", e),
  );
  void poll();
  const timer = setInterval(poll, 60_000);
  return () => clearInterval(timer);
}

/** Tries a passcode for the class-time block: kept (and the block lifted) only if the server takes it. */
export async function tryClassPass(pass: string): Promise<boolean> {
  const r = await check(pass);
  if (!r.passed) return false;
  localStorage.setItem(PASS_KEY, pass);
  classTime.blocked = r.blocked;
  return true;
}
