import type { BikeTune, SimSnapshot } from "@chainrider/physics";
import { SKINS, type Skin } from "../skins";

/**
 * Image-sprite bike (P5.3). The bike body + rider + wheels are one transparent
 * PNG illustration drawn centred on the chassis position and rotated to the
 * chassis angle — so it leans / flips / tumbles exactly with the physics, same
 * as the old vector bike. Cosmetic only: reads the snapshot, never touches
 * physics. The glow trail stays code-drawn (in ride/render + playground), drawn
 * BEHIND this sprite. Shared by ride + playground.
 */

// ── Fit knobs (tune these to line the sprite's wheels up with the terrain) ──
/** Sprite width in WORLD METRES (the size/scale knob). Larger = bigger bike. */
const SPRITE_WIDTH_M = 2.8;
/** Chassis-local horizontal nudge, metres (+ = forward / toward the front wheel). */
const SPRITE_OFFSET_X = 0;
/** Chassis-local vertical nudge, metres (+ = DOWN on screen — push it onto the terrain). */
const SPRITE_OFFSET_Y = 0.18;

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
  /** Active skin — picks the bike sprite (and the trail tint, used by the caller). */
  skin: Skin;
  /** Live input bitmask. Unused by the sprite (it leans via the chassis), kept for the shared view shape. */
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

/** Kick off loading every skin's sprite up front so the ride has it ready. */
export function preloadBikeSprites(): void {
  for (const s of SKINS) getSprite(s.sprite);
}

function isReady(img: HTMLImageElement): boolean {
  return img.complete && img.naturalWidth > 0;
}

/**
 * Draw the interpolated bike sprite at the chassis pose. If the image hasn't
 * decoded yet, skip the body for this frame (the trail still renders) — the
 * sprite is preloaded at startup so this is at most a few early frames.
 */
export function drawBike(ctx: CanvasRenderingContext2D, view: BikeView): void {
  const { toX, toY, scale, prev, curr, alpha, skin } = view;

  const img = getSprite(skin.sprite);
  if (!isReady(img)) return;

  const cx = toX(lerp(prev.chassis.x, curr.chassis.x, alpha));
  const cy = toY(lerp(prev.chassis.y, curr.chassis.y, alpha));
  // Screen rotation (y is flipped in toY, so negate the world angle — matches the
  // old vector bike, so the sprite leans/flips/tumbles identically with the chassis).
  const cAngle = -lerp(prev.chassis.angle, curr.chassis.angle, alpha);

  const wPx = SPRITE_WIDTH_M * scale;
  const hPx = wPx * (img.naturalHeight / img.naturalWidth);

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(cAngle);
  // Centre the sprite on the chassis, then nudge by the local offsets (metres → px).
  ctx.drawImage(
    img,
    -wPx / 2 + SPRITE_OFFSET_X * scale,
    -hPx / 2 + SPRITE_OFFSET_Y * scale,
    wPx,
    hPx,
  );
  ctx.restore();
}

// Start loading the bike art as soon as this module is imported.
preloadBikeSprites();
