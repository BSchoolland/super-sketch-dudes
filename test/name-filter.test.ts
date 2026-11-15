import { describe, expect, it } from "vitest";
import { badWordIn, nameWords } from "../server/name-filter";
import { typedName } from "../server/names";

/** The filter reads names as kept, the way anyone would see them. */
const bad = (raw: string) => badWordIn(typedName(raw));

describe("the name filter", () => {
  it("refuses the obvious, however it's written", () => {
    for (const name of ["fuck", "FUCK", "Fuuuuck", "f u c k", "fu ck", "FuckFace", "big_fuck", "sh1t", "5h!t", "b1tch", "BiTcH", "a s s", "ass", "Big Ass", "BigAss", "4ssh0le", "dumb ass", "wh0re", "p0rn", "n1gger", "f4ggot", "Fag", "c u m", "kkk", "kys", "r3tard", "Hitler99", "pussy cat", "fυck", "ѕhіt", "Ｆｕｃｋ", "𝐟𝐮𝐜𝐤", "fúck", "fu\u200Bck", "a$$", "b!tch"]) {
      expect(bad(name), name).not.toBeNull();
    }
  });

  it("splits camelCase, joins spaced-out letters, reads 1 as i and as l, and stretches back", () => {
    expect(nameWords("BigAss")).toEqual(expect.arrayContaining(["big", "ass"]));
    expect(nameWords("f u c k")).toContain("fuck");
    expect(nameWords("sh it")).toContain("shit");
    expect(nameWords("c1it")).toEqual(expect.arrayContaining(["ciit", "clit"]));
    expect(nameWords("asssss")).toContain("ass");
    expect(nameWords("Fuuuuck")).toContain("fuck");
  });

  it("lets ordinary words through, whatever they hide", () => {
    for (const name of [
      "Bass Master", "Classic", "Assassin", "Grass Hole", "Push It", "Wash It", "Shih Tzu", "Scunthorpe", "Cockpit", "Peacock", "Hancock", "Dickens", "Moby", "Therapist",
      "Analysis", "Canal", "Raccoon", "Maine Coon", "Blue Tit", "Titan", "Garden Hoe", "Gato Negro", "Spice", "Sextant", "Sussex", "Cucumber", "Document",
      "Shiitake", "Kinoshita", "Matsushita", "Snigger", "Swanky", "Wristwatch", "Saltwater", "Whittler", "Rapped", "Rapping", "Drape", "Grape", "Scrapes",
      "Nigeria", "Niger", "Pissarro", "Manuscript", "Arsenal", "Parsec", "Cockatoo", "Shuttlecock", "Hitchcock", "Pumpkin", "Butterfly",
      "Brave Otter", "Turbo Wombat", "Dr. Sketch", "xX_Gamer_Xx", "Player1", "Ninja 42", "No Molestar", "Penisola", "Matsuda",
    ]) expect(bad(name), name).toBeNull();
  });

  it("keeps any script, punctuation and emoji, and takes out what hides or spills", () => {
    expect(typedName("Ben's #1 Fan @ SSD :)")).toBe("Ben's #1 Fan @ SSD :)");
    expect(typedName("Кирилл 🔥")).toBe("Кирилл 🔥");
    expect(typedName("ＢＥＮ")).toBe("BEN");
    expect(typedName("Ben\u202Eevil\u200B\u0000")).toBe("Benevil");
    expect(typedName("  lots   of\tspace  ")).toBe("lots of space");
    expect(typedName("Z\u0300\u0301\u0302\u0303ap")).toBe("Z\u0300\u0301ap");
    expect([...typedName("🔥".repeat(40))]).toHaveLength(24);
  });
});
