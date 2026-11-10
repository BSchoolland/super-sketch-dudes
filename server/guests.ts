import crypto from "node:crypto";
import type { Player } from "../shared/account";
import { forgetPlayer, guestRecords, moveLibrary, starterIds, dummyEntry } from "./library";
import { forgetMaps, moveMaps } from "./maps";
import { forgetForged, hasOpenJobs, moveJobs } from "./forge";
import { moveReputation } from "./moderation";
import { endSessionsOf } from "./auth";

/**
 * Guests: a real player (id `guest-…`) with a name picked here, made on a signed-out browser's first visit so
 * everything works without an account. Signing in moves what a guest made to the account; a guest who stops
 * coming back is deleted by `sweepGuests`.
 */
// at most 7 + 1 + 6 characters: player names are 14 at most
const ADJECTIVES = ["Brave", "Happy", "Lucky", "Sunny", "Jolly", "Speedy", "Mighty", "Clever", "Fuzzy", "Bouncy", "Sleepy", "Silly", "Zippy", "Cosmic", "Gentle", "Swift", "Bold", "Cheery", "Plucky", "Sparky", "Witty", "Breezy", "Snappy", "Dizzy", "Groovy", "Nimble", "Quiet", "Rapid", "Shiny", "Spicy", "Tiny", "Wild", "Wobbly", "Zesty", "Fancy", "Frosty", "Golden", "Humble", "Jumpy", "Kind", "Mellow", "Noble", "Peppy", "Stormy", "Turbo", "Wacky", "Daring", "Merry", "Proud", "Cozy"];
const ANIMALS = ["Otter", "Panda", "Koala", "Tiger", "Fox", "Owl", "Badger", "Moose", "Gecko", "Llama", "Lemur", "Rhino", "Hippo", "Bison", "Crab", "Duck", "Eagle", "Ferret", "Frog", "Goat", "Hawk", "Heron", "Kiwi", "Lion", "Lynx", "Mole", "Newt", "Orca", "Parrot", "Puffin", "Quail", "Rabbit", "Raven", "Seal", "Shark", "Sloth", "Squid", "Snail", "Toad", "Turtle", "Walrus", "Wombat", "Yak", "Zebra", "Beaver", "Camel", "Dingo", "Donkey", "Gopher", "Pony"];

const pick = (words: string[]): string => words[crypto.randomInt(words.length)];

export function newGuest(): Player {
  return { id: `guest-${crypto.randomBytes(9).toString("hex")}`, name: `${pick(ADJECTIVES)} ${pick(ANIMALS)}`, avatar: null };
}

/** The guest `from` signed in as `to`: everything they made is `to`'s and the guest is over. */
export function adoptGuest(from: string, to: Player): { characters: number; saved: number } {
  const moved = moveLibrary(from, to.id);
  moveJobs(from, to);
  moveMaps(from, to);
  moveReputation(from, to.id);
  endSessionsOf(from);
  return moved;
}

/** A guest who made or saved nothing is deleted after this long without playing; one who did, after GUEST_KEEP_DAYS. */
export const GUEST_EMPTY_DAYS = 7, GUEST_KEEP_DAYS = 60;

/** Deletes every guest who hasn't played for long enough: their sessions, record, maps, characters, drawings and forge jobs. */
export function sweepGuests(now: number): { swept: number; kept: string[] } {
  let swept = 0;
  const kept: string[] = [];
  const pinned = new Set([...starterIds(), dummyEntry()?.id]);
  for (const g of guestRecords()) {
    if (now - g.lastPlayed < (g.made ? GUEST_KEEP_DAYS : GUEST_EMPTY_DAYS) * 86_400_000) continue;
    if (hasOpenJobs(g.id) || g.characters.some((id) => pinned.has(id))) { kept.push(g.id); continue; }
    endSessionsOf(g.id);
    forgetMaps(g.id);
    forgetForged(g.id, g.characters);
    moveReputation(g.id, null);
    forgetPlayer(g.id);
    swept++;
  }
  return { swept, kept };
}
