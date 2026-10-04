import type { SlotSource } from "../match";
import { signOut } from "../account";
import { allChoices, forgetLibrary, practiceDummy, type FighterChoice } from "../fighters";
import { forgetMaps } from "../maps";
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
import { BattleMenuScreen } from "./battle/menu";
import { BotsScreen } from "./battle/bots";
import { OnlineScreen } from "./online";
import { StageScreen, type MatchSetup } from "./stage";
import { LoadingScreen } from "./loading";
import { VersusScreen } from "./versus";

export interface LocalPlayer { fighter: FighterChoice; source: SlotSource }

/** A local match: loads every fighter, then fights; REMATCH replays the same setup with a new seed. */
export function localMatch(players: LocalPlayer[], setup: MatchSetup, exit: () => Screen): Screen {
  const make = (): Screen => {
    const cfg = { stage: setup.stage, players: players.map((p) => ({ fighter: p.fighter.id, cpu: p.source.cpu })), rules: { stocks: setup.stocks, time: setup.time }, seed: (Math.random() * 0xffffffff) >>> 0, ...(setup.map ? { map: setup.map } : {}) };
    return new VersusScreen(cfg, players.map((p) => ({ ...p.source })), exit, make);
  };
  return new LoadingScreen(players.map((p) => p.fighter.bundleUrl), make, exit);
}

export function signInScreen(nav: Nav, error = ""): Screen {
  return new SignInScreen(() => nav.title(), error);
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
    }),
    create: (pad, hint) => new CreateScreen(nav, pad, hint),
    describe: (pad, hint) => new DescribeScreen(nav, pad, hint),
    forge: (entry, pad) => new ForgeScreen(nav, entry, pad),
    library: () => new LibraryScreen(nav),
    battle: (fighter) => new BattleMenuScreen((entry) => {
      const menu = () => nav.battle(fighter);
      if (entry !== "bots") return new OnlineScreen(menu, entry, fighter ?? null);
      const bots: Screen = new BotsScreen(fighter ?? null, ({ you, device, bots: cpus }) => new StageScreen(
        (s) => localMatch([{ fighter: you, source: { device, cpu: 0 } }, ...cpus.map((b) => ({ fighter: b.fighter, source: { device: null, cpu: b.level } }))], s, () => nav.title()),
        () => bots,
      ), menu);
      return bots;
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
