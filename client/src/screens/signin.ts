import { VIEW_W } from "../render/camera";
import type { MenuInput } from "../input/devices";
import { consumeTaps } from "../input/pointer";
import { discordSignInUrl } from "../account";
import { bg, label, type Screen } from "./ui";
import { RED } from "./draw/character";
import { ButtonMenu, type Button } from "./draw/buttons";
import { drawLogo } from "./title";

const SIGN_IN: Button = { id: "discord", x: VIEW_W / 2 - 330, y: 560, w: 660, h: 130, text: "SIGN IN WITH DISCORD", size: 46 };

/** The only way in: Discord sends the browser back with a token that mount() trades for a session. */
export class SignInScreen implements Screen {
  t = 0;
  private menu = new ButtonMenu();
  private leaving = false;

  /** `error`: why the last sign-in didn't work. */
  constructor(private error = "") {}

  update(dt: number, m: MenuInput): Screen | null {
    this.t += dt;
    if (!this.leaving && this.menu.update([SIGN_IN], m, consumeTaps()) === "discord") {
      this.leaving = true;
      location.href = discordSignInUrl();
    }
    return null;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    bg(ctx, this.t);
    drawLogo(ctx, 300);
    this.menu.draw(ctx, [SIGN_IN]);
    if (this.error) label(ctx, this.error, VIEW_W / 2, 760, 28, RED);
  }
}
