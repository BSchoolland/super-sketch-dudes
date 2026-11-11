/**
 * The cheap check a typed name passes before the moderator's judges see it: obvious profanity and slurs, written
 * plainly, in leetspeak (sh1t, b!tch), spaced out (f u c k) or stretched (fuuuck). Anything subtler, and any word
 * with a common ordinary meaning (a garden hoe, a Maine Coon, "negro" in Spanish), is the judges' job: this list
 * only has to be right when it refuses. It reads the name as kept (typedName), which is what anyone would see.
 */

/** Refused anywhere in a word: no ordinary English word contains them (checked against /usr/share/dict; ALLOWED has the few). */
const INSIDE = [
  "fuck", "fck", "shit", "cunt", "nigger", "nigga", "niggr", "faggot", "bitch", "whore", "slut", "jizz", "dildo", "porn",
  "penis", "vagina", "asshole", "dumbass", "jackass", "fatass", "cocksuck", "blowjob", "handjob", "pedophil",
  "paedophil", "wetback", "hitler", "killyourself", "motherf", "retarded",
];
/** Ordinary words with an INSIDE word in them: snigger, niggard, Japanese surnames (Kinoshita), shiitake, penisola, Scunthorpe. */
const ALLOWED = /snigger|niggard|shita|shiitake|penisol|scunthorp/g;
/** Refused only as a whole word: these hide inside ordinary ones (bass, cockpit, therapist, swank, wristwatch, analysis). */
const WHOLE = new Set([
  "ass", "asses", "arse", "fag", "fags", "dick", "dicks", "cock", "cocks", "pussy", "pussies", "cum", "tits", "titty",
  "titties", "boob", "boobs", "sex", "sexy", "anal", "horny", "rape", "raped", "raping", "rapist", "rapists", "pedo",
  "pedos", "molest", "molested", "molester", "molesting", "retard", "retards", "tard", "spic", "spics", "kike", "kikes",
  "gook", "gooks", "tranny", "beaner", "beaners", "nazi", "nazis", "kkk", "kys", "fuk", "nig", "nigs", "piss",
  "testicle", "testicles", "scrotum", "clit", "twat", "twats", "wank", "wanker", "wankers", "wanking",
]);

/** Leetspeak, with 1 read both ways (i and l). */
const LEET: Record<string, string> = { "0": "o", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "9": "g", "!": "i" };

/**
 * The words a name might be hiding: each word (camelCase split too) and each run of one- and two-letter pieces joined
 * up (f u c k, sh it), each also with a letter said three or more times said once and twice (fuuuck, asssss). Separate
 * ordinary words are never joined ("push it" is not "pushit"), and doubled letters stay (shiitake, rapped).
 */
export function nameWords(name: string): string[] {
  const words = new Set<string>();
  for (const one of ["i", "l"]) {
    const pieces = name
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .replace(/[0-9!]/g, (c) => (c === "1" ? one : LEET[c] ?? c))
      .split(/[^a-z]+/).filter(Boolean);
    const joined: string[] = [];
    let run = "";
    for (const p of pieces) {
      if (p.length <= 2) { run += p; continue; }
      if (run) joined.push(run);
      run = "";
      joined.push(p);
    }
    if (run) joined.push(run);
    for (const w of [...pieces, ...joined]) { words.add(w); words.add(w.replace(/(.)\1{2,}/g, "$1")); words.add(w.replace(/(.)\1{2,}/g, "$1$1")); }
  }
  return [...words];
}

/** The listed word a name hides, or null. */
export function badWordIn(name: string): string | null {
  for (const w of nameWords(name)) {
    if (WHOLE.has(w)) return w;
    const clean = w.replace(ALLOWED, "");
    const inside = INSIDE.find((b) => clean.includes(b));
    if (inside) return inside;
  }
  return null;
}
