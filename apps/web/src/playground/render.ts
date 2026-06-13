import type { BikeTune, SimSnapshot, TrackInfo } from "@chainrider/physics";
import { drawBike } from "../shared/bike";

const PX_PER_METER = 26;
/** Camera leads the bike a little in the riding direction. */
const CAMERA_LOOKAHEAD_M = 3;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export interface RenderView {
  track: TrackInfo;
  prev: SimSnapshot;
  curr: SimSnapshot;
  /** accumulator / SIM_DT, 0..1 — interpolation between the two snapshots. */
  alpha: number;
  tune: BikeTune;
}

export function render(
  ctx: CanvasRenderingContext2D,
  cssWidth: number,
  cssHeight: number,
  view: RenderView,
): void {
  const { track, prev, curr, alpha, tune } = view;

  const camX = lerp(prev.chassis.x, curr.chassis.x, alpha) + CAMERA_LOOKAHEAD_M;
  const camY = lerp(prev.chassis.y, curr.chassis.y, alpha);
  const toX = (wx: number): number => (wx - camX) * PX_PER_METER + cssWidth / 2;
  const toY = (wy: number): number => cssHeight / 2 - (wy - camY) * PX_PER_METER;

  ctx.fillStyle = "#05060a";
  ctx.fillRect(0, 0, cssWidth, cssHeight);

  // Terrain
  ctx.strokeStyle = "#00e5ff";
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.beginPath();
  let started = false;
  for (const [x, y] of track.terrain) {
    const sx = toX(x);
    if (sx < -100 && !started) continue;
    if (!started) {
      ctx.moveTo(sx, toY(y));
      started = true;
    } else {
      ctx.lineTo(sx, toY(y));
    }
    if (sx > cssWidth + 100) break;
  }
  ctx.stroke();

  // Kill floor
  const killScreenY = toY(track.killY);
  if (killScreenY < cssHeight + 50) {
    ctx.strokeStyle = "rgba(255, 60, 60, 0.5)";
    ctx.setLineDash([12, 8]);
    ctx.beginPath();
    ctx.moveTo(0, killScreenY);
    ctx.lineTo(cssWidth, killScreenY);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Checkpoints
  ctx.strokeStyle = "rgba(255, 230, 0, 0.6)";
  ctx.lineWidth = 2;
  for (const cp of track.checkpoints) {
    const sx = toX(cp.x);
    if (sx < -20 || sx > cssWidth + 20) continue;
    const sy = toY(cp.y - tune.wheelRadius - tune.axleDropY);
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx, sy - 24);
    ctx.stroke();
  }

  // Finish flag
  const fx = toX(track.finishX);
  if (fx > -20 && fx < cssWidth + 20) {
    ctx.strokeStyle = "#00ff88";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(fx, 0);
    ctx.lineTo(fx, cssHeight);
    ctx.stroke();
  }

  // Bike — interpolated poses (shared with the ride screen).
  drawBike(ctx, { toX, toY, scale: PX_PER_METER, prev, curr, alpha, tune });
}
