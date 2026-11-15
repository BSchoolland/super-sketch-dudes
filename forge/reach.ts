/** Waits between tries when the site can't be reached at all (not when it answers no): about two minutes in all. */
export const UNREACHABLE_WAITS_MS = [2000, 4000, 8000, 16000, 30000, 30000, 30000];

/**
 * A request that never reaches the site (the network or the site blinked) is tried again, logged, after each wait
 * in turn, then once more, throwing if that fails too. Any answer, a refusal included, comes straight back.
 */
export async function reach(go: () => Promise<Response>, what: string, log: (line: string) => void, waits = UNREACHABLE_WAITS_MS): Promise<Response> {
  for (const wait of waits) {
    try { return await go(); } catch (e) {
      log(`${what} didn't reach the site (${e instanceof Error ? e.message : String(e)}), trying again in ${wait / 1000}s`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  return go();
}
