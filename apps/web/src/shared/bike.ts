import type { BikeTune, SimSnapshot } from "@chainrider/physics";
import { SKINS, type Skin } from "../skins";

/**
 * 3-piece hybrid sprite bike (P5.5). Frame+rider is one PNG drawn at the chassis
 * pose; each wheel is its own PNG drawn at its OWN physics-body position +
 * rotation. Because each wheel tracks its own body, the suspension gap between
 * frame and wheels visibly flexes over bumps and the wheels spin with their
 * rotation. On crash all three tumble with their bodies. Cosmetic only — reads
 * the snapshot, never touches physics. The glow trail stays code-drawn (drawn
 * BEHIND this, in ride/render + playground). Shared by ride + playground.
 */

/**
 * Fit knobs (tune to seat the bike on the terrain + level it). A MUTABLE object
 * so the dev tuning panel (src/dev/bikeTunePanel.ts, toggled in-browser) can edit
 * them LIVE while riding. drawBike reads it every frame. These defaults are the
 * source of truth — once dialled in, bake the panel's COPY VALUES back here.
 */
export interface BikeSpriteTune {
  /** Frame sprite width in WORLD METRES (frame scale). */
  FRAME_WIDTH_M: number;
  /** Frame nudge in CHASSIS-LOCAL metres (moves with the frame; +x fwd, +y down). */
  FRAME_OFFSET_X: number;
  FRAME_OFFSET_Y: number;
  /** Radians added to the frame's chassis rotation — level it on flat ground. */
  SPRITE_ROTATION_OFFSET: number;
  /** Wheel sprite drawn diameters in WORLD METRES (physics ~0.68 m; bump for padding). */
  FRONT_WHEEL_DIAMETER_M: number;
  REAR_WHEEL_DIAMETER_M: number;
  /** Per-wheel SCREEN-space nudge (world metres) to centre the image on the hub. */
  FRONT_WHEEL_OFFSET_X: number;
  FRONT_WHEEL_OFFSET_Y: number;
  REAR_WHEEL_OFFSET_X: number;
  REAR_WHEEL_OFFSET_Y: number;
}

export const BIKE_TUNE: BikeSpriteTune = {
  FRAME_WIDTH_M: 2.35,
  FRAME_OFFSET_X: -0.06,
  FRAME_OFFSET_Y: -0.17,
  SPRITE_ROTATION_OFFSET: -0.195,
  FRONT_WHEEL_DIAMETER_M: 0.88,
  REAR_WHEEL_DIAMETER_M: 0.88,
  FRONT_WHEEL_OFFSET_X: 0.37,
  FRONT_WHEEL_OFFSET_Y: -0.02,
  REAR_WHEEL_OFFSET_X: -0.3,
  REAR_WHEEL_OFFSET_Y: 0.02,
};

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export interface BikeView {
  toX: (wx: number) => number;
  toY: (wy: number) => number;
  /** Pixels per world metre (ride zooms this; playground is fixed). */
  scale: number;
  prev: SimSnapshot;
  curr: SimSnapshot;
  alpha: number;
  tune: BikeTune;
  /** Active skin — picks the bike sprite set (and the trail tint, used by the caller). */
  skin: Skin;
  /** Live input bitmask. Unused by the sprite bike (it leans via the physics bodies). */
  inputMask: number;
}

// ── Sprite cache + preload (load once, never per frame) ─────────────────────
const spriteCache = new Map<string, HTMLImageElement>();

function getSprite(path: string): HTMLImageElement {
  let img = spriteCache.get(path);
  if (!img) {
    img = new Image();
    img.src = path;
    spriteCache.set(path, img);
  }
  return img;
}

/** Kick off loading every skin's 3 pieces up front so the ride has them ready. */
export function preloadBikeSprites(): void {
  for (const s of SKINS) {
    getSprite(s.sprites.frame);
    getSprite(s.sprites.wheelFront);
    getSprite(s.sprites.wheelRear);
  }
}

function isReady(img: HTMLImageElement): boolean {
  return img.complete && img.naturalWidth > 0;
}

/**
 * One wheel PNG anchored to its OWN physics-body world position, rotated by its
 * spin angle. The fine-align offset is applied in CHASSIS-LOCAL space (rotated by
 * the bike's angle), so it stays attached at any rotation — flips/wheelies/slopes
 * no longer drift the wheels off (at rest, chassisAngle≈0, so it's identical to
 * the old screen-space offset → resting fit unchanged). The offset is NOT rotated
 * by the wheel's own spin (that would orbit the hub).
 */
function drawWheel(
  ctx: CanvasRenderingContext2D,
  view: BikeView,
  key: "rearWheel" | "frontWheel",
  img: HTMLImageElement,
  diameterM: number,
  offXM: number,
  offYM: number,
  chassisAngle: number,
): void {
  if (!isReady(img)) return;
  const { toX, toY, scale, prev, curr, alpha } = view;
  const hx = toX(lerp(prev[key].x, curr[key].x, alpha)); // physics wheel body position
  const hy = toY(lerp(prev[key].y, curr[key].y, alpha));
  // Screen rotation (toY flips y, so negate) — the wheel image spins with the body.
  const spin = -lerp(prev[key].angle, curr[key].angle, alpha);
  const d = diameterM * scale;
  // Rotate the align offset by the bike's chassis angle so it tracks orientation.
  const ox = offXM * scale;
  const oy = offYM * scale;
  const ca = Math.cos(chassisAngle);
  const sa = Math.sin(chassisAngle);
  ctx.save();
  ctx.translate(hx + ox * ca - oy * sa, hy + ox * sa + oy * ca);
  ctx.rotate(spin);
  ctx.drawImage(img, -d / 2, -d / 2, d, d);
  ctx.restore();
}

/**
 * Draw the interpolated 3-piece bike. Wheels first, then the frame on top (its
 * bodywork overlaps the wheel tops; the erased wheel areas show the wheels
 * through). Any piece not yet decoded is skipped for that frame (all preloaded).
 */
export function drawBike(ctx: CanvasRenderingContext2D, view: BikeView): void {
  const { toX, toY, scale, prev, curr, alpha, skin } = view;
  const sprites = skin.sprites;

  const t = BIKE_TUNE;
  // The bike's screen rotation (toY flips y, so negate). Wheels anchor to their
  // own bodies but rotate their align offset by this; the frame adds the art-level
  // SPRITE_ROTATION_OFFSET on top.
  const chassisAngle = -lerp(prev.chassis.angle, curr.chassis.angle, alpha);
  drawWheel(ctx, view, "rearWheel", getSprite(sprites.wheelRear), t.REAR_WHEEL_DIAMETER_M, t.REAR_WHEEL_OFFSET_X, t.REAR_WHEEL_OFFSET_Y, chassisAngle);
  drawWheel(ctx, view, "frontWheel", getSprite(sprites.wheelFront), t.FRONT_WHEEL_DIAMETER_M, t.FRONT_WHEEL_OFFSET_X, t.FRONT_WHEEL_OFFSET_Y, chassisAngle);

  const frame = getSprite(sprites.frame);
  if (!isReady(frame)) return;
  const cx = toX(lerp(prev.chassis.x, curr.chassis.x, alpha));
  const cy = toY(lerp(prev.chassis.y, curr.chassis.y, alpha));
  const cAngle = chassisAngle + t.SPRITE_ROTATION_OFFSET;
  const wPx = t.FRAME_WIDTH_M * scale;
  const hPx = wPx * (frame.naturalHeight / frame.naturalWidth);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(cAngle);
  // Frame offsets in chassis-local (post-rotate) space — they move with the frame.
  ctx.drawImage(frame, -wPx / 2 + t.FRAME_OFFSET_X * scale, -hPx / 2 + t.FRAME_OFFSET_Y * scale, wPx, hPx);
  ctx.restore();
}

// Start loading the bike art as soon as this module is imported.
preloadBikeSprites();
