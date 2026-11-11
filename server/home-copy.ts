// ===== EVERY WORD ON supersketchdudes.com BESIDES THE GAME'S OWN =====
// The about sections under the game, and the title screen's tab that opens them. Visitors and search engines read all
// of this, the alt text and the meta tags too. Plain text: the page escapes it. Never say "forge" here.

export const HOME_COPY = {
  title: "Super Sketch Dudes: draw any character and battle with it",
  description: "A platform fighter where you draw any character and battle with it. Free in your browser, no download or account needed.",
  ogImageAlt: "Super Sketch Dudes: hand-drawn fighters battling on a sketchbook page",

  tab: "about",

  name: "Super Sketch Dudes",
  pitch: "A platform fighter where you draw any character and battle with it.",
  play: "PLAY",
  playNote: "No download or account needed!",
  clipLabel: "A stick figure with a sword is drawn, turns into a fighter and knocks out another fighter.",

  howTitle: "How it works",
  steps: [
    { title: "1. Draw", text: "Draw any character you can imagine. Stick figures, dragons, superheroes, a walrus...", alt: "The drawing screen with a stick figure holding a sword" },
    { title: "2. It comes to life", text: "In a few minutes it's a fighter with all-new moves and abilities.", alt: "The finished fighter next to the drawing it was made from" },
    { title: "3. Fight", text: "Battle with up to six players online with a room code, or against bots.", alt: "Four hand-drawn fighters in a match" },
  ],

  fightersTitle: "Community favorites",
  fightersNote: "Grab any of these in the game and do battle with them.",

  factsTitle: "Good to know",
  facts: [
    "Sketch super awesome dudes, grab community favorites to do battle with, or figure out how to game the system and make stupidly OP characters to ruin friendships.",
    "It's free. New characters are made by AI, which costs me money, so there's a daily limit on how many you can make. Playing has no limit.",
    "Keyboard, controller or touch all work.",
  ],

  whereTitle: "Where to play",
  where: [
    { title: "In your browser", text: "Right here. Hit PLAY." },
    { title: "In Discord", text: "Start it in a voice channel and everyone in the call ends up in the same room." },
  ],

  privacy: "Privacy",
  terms: "Terms",
} as const;
