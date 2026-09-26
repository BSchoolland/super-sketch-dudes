import { viewRectToCss } from "../../input/pointer";
import { FONT, INK } from "../ui";

export interface TextFieldOptions {
  type?: "text" | "password";
  maxLength: number;
  value?: string;
  upper?: boolean;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

/**
 * A real <input> laid over the canvas, so phones raise their keyboard and passwords stay
 * passwords. The canvas draws the card behind it; `place` keeps it glued to view coordinates.
 */
export class TextField {
  readonly el = document.createElement("input");
  private placed = "";

  constructor(opts: TextFieldOptions) {
    const overlay = document.getElementById("overlay");
    if (!overlay) throw new Error("#overlay missing from index.html");
    const el = this.el;
    el.type = opts.type ?? "text";
    el.maxLength = opts.maxLength;
    el.value = opts.value ?? "";
    el.autocomplete = opts.type === "password" ? "current-password" : "off";
    el.spellcheck = false;
    el.autocapitalize = opts.upper ? "characters" : "off";
    Object.assign(el.style, {
      position: "absolute", border: "none", outline: "none", background: "transparent", color: INK,
      fontFamily: FONT, fontWeight: "700", textAlign: "center", padding: "0", margin: "0", pointerEvents: "auto",
      textTransform: opts.upper ? "uppercase" : "none", letterSpacing: opts.upper ? "0.3em" : "normal",
    });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); opts.onSubmit(this.value); }
      if (e.key === "Escape") { e.preventDefault(); opts.onCancel(); }
    });
    overlay.appendChild(el);
    el.focus();
  }

  get value(): string {
    return this.el.value;
  }

  set value(v: string) {
    this.el.value = v;
  }

  /** View-space rect; call every frame from draw (the window may have resized). */
  place(x: number, y: number, w: number, h: number, fontPx: number): void {
    const r = viewRectToCss(x, y, w, h);
    const key = `${r.left},${r.top},${r.width},${r.height}`;
    if (key === this.placed) return;
    this.placed = key;
    Object.assign(this.el.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, fontSize: `${fontPx * r.scale}px` });
  }

  remove(): void {
    this.el.remove();
  }
}
