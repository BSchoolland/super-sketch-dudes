/**
 * Where a visitor came from, on the page session's wide event as `business.source`: this tab's
 * arrival (kept in sessionStorage, so it outlives the trip to Discord or Google and back) and
 * this browser's first-ever arrival (localStorage).
 */
export interface Arrival {
  /** The referring page's host, never its full URL. */
  referrer: string | null;
  ref: string | null;
  utm: { source: string | null; medium: string | null; campaign: string | null };
  landing: string;
  at: number;
}
/** `session`: the page session this tab arrived in, which later sessions in the tab (back from sign-in) share. */
export interface VisitSource { visit: Arrival & { session: string }; first: Arrival }

export const PARAM_MAX = 100;
const HOST_RE = /^[a-z0-9._\-[\]:]{1,260}$/i;
const SESSION_RE = /^s-[\w-]{1,62}$/;

const isParam = (v: unknown): boolean => v === null || (typeof v === "string" && v.length > 0 && v.length <= PARAM_MAX);

/** Why a value isn't an Arrival, or null when it is one. */
export function arrivalProblem(v: unknown): string | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return "not an object";
  const a = v as Record<string, unknown>;
  if (a.referrer !== null && (typeof a.referrer !== "string" || !HOST_RE.test(a.referrer))) return "referrer is not a host";
  if (!isParam(a.ref)) return "bad ref";
  const utm = a.utm as Record<string, unknown> | null;
  if (!utm || typeof utm !== "object" || Array.isArray(utm)) return "bad utm";
  for (const k of ["source", "medium", "campaign"]) if (!isParam(utm[k])) return `bad utm.${k}`;
  if (typeof a.landing !== "string" || !a.landing.startsWith("/") || a.landing.length > 200 || /[?#]/.test(a.landing)) return "landing is not a path";
  if (typeof a.at !== "number" || !Number.isFinite(a.at)) return "bad at";
  return null;
}

export function visitProblem(v: unknown): string | null {
  return arrivalProblem(v) ?? (SESSION_RE.test(String((v as { session?: unknown }).session)) ? null : "bad session");
}

export function sourceProblem(v: unknown): string | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return "not an object";
  const s = v as { visit: unknown; first: unknown };
  const visit = visitProblem(s.visit);
  if (visit) return `visit: ${visit}`;
  const first = arrivalProblem(s.first);
  return first && `first: ${first}`;
}

/** The name a funnel buckets an arrival under: the link's own tag first, then the referring host. */
export function sourceLabel(a: Arrival): string {
  return a.ref ?? a.utm.source ?? a.referrer ?? "(direct)";
}
