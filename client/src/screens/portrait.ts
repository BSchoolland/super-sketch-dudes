import type { FighterDef } from "../../../shared/types";
import { drawRig, poseAt, resolvePose, tintColors } from "../render/rig";
import { SLOT_COLORS } from "../render/hud";
import { drawSprite } from "../render/sprite";
import { cellForAnim } from "../../../shared/gen/sprite";

export interface PortraitBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function drawFighterPortrait(
  ctx: CanvasRenderingContext2D,
  def: FighterDef,
  slot: number,
  t: number,
  ready: boolean,
  bounds: PortraitBounds,
  scale = 2.4,
): void {
  const animName = ready && def.rig.anims.taunt ? "taunt" : "idle";
  const anim = def.rig.anims[animName] ?? [];
  const loop = ready ? 60 : def.rig.loops.idle;
  const raw = poseAt(anim, Math.floor(t * 60), loop);
  const pose = resolvePose(def, raw);
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(bounds.x, bounds.y, bounds.w, bounds.h, 12);
  ctx.clip();
  ctx.fillStyle = "rgba(119,114,103,0.04)";
  ctx.fillRect(bounds.x, bounds.y, bounds.w, bounds.h);
  ctx.translate(bounds.x + bounds.w / 2, bounds.y + bounds.h - 30);
  ctx.scale(scale, scale);
  if (def.sprite) drawSprite(ctx, def, cellForAnim(def, animName), raw);
  else drawRig(ctx, pose, tintColors(def, slot, SLOT_COLORS), def.palette.outline);
  ctx.restore();
}
