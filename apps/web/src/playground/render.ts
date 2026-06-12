import type { BikeTune, SimSnapshot, TrackInfo } from "@chainrider/physics";

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

  // Bike — interpolated poses, primitive shapes for now.
  drawWheel(ctx, toX, toY, prev, curr, alpha, "rearWheel", tune.wheelRadius);
  drawWheel(ctx, toX, toY, prev, curr, alpha, "frontWheel", tune.wheelRadius);

  const cx = toX(lerp(prev.chassis.x, curr.chassis.x, alpha));
  const cy = toY(lerp(prev.chassis.y, curr.chassis.y, alpha));
  const cAngle = lerp(prev.chassis.angle, curr.chassis.angle, alpha);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-cAngle); // y-flip inverts rotation direction on screen
  ctx.strokeStyle = curr.crashed ? "#ff3c3c" : "#e0ffff";
  ctx.lineWidth = 2;
  ctx.strokeRect(
    (-tune.chassisWidth / 2) * PX_PER_METER,
    (-tune.chassisHeight / 2) * PX_PER_METER,
    tune.chassisWidth * PX_PER_METER,
    tune.chassisHeight * PX_PER_METER,
  );
  ctx.restore();

  // Head
  const hx = toX(lerp(prev.head.x, curr.head.x, alpha));
  const hy = toY(lerp(prev.head.y, curr.head.y, alpha));
  ctx.strokeStyle = curr.crashed ? "#ff3c3c" : "#ffb000";
  ctx.beginPath();
  ctx.arc(hx, hy, tune.headRadius * PX_PER_METER, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(hx, hy);
  ctx.stroke();
}

function drawWheel(
  ctx: CanvasRenderingContext2D,
  toX: (wx: number) => number,
  toY: (wy: number) => number,
  prev: SimSnapshot,
  curr: SimSnapshot,
  alpha: number,
  key: "rearWheel" | "frontWheel",
  radius: number,
): void {
  const x = toX(lerp(prev[key].x, curr[key].x, alpha));
  const y = toY(lerp(prev[key].y, curr[key].y, alpha));
  const angle = -lerp(prev[key].angle, curr[key].angle, alpha);
  const r = radius * PX_PER_METER;
  const grounded = key === "rearWheel" ? curr.rearGrounded : curr.frontGrounded;

  ctx.strokeStyle = grounded ? "#00ff88" : "#7df9ff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  // Spokes so rotation is visible
  ctx.beginPath();
  for (const off of [0, Math.PI / 2]) {
    ctx.moveTo(x - Math.cos(angle + off) * r, y - Math.sin(angle + off) * r);
    ctx.lineTo(x + Math.cos(angle + off) * r, y + Math.sin(angle + off) * r);
  }
  ctx.stroke();
}
