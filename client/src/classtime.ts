import { api } from "./account";

/** Whether the server says this is a school Chromebook during class; polled once a minute. */
export const classTime: { blocked: boolean; characters: number | null } = { blocked: false, characters: null };

export function watchClassTime(): () => void {
  const poll = () => api<{ blocked: boolean; characters: number | null }>("/class").then(
    (r) => { classTime.blocked = r.blocked; if (r.characters !== null) classTime.characters = r.characters; },
    (e: unknown) => console.error("class-time check failed", e),
  );
  void poll();
  const timer = setInterval(poll, 60_000);
  return () => clearInterval(timer);
}
