let query: MediaQueryList | null = null;

/** A finger is the main pointer (a phone or tablet): screens lay out for it, with bigger targets and text. */
export function fingers(): boolean {
  query ??= matchMedia("(pointer: coarse)");
  return query.matches;
}
