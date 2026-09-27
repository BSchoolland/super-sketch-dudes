import type { DeviceId } from "../input/devices";
import type { SlotSource } from "../match";
import { signOut } from "../account";
import { forgetLibrary, type FighterChoice } from "../fighters";
import type { BattleKind, Nav } from "./nav";
import type { Screen } from "./ui";
import { TitleScreen } from "./title";
import { SignInScreen } from "./signin";
import { SettingsScreen } from "./settings";
import { DrawScreen } from "./draw/screen";
import { CreateScreen } from "./create";
import { DescribeScreen } from "./describe";
import { ForgeScreen } from "./forging";
import { LibraryScreen } from "./library";
import { PickFighterScreen } from "./battle/fighter";
import { ModeScreen } from "./battle/mode";
import { CpuSetupScreen } from "./battle/cpu";
import { LocalSetupScreen } from "./battle/local";
import { OnlineScreen } from "./online";
import { StageScreen, type MatchSetup } from "./stage";
import { LoadingScreen } from "./loading";
import { VersusScreen } from "./versus";

export interface LocalPlayer { fighter: FighterChoice; source: SlotSource }

/** A local match: loads every fighter, then fights; REMATCH replays the same setup with a new seed. */
export function localMatch(players: LocalPlayer[], setup: MatchSetup, exit: () => Screen): Screen {
  const make = (): Screen => {
    const cfg = { stage: setup.stage, players: players.map((p) => ({ fighter: p.fighter.id, cpu: p.source.cpu })), rules: { stocks: setup.stocks, time: setup.time }, seed: (Math.random() * 0xffffffff) >>> 0 };
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
      if (mode === "draw") return new DrawScreen(() => nav.title());
      if (mode === "create") return nav.create();
      if (mode === "library") return nav.library();
      if (mode === "quick") return nav.battle("online");
      if (mode === "couch") return nav.battle("couch");
      return new SettingsScreen(() => nav.title(), () => { signOut(); forgetLibrary(); return signInScreen(nav); });
    }),
    create: (pad, hint) => new CreateScreen(nav, pad, hint),
    describe: (pad, hint) => new DescribeScreen(nav, pad, hint),
    forge: (entry, pad) => new ForgeScreen(nav, entry, pad),
    library: () => new LibraryScreen(nav),
    battle: (kind, fighter) => fighter ? modes(kind, fighter, null) : new PickFighterScreen((f, from) => modes(kind, f, from), () => nav.title()),
  };

  function modes(kind: BattleKind, you: FighterChoice, from: DeviceId | null): Screen {
    if (kind === "online") return new OnlineScreen(() => nav.title(), you);
    const back = () => nav.battle(kind);
    return new ModeScreen(you, from, kind === "couch" ? ["cpu", "local"] : ["cpu", "local", "online"], (mode, device) => {
      const again = () => modes(kind, you, device);
      if (mode === "online") return new OnlineScreen(() => nav.title(), you);
      if (mode === "cpu") {
        const setup = (): Screen => new CpuSetupScreen(you, (opponent, level) => new StageScreen(
          (s) => localMatch([{ fighter: you, source: { device, cpu: 0 } }, { fighter: opponent, source: { device: null, cpu: level } }], s, () => nav.title()),
          setup,
        ), again);
        return setup();
      }
      const setup = (): Screen => new LocalSetupScreen(you, device, (p1, p2) => new StageScreen(
        (s) => localMatch([{ fighter: p1.fighter, source: { device: p1.device, cpu: 0 } }, { fighter: p2.fighter, source: { device: p2.device, cpu: 0 } }], s, () => nav.title()),
        setup,
      ), again);
      return setup();
    }, back);
  }

  return nav;
}
