import { VIEW_W } from "../render/camera";
import { PENCIL } from "../render/paper";
import type { MenuInput } from "../input/devices";
import { consumeTaps } from "../input/pointer";
import { sfx } from "../audio/audio";
import { discordSignInUrl, emailSignIn, emailSignUp } from "../account";
import { bg, card, label, type Screen, INK } from "./ui";
import { RED } from "./draw/character";
import { ButtonMenu, type Button } from "./draw/buttons";
import { TextField } from "./draw/textfield";
import { drawLogo } from "./title";

const DOOR: Button[] = [
  { id: "discord", x: VIEW_W / 2 - 330, y: 560, w: 660, h: 130, text: "SIGN IN WITH DISCORD", size: 46 },
  { id: "email", x: VIEW_W / 2 - 330, y: 720, w: 660, h: 90, text: "EMAIL & PASSWORD", size: 32 },
];
const FIELD_X = VIEW_W / 2 - 420, FIELD_W = 840, FIELD_H = 80, FIELD_GAP = 130, FIELD_TOP = 330;

type Mode = "door" | "signin" | "signup";

/**
 * The way in. Discord sends the browser back with a token that mount() trades for a session;
 * email accounts sign in right here and go straight to `home`.
 */
export class SignInScreen implements Screen {
  t = 0;
  private menu = new ButtonMenu();
  private mode: Mode = "door";
  private fields: { email: TextField; password: TextField; name: TextField | null } | null = null;
  private sending = false;
  private leaving = false;
  private next: Screen | null = null;

  /** `error`: why the last sign-in didn't work. */
  constructor(private home: () => Screen, private error = "") {}

  abandon(): void {
    this.closeForm();
  }

  private buttons(): Button[] {
    if (this.mode === "door") return DOOR;
    const y = FIELD_TOP + (this.mode === "signup" ? 3 : 2) * FIELD_GAP + 10;
    return [
      { id: "submit", x: FIELD_X, y, w: 400, h: 100, text: this.sending ? "…" : this.mode === "signup" ? "CREATE ACCOUNT" : "SIGN IN", size: 34, disabled: this.sending },
      { id: "back", x: FIELD_X + 440, y, w: 400, h: 100, text: "BACK", size: 34, disabled: this.sending },
      { id: "switch", x: FIELD_X, y: y + 130, w: FIELD_W, h: 70, text: this.mode === "signup" ? "HAVE AN ACCOUNT? SIGN IN" : "NEW HERE? CREATE AN ACCOUNT", size: 26, disabled: this.sending },
    ];
  }

  update(dt: number, m: MenuInput): Screen | null {
    this.t += dt;
    if (this.next) { this.closeForm(); return this.next; }
    const pressed = this.menu.update(this.buttons(), m, consumeTaps());
    if (this.mode === "door") {
      if (pressed === "discord" && !this.leaving) { this.leaving = true; location.href = discordSignInUrl(); }
      else if (pressed === "email") this.openForm("signin");
      return null;
    }
    if (pressed === "submit") this.submit();
    else if (pressed === "switch") this.openForm(this.mode === "signup" ? "signin" : "signup");
    else if (pressed === "back" || (m.back && !this.sending)) this.toDoor();
    return null;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    bg(ctx, this.t);
    if (this.mode === "door") {
      drawLogo(ctx, 300);
      this.menu.draw(ctx, DOOR);
      if (this.error) label(ctx, this.error, VIEW_W / 2, 880, 28, RED);
      return;
    }
    drawLogo(ctx, 140);
    const f = this.fields!;
    const rows: [string, TextField][] = [["EMAIL", f.email], ["PASSWORD", f.password]];
    if (f.name) rows.push(["NAME", f.name]);
    rows.forEach(([text, field], i) => {
      const y = FIELD_TOP + i * FIELD_GAP;
      label(ctx, text, FIELD_X, y - 16, 24, PENCIL, "left", 800);
      card(ctx, FIELD_X, y, FIELD_W, FIELD_H, INK, document.activeElement === field.el);
      field.place(FIELD_X + 20, y + 12, FIELD_W - 40, FIELD_H - 24, 36);
    });
    const buttons = this.buttons();
    this.menu.draw(ctx, buttons);
    if (this.error) label(ctx, this.error, VIEW_W / 2, buttons[2].y + buttons[2].h + 60, 28, RED);
  }

  private openForm(mode: "signin" | "signup"): void {
    const email = this.fields?.email.value ?? "", password = this.fields?.password.value ?? "";
    this.closeForm();
    this.mode = mode;
    this.error = "";
    this.menu.focus = 0;
    const back = () => this.toDoor();
    // created in page order so Tab walks the form
    const emailField = new TextField({ type: "email", autocomplete: "email", maxLength: 254, value: email, onSubmit: () => pass.el.focus(), onCancel: back });
    const pass = new TextField({ type: "password", autocomplete: mode === "signup" ? "new-password" : "current-password", maxLength: 200, quiet: true, value: password, onSubmit: () => (name ? name.el.focus() : this.submit()), onCancel: back });
    const name = mode === "signup" ? new TextField({ maxLength: 14, upper: true, quiet: true, onSubmit: () => this.submit(), onCancel: back }) : null;
    this.fields = { email: emailField, password: pass, name };
  }

  private toDoor(): void {
    sfx.menuBack();
    this.closeForm();
    this.mode = "door";
    this.error = "";
    this.menu.focus = 1;
  }

  private closeForm(): void {
    if (!this.fields) return;
    this.fields.email.remove();
    this.fields.password.remove();
    this.fields.name?.remove();
    this.fields = null;
  }

  private submit(): void {
    if (this.sending || !this.fields) return;
    const email = this.fields.email.value.trim(), password = this.fields.password.value;
    const done = this.mode === "signup" ? emailSignUp(email, password, this.fields.name!.value.trim()) : emailSignIn(email, password);
    this.sending = true;
    this.error = "";
    done.then(
      () => { sfx.menuConfirm(); this.next = this.home(); },
      (error: unknown) => {
        console.error("email sign-in failed", error);
        this.error = error instanceof Error ? error.message : String(error);
        this.sending = false;
      },
    );
  }
}
