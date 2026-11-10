import { VIEW_H, VIEW_W } from "../render/camera";
import { PENCIL } from "../render/paper";
import type { MenuInput } from "../input/devices";
import { consumeTaps } from "../input/pointer";
import { sfx } from "../audio/audio";
import { activitySignIn, emailSignIn, emailSignUp, oauthSignInUrl } from "../account";
import { activity, discordCode } from "../activity";
import { ACCOUNT_AGE, ageStep, dayProblem, refuseSignup, signupRefused, yearProblem, type BirthAnswer } from "../age";
import { sessionList } from "../telemetry/events";
import { bg, card, label, title, type Screen, INK } from "./ui";
import { RED } from "./character";
import { ButtonMenu, type Button } from "./buttons";
import { TextField } from "./textfield";
import { drawLegalLinks, drawLogo } from "./title";

const DOOR: Button[] = [
  { id: "discord", x: VIEW_W / 2 - 330, y: 530, w: 660, h: 110, text: "SIGN IN WITH DISCORD", size: 42 },
  { id: "google", x: VIEW_W / 2 - 330, y: 665, w: 660, h: 110, text: "SIGN IN WITH GOOGLE", size: 42 },
  { id: "email", x: VIEW_W / 2 - 330, y: 800, w: 660, h: 80, text: "EMAIL & PASSWORD", size: 30 },
];
const BACK: Button = { id: "back", x: 40, y: VIEW_H - 140, w: 240, h: 90, text: "BACK", size: 40 };
/** On the website a guest can go back to playing. */
const WEB_DOOR: Button[] = [...DOOR, BACK];
/** Inside the Discord Activity the page can't leave for Discord or Google: DISCORD asks the Discord client again. */
const ACTIVITY_DOOR: Button[] = [DOOR[0], { ...DOOR[2], y: DOOR[1].y }];
const FIELD_X = VIEW_W / 2 - 420, FIELD_W = 840, FIELD_H = 80, FIELD_GAP = 130, FIELD_TOP = 330;
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const AGE_FIELD = { x: VIEW_W / 2 - 200, y: 330, w: 400, h: 96 };
const MONTH_TOP = 560, MONTH_W = 200, MONTH_H = 80, MONTH_GAP = 24;
const DAY_FIELD = { ...AGE_FIELD, y: 600 };

/** `age`: the birth date email signup asks first; `under`: the answer said too young, now and from then on in this browser. */
type Mode = "door" | "signin" | "age" | "under" | "signup";

/**
 * The way in. Discord and Google send the browser back with a token that mount() trades for a session;
 * email accounts sign in right here and go straight to `home`. On the website BACK goes `home` too, as the guest.
 */
export class SignInScreen implements Screen {
  t = 0;
  private menu = new ButtonMenu();
  private mode: Mode = "door";
  private fields: { email: TextField; password: TextField; name: TextField | null } | null = null;
  /** The birth date so far, while it's being asked; never sent anywhere. Past the year, the year is fixed (BACK starts over). */
  private birth: { ask: "year" | "month" | "day"; year: TextField; month: number | null; day: TextField | null } | null = null;
  private sending = false;
  private next: Screen | null = null;

  /** `error`: why the last sign-in didn't work. */
  constructor(private home: () => Screen, public error = "") {}

  abandon(): void {
    this.closeForm();
  }

  private buttons(): Button[] {
    if (this.mode === "door") return activity ? ACTIVITY_DOOR : WEB_DOOR;
    if (this.mode === "under") return [activity ? { ...BACK, x: VIEW_W / 2 - 120 } : { id: "play", x: VIEW_W / 2 - 250, y: 720, w: 500, h: 110, text: "KEEP PLAYING", size: 44 }];
    if (this.mode === "age") {
      const months = this.birth!.ask === "month";
      return [
        ...(months ? MONTHS.map((text, i) => ({
          id: `month${i + 1}`, x: VIEW_W / 2 - (6 * MONTH_W + 5 * MONTH_GAP) / 2 + (i % 6) * (MONTH_W + MONTH_GAP), y: MONTH_TOP + Math.floor(i / 6) * (MONTH_H + MONTH_GAP), w: MONTH_W, h: MONTH_H, text, size: 32,
        })) : [{ id: "next", x: VIEW_W / 2 - 420, y: 800, w: 400, h: 100, text: "NEXT", size: 34 }]),
        { id: "back", x: months ? VIEW_W / 2 - 200 : VIEW_W / 2 + 20, y: 800, w: 400, h: 100, text: "BACK", size: 34 },
      ];
    }
    const signup = this.mode === "signup";
    const y = FIELD_TOP + (signup ? 3 : 2) * FIELD_GAP + 10;
    return [
      { id: "submit", x: FIELD_X, y, w: 400, h: 100, text: this.sending ? "…" : signup ? "CREATE ACCOUNT" : "SIGN IN", size: 34, disabled: this.sending },
      { id: "back", x: FIELD_X + 440, y, w: 400, h: 100, text: "BACK", size: 34, disabled: this.sending },
      { id: "switch", x: FIELD_X, y: y + 130, w: FIELD_W, h: 70, text: signup ? "HAVE AN ACCOUNT? SIGN IN" : "NEW HERE? CREATE AN ACCOUNT", size: 26, disabled: this.sending },
    ];
  }

  update(dt: number, m: MenuInput): Screen | null {
    this.t += dt;
    if (this.next) { this.closeForm(); return this.next; }
    const pressed = this.menu.update(this.buttons(), m, consumeTaps());
    if (this.mode === "door") {
      if (pressed) sessionList("signIn", pressed);
      if (pressed === "discord" && activity) { if (!this.sending) this.signInWith(discordCode().then(activitySignIn)); }
      else if (pressed === "discord" || pressed === "google") location.href = oauthSignInUrl(pressed);
      else if (pressed === "email") this.openForm("signin");
      else if (!activity && !this.sending && (pressed === "back" || m.back)) { sfx.menuBack(); return this.home(); }
      return null;
    }
    if (this.mode === "under") {
      if (pressed === "play" || (!activity && m.back)) { sfx.menuBack(); this.closeForm(); return this.home(); }
      if (pressed === "back" || m.back) this.toDoor();
      return null;
    }
    if (this.mode === "age") {
      if (pressed?.startsWith("month")) { this.birth!.month = Number(pressed.slice(5)); this.answer(); }
      else if (pressed === "next") this.answer();
      else if (pressed === "back" || m.back) this.toDoor();
      return null;
    }
    if (pressed === "submit") this.submit();
    else if (pressed === "switch") { if (this.mode === "signup") this.openForm("signin"); else this.askAge(); }
    else if (pressed === "back" || (m.back && !this.sending)) this.toDoor();
    return null;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    bg(ctx, this.t);
    if (this.mode === "door") {
      drawLogo(ctx, 300);
      this.menu.draw(ctx, this.buttons());
      if (this.error) label(ctx, this.error, VIEW_W / 2, 940, 28, RED);
      if (!activity) drawLegalLinks(ctx, !this.sending);
      return;
    }
    if (this.mode === "under") {
      drawLogo(ctx, 220);
      title(ctx, `ACCOUNTS ARE FOR ${ACCOUNT_AGE} AND UP`, VIEW_W / 2, 480, 64, INK);
      if (!activity) {
        label(ctx, "You can keep playing as a guest: fight, draw characters, play online.", VIEW_W / 2, 570, 34, INK);
        label(ctx, "What you make stays yours on this browser.", VIEW_W / 2, 620, 34, INK);
      }
      this.menu.draw(ctx, this.buttons());
      return;
    }
    if (this.mode === "age") {
      const b = this.birth!;
      drawLogo(ctx, 140);
      title(ctx, "WHAT YEAR WERE YOU BORN?", VIEW_W / 2, AGE_FIELD.y - 40, 48, INK);
      card(ctx, AGE_FIELD.x, AGE_FIELD.y, AGE_FIELD.w, AGE_FIELD.h, INK, document.activeElement === b.year.el);
      b.year.place(AGE_FIELD.x + 20, AGE_FIELD.y + 14, AGE_FIELD.w - 40, AGE_FIELD.h - 28, 44);
      const buttons = this.buttons();
      if (b.day) {
        title(ctx, `AND WHICH DAY OF ${MONTHS[b.month! - 1]}?`, VIEW_W / 2, DAY_FIELD.y - 40, 40, INK);
        card(ctx, DAY_FIELD.x, DAY_FIELD.y, DAY_FIELD.w, DAY_FIELD.h, INK, document.activeElement === b.day.el);
        b.day.place(DAY_FIELD.x + 20, DAY_FIELD.y + 14, DAY_FIELD.w - 40, DAY_FIELD.h - 28, 44);
      } else if (b.ask === "month") title(ctx, "AND WHICH MONTH?", VIEW_W / 2, MONTH_TOP - 40, 40, INK);
      this.menu.draw(ctx, buttons);
      if (this.error) label(ctx, this.error, VIEW_W / 2, 960, 28, RED);
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

  /** Creating an email account starts with the birth date, unless this browser already got a no. */
  private askAge(): void {
    this.closeForm();
    this.error = "";
    this.menu.focus = 0;
    if (signupRefused(localStorage)) { this.mode = "under"; return; }
    this.mode = "age";
    const year = new TextField({ maxLength: 4, onSubmit: () => this.answer(), onCancel: () => this.toDoor() });
    year.el.inputMode = "numeric";
    this.birth = { ask: "year", year, month: null, day: null };
  }

  /** The birth date as far as it's been given: on to signup, to the next question, or to `under` for good. */
  private answer(): void {
    const b = this.birth!, now = new Date();
    const problem = yearProblem(b.year.value.trim(), now) ?? (b.day ? dayProblem(b.day.value.trim()) : null);
    if (problem) { this.error = problem; return; }
    this.error = "";
    const given: BirthAnswer = { year: Number(b.year.value.trim()), month: b.month ?? undefined, day: b.day ? Number(b.day.value.trim()) : undefined };
    const step = ageStep(given, now);
    if ("old" in step) {
      if (step.old) { sfx.menuConfirm(); this.openForm("signup"); }
      else { refuseSignup(localStorage); this.closeForm(); this.mode = "under"; this.menu.focus = 0; }
      return;
    }
    this.menu.focus = 0;
    b.ask = step.need;
    b.year.el.readOnly = true;
    if (step.need === "day" && !b.day) {
      b.day = new TextField({ maxLength: 2, onSubmit: () => this.answer(), onCancel: () => this.toDoor() });
      b.day.el.inputMode = "numeric";
    }
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
    this.menu.focus = 2;
  }

  private closeForm(): void {
    if (this.birth) { this.birth.year.remove(); this.birth.day?.remove(); this.birth = null; }
    if (!this.fields) return;
    this.fields.email.remove();
    this.fields.password.remove();
    this.fields.name?.remove();
    this.fields = null;
  }

  private submit(): void {
    if (this.sending || !this.fields) return;
    const email = this.fields.email.value.trim(), password = this.fields.password.value;
    this.signInWith(this.mode === "signup" ? emailSignUp(email, password, this.fields.name!.value.trim()) : emailSignIn(email, password));
  }

  private signInWith(done: Promise<void>): void {
    this.sending = true;
    this.error = "";
    done.then(
      () => { sfx.menuConfirm(); this.next = this.home(); },
      (error: unknown) => {
        console.error("sign-in failed", error);
        this.error = error instanceof Error ? error.message : String(error);
        this.sending = false;
      },
    );
  }
}
