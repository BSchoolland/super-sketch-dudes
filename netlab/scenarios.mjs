// Scenarios recreate real sessions: `replay` is a production match whose stage, slots and fighters the lab reuses,
// `targets` the production matches the lab's numbers are compared against, `net` each player's network profile.

/** @typedef {{ about: string, replay: string, targets: string[], net: Record<string, string> }} Scenario */

/** @type {Record<string, Scenario>} */
export const SCENARIOS = {
  "ben-adrean-kirill": {
    about: "Ben (Windows, home), Adrean (Mac, wifi), Kirill (Windows, spiky wifi): the rough session of 10/4 evening.",
    replay: "m-SDS6-c3825af9",
    targets: ["m-MD5B-431e4a9f", "m-83UP-ae6d7518", "m-83UP-52408d2b", "m-SDS6-d0edaf75", "m-SDS6-e5951353", "m-SDS6-c3825af9"],
    net: { Ben: "home-wifi", AdreanHC: "busy-wifi", Kirill: "spiky-wifi" },
  },
  "ben-adrean-kirill-lan": {
    about: "The same match with no network trouble at all: the floor. Waits here come from the game or the lab, not the network.",
    replay: "m-SDS6-c3825af9",
    targets: [],
    net: { Ben: "lan", AdreanHC: "lan", Kirill: "lan" },
  },
  "alpha-bravo": {
    about: "Alpha and Bravo, 2 players on decent connections, 10/4 night: near zero waiting in production.",
    replay: "m-Q72P-ff399105",
    targets: ["m-9ZZU-032b2168", "m-Q72P-ff399105", "m-Q72P-5a2112a9", "m-3TJP-eab883eb"],
    net: { Alpha: "home-wifi@14", Bravo: "home-wifi@14" },
  },
  "school-3p": {
    about: "Charlie, Delta, Echo on school Chromebooks, 10/2 afternoon: 3 players, a few waits a minute and one multi-second drop.",
    replay: "m-ZND3-f6949129",
    targets: ["m-ZND3-f6949129", "m-ZND3-e993bbd3"],
    net: { Charlie: "school-wifi", Delta: "school-wifi", Echo: "school-wifi" },
  },
  "school-4p": {
    about: "Foxtrot, Golf, Hotel, India, 4 players on the proving map, 10/2 evening: 2-4 s/min frozen in 35-60 short waits a minute.",
    replay: "m-AT3G-98f131bc",
    targets: ["m-AT3G-98f131bc"],
    net: { Foxtrot: "school-wifi", Golf: "school-wifi", Hotel: "school-wifi", India: "school-wifi" },
  },
};

export function scenario(name) {
  const s = SCENARIOS[name];
  if (!s) throw new Error(`unknown scenario ${name}; have ${Object.keys(SCENARIOS).join(", ")}`);
  return s;
}
