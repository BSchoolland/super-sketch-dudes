import crypto from "node:crypto";
import { NAME_MAX } from "../shared/account";

/**
 * Player names. A player's name is the game's own: Google sign-ins and guests start with a two-word one picked here,
 * and anyone with an account can type another. It lives in the player's record (library.ts) and is never taken from
 * Google.
 */
// at most 7 + 1 + 6 characters
const ADJECTIVES = ["Brave", "Happy", "Lucky", "Sunny", "Jolly", "Speedy", "Mighty", "Clever", "Fuzzy", "Bouncy", "Sleepy", "Silly", "Zippy", "Cosmic", "Gentle", "Swift", "Bold", "Cheery", "Plucky", "Sparky", "Witty", "Breezy", "Snappy", "Dizzy", "Groovy", "Nimble", "Quiet", "Rapid", "Shiny", "Spicy", "Tiny", "Wild", "Wobbly", "Zesty", "Fancy", "Frosty", "Golden", "Humble", "Jumpy", "Kind", "Mellow", "Noble", "Peppy", "Stormy", "Turbo", "Wacky", "Daring", "Merry", "Proud", "Cozy"];
const ANIMALS = ["Otter", "Panda", "Koala", "Tiger", "Fox", "Owl", "Badger", "Moose", "Gecko", "Llama", "Lemur", "Rhino", "Hippo", "Bison", "Crab", "Duck", "Eagle", "Ferret", "Frog", "Goat", "Hawk", "Heron", "Kiwi", "Lion", "Lynx", "Mole", "Newt", "Orca", "Parrot", "Puffin", "Quail", "Rabbit", "Raven", "Seal", "Shark", "Sloth", "Squid", "Snail", "Toad", "Turtle", "Walrus", "Wombat", "Yak", "Zebra", "Beaver", "Camel", "Dingo", "Donkey", "Gopher", "Pony"];

const pick = (words: string[]): string => words[crypto.randomInt(words.length)];

export const randomName = (): string => `${pick(ADJECTIVES)} ${pick(ANIMALS)}`;

/** What's kept of a typed name: letters, digits, spaces and - . ! ?, up to NAME_MAX. Empty when nothing was. */
export const typedName = (s: unknown): string => String(s ?? "").replace(/[^\w \-.!?]/g, "").trim().slice(0, NAME_MAX).trim();
