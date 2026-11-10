import { arrivalProblem, PARAM_MAX, visitProblem, type Arrival, type VisitSource } from "../../../shared/source";

const VISIT_KEY = "sketchbattle.visit";
const FIRST_KEY = "sketchbattle.firstVisit";

/** `launch`: what opened the page when its URL can't say (the Discord Activity), counted as the `ref`. */
export interface Page { referrer: string; url: string; launch?: string }

/**
 * This tab's arrival and this browser's first one. Each is captured once and read back after, so a
 * page back from Discord or Google keeps the tab's original source. `bad` hears about a stored value
 * that isn't an arrival (it's replaced by this page's).
 */
export function visitSource(page: Page, tab: Storage, browser: Storage, session: string, now: number, bad: (key: string, problem: string) => void): VisitSource {
  const url = new URL(page.url);
  const param = (key: string): string | null => url.searchParams.get(key)?.slice(0, PARAM_MAX) || null;
  const arrival: Arrival = {
    referrer: page.referrer ? new URL(page.referrer).host || null : null,
    ref: page.launch ?? param("ref"),
    utm: { source: param("utm_source"), medium: param("utm_medium"), campaign: param("utm_campaign") },
    landing: url.pathname.slice(0, 200),
    at: now,
  };
  const kept = <T>(store: Storage, key: string, problem: (v: unknown) => string | null, fresh: T): T => {
    const raw = store.getItem(key);
    if (raw !== null) {
      let value: unknown, why: string | null;
      try { value = JSON.parse(raw); why = problem(value); } catch (error) { why = String(error); }
      if (!why) return value as T;
      bad(key, why);
    }
    store.setItem(key, JSON.stringify(fresh));
    return fresh;
  };
  return { visit: kept(tab, VISIT_KEY, visitProblem, { ...arrival, session }), first: kept(browser, FIRST_KEY, arrivalProblem, arrival) };
}
