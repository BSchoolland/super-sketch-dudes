import type { LibraryEntry } from "../../../shared/account";
import type { FighterChoice } from "../fighters";
import type { DrawPad } from "./draw/pad";
import type { Screen } from "./ui";

export type BattleKind = "online" | "couch" | "any";
export interface CharacterHint { name: string; description: string }

/** Where the account screens can go; app.ts builds it so screens don't import each other in a circle. */
export interface Nav {
  title(): Screen;
  /** The creator's pad; `pad` reopens an earlier drawing, `hint` what was typed about it so far. */
  create(pad?: DrawPad, hint?: CharacterHint): Screen;
  /** After the pad: name it and describe it (both optional), then create it. */
  describe(pad: DrawPad, hint?: CharacterHint): Screen;
  /** Watching a character the forge is making (or has made); `pad` is kept for TRY AGAIN. */
  forge(entry: LibraryEntry, pad: DrawPad | null): Screen;
  library(): Screen;
  /**
   * Battle setup: "online" is QUICK BATTLE, "couch" is COUCH CO-OP (a friend here or bots), "any"
   * offers all three (a character's own FIGHT button). Your fighter can be chosen already.
   */
  battle(kind: BattleKind, fighter?: FighterChoice): Screen;
}
