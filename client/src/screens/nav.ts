import type { LibraryEntry } from "../../../shared/account";
import type { FighterChoice } from "../fighters";
import type { DrawPad } from "./pad";
import type { Screen } from "./ui";
import type { DeviceId } from "../input/devices";

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
  /** BATTLE: quick match, a lobby, or bots; `fighter` starts out picked there (a character's FIGHT button). */
  battle(fighter?: FighterChoice): Screen;
  /** PRACTICE: Proving Ground against the practice dummy, which never fights back. */
  practice(fighter: FighterChoice, device: DeviceId): Screen;
}
