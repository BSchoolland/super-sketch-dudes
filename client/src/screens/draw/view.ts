import type { DeviceId, MenuInput } from "../../input/devices";
import type { ViewPoint } from "../../input/pointer";
import type { DrawSession } from "./session";

/** What every DRAW BATTLE view can reach: the connection and the way out. */
export interface DrawHost {
  readonly session: DrawSession;
  readonly t: number;
  readonly device: DeviceId;
  /** Back to the title, closing the connection. */
  exit(): void;
}

export interface DrawView {
  update(m: MenuInput, taps: ViewPoint[], dt: number): void;
  draw(ctx: CanvasRenderingContext2D): void;
  dispose?(): void;
}
