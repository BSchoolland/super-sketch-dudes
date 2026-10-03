import type { LibraryEntry } from "../../../shared/account";
import type { MapDoc } from "../../../shared/maps";
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
  /** COMMUNITY: everyone's public characters, to save into your library. */
  community(): Screen;
  /** BATTLE: quick match, a lobby, or bots; `fighter` starts out picked there (a character's FIGHT button). */
  battle(fighter?: FighterChoice): Screen;
  /** PRACTICE: Proving Ground against the practice dummy, which never fights back. */
  practice(fighter: FighterChoice, device: DeviceId): Screen;
  /** MAPS: the player's maps. */
  maps(): Screen;
  /** The editor on `doc`, or on a fresh map. */
  mapEditor(doc: MapDoc | null): Screen;
  /** A bot fight on a map straight from the editor; `back` is the editor to return to. */
  testMap(doc: MapDoc, back: () => Screen): Screen;
}
