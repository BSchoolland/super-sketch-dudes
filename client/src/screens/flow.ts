import type { SlotSource } from "../match";
import { signOut } from "../account";
import { activity } from "../activity";
import { allChoices, forgetLibrary, practiceDummy, refreshLibrary, type FighterChoice } from "../fighters";
import { forgetMaps, refreshMaps } from "../maps";
import { MapsScreen } from "./maps";
import { MapEditorScreen } from "./mapeditor";
import { settings } from "./ui";
import type { Nav } from "./nav";
import type { Screen } from "./ui";
import { TitleScreen } from "./title";
import { SignInScreen } from "./signin";
import { SettingsScreen } from "./settings";
import { FeedbackScreen } from "./classtime";
import { CreateScreen } from "./create";
import { DescribeScreen } from "./describe";
import { ForgeScreen } from "./forging";
import { LibraryScreen } from "./library";
import { CommunityScreen } from "./community";
import { BattleMenuScreen } from "./battle/menu";
import { OnlineScreen } from "./online";
import { StageScreen, type MatchSetup } from "./stage";
import { LoadingScreen } from "./loading";
import { localMatch, type LocalPlayer } from "./localmatch";
import { VersusScreen } from "./versus";

export function signInScreen(nav: Nav, error = ""): Screen {
  return new SignInScreen(() => (activity ? nav.call() : nav.title()), error);
}

/** Every menu path of the signed-in game, from the title down. */
export function menus(): Nav {
  const nav: Nav = {
    title: () => new TitleScreen((mode) => {
      if (mode === "battle") return nav.battle();
      if (mode === "create") return nav.create();
      if (mode === "library") return nav.library();
      if (mode === "maps") return nav.maps();
      if (mode === "feedback") return new FeedbackScreen(() => nav.title());
      return new SettingsScreen(() => nav.title(), () => { signOut(); forgetLibrary(); forgetMaps(); return signInScreen(nav); });
    }, (id) => nav.community(id)),
    create: (pad, hint) => new CreateScreen(nav, pad, hint),
    describe: (pad, hint) => new DescribeScreen(nav, pad, hint),
    forge: (entry) => new ForgeScreen(nav, entry),
    library: () => new LibraryScreen(nav),
    community: (open) => new CommunityScreen(nav, open),
    // the Activity opens here, not on the title screen that fetches these for the website
    call: () => { void refreshLibrary(); void refreshMaps(); return new OnlineScreen(() => nav.title(), "call", null); },
    battle: (fighter) => new BattleMenuScreen((entry) => {
      const menu = () => nav.battle(fighter);
      // VS BOTS is a room like the others: one nobody else can find, started with a bot in it
      return new OnlineScreen(menu, entry, fighter ?? null);
    }, () => nav.title()),
    practice: (you, device) => {
      const dummy = practiceDummy.choice;
      if (!dummy) throw new Error("practice without a dummy");
      const make = (): Screen => {
        const cfg = { stage: "proving", players: [{ fighter: you.id, cpu: 0 }, { fighter: dummy.id, cpu: 0 }], rules: { stocks: 99, time: 0 }, seed: (Math.random() * 0xffffffff) >>> 0 };
        const v = new VersusScreen(cfg, [{ device, cpu: 0 }, { device: null, cpu: 0 }], () => nav.library(), make, true);
        v.renderer.showHitboxes = false;
        return v;
      };
      return new LoadingScreen([you.bundleUrl, dummy.bundleUrl], make, () => nav.library());
    },
    maps: () => new MapsScreen(nav),
    mapEditor: (doc) => new MapEditorScreen(nav, doc),
    testMap: (doc, back) => {
      const { mine, house } = allChoices();
      const you = mine[0] ?? house[0];
      const rival = house.find((h) => h.id !== you.id) ?? house[0];
      const players: LocalPlayer[] = [{ fighter: you, source: { device: "kb1", cpu: 0 } }, { fighter: rival, source: { device: null, cpu: settings.cpuTier } }];
      return localMatch(players, { stage: doc.id, stocks: 3, time: 0, map: doc }, back);
    },
  };

  return nav;
}
