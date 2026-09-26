import type { LibraryEntry } from "../../../shared/account";
import type { FighterChoice } from "../fighters";
import type { DrawPad } from "./draw/pad";
import type { Screen } from "./ui";

/** Where the account screens can go; app.ts builds it so screens don't import each other in a circle. */
export interface Nav {
  title(): Screen;
  /** The creator's pad; `pad` reopens an earlier drawing. */
  create(pad?: DrawPad): Screen;
  /** After the pad: name it and describe it (both optional), then send it to the forge. */
  describe(pad: DrawPad): Screen;
  /** Watching a character the forge is making (or has made); `pad` is kept for TRY AGAIN. */
  forge(entry: LibraryEntry, pad: DrawPad | null): Screen;
  library(): Screen;
  /** Battle setup, with your fighter already chosen if given. */
  battle(fighter?: FighterChoice): Screen;
}
