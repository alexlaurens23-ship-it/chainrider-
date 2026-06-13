import type { BikeTune, SimSnapshot } from "@chainrider/physics";

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
}

/**
 * Draws the interpolated bike (two wheels, chassis box, head) in screen space.
 * Cosmetic only — reads snapshot poses, never touches physics. Shared by the
 * ride renderer and the tuning playground.
 */
export function drawBike(ctx: CanvasRenderingContext2D, view: BikeView): void {
  const { toX, toY, scale, prev, curr, alpha, tune } = view;

  drawWheel(ctx, view, "rearWheel", curr.rearGrounded);
  drawWheel(ctx, view, "frontWheel", curr.frontGrounded);

  const cx = toX(lerp(prev.chassis.x, curr.chassis.x, alpha));
  const cy = toY(lerp(prev.chassis.y, curr.chassis.y, alpha));
  const cAngle = lerp(prev.chassis.angle, curr.chassis.angle, alpha);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-cAngle); // y-flip inverts rotation direction on screen
  ctx.strokeStyle = curr.crashed ? "#ff3c3c" : "#e0ffff";
  ctx.lineWidth = 2;
  ctx.strokeRect(
    (-tune.chassisWidth / 2) * scale,
    (-tune.chassisHeight / 2) * scale,
    tune.chassisWidth * scale,
    tune.chassisHeight * scale,
  );
  ctx.restore();

  const hx = toX(lerp(prev.head.x, curr.head.x, alpha));
  const hy = toY(lerp(prev.head.y, curr.head.y, alpha));
  ctx.strokeStyle = curr.crashed ? "#ff3c3c" : "#ffb000";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(hx, hy, tune.headRadius * scale, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(hx, hy);
  ctx.stroke();
}

function drawWheel(
  ctx: CanvasRenderingContext2D,
  view: BikeView,
  key: "rearWheel" | "frontWheel",
  grounded: boolean,
): void {
  const { toX, toY, scale, prev, curr, alpha, tune } = view;
  const x = toX(lerp(prev[key].x, curr[key].x, alpha));
  const y = toY(lerp(prev[key].y, curr[key].y, alpha));
  const angle = -lerp(prev[key].angle, curr[key].angle, alpha);
  const r = tune.wheelRadius * scale;

  ctx.strokeStyle = grounded ? "#00ff88" : "#7df9ff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  // Spokes so rotation is visible.
  ctx.beginPath();
  for (const off of [0, Math.PI / 2]) {
    ctx.moveTo(x - Math.cos(angle + off) * r, y - Math.sin(angle + off) * r);
    ctx.lineTo(x + Math.cos(angle + off) * r, y + Math.sin(angle + off) * r);
  }
  ctx.stroke();
}
