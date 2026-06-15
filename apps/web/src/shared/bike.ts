import { INPUT } from "@chainrider/physics";
import type { BikeTune, SimSnapshot } from "@chainrider/physics";
import type { Skin } from "../skins";

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
  /** Active skin — all strokes/glow are coloured from this (hex swap). */
  skin: Skin;
  /** Live input bitmask (rider lean/crouch). Cosmetic only. */
  inputMask: number;
}

const CRASH_PRIMARY = "#ff4444";
const CRASH_SECONDARY = "#ff8888";
const RIDER_LEAN = (15 * Math.PI) / 180; // rider tilt with A/D

/** hex (#rrggbb) → rgba() with alpha. */
function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/**
 * Stroke a path with the neon glow recipe (Appendix B): additive outer halo +
 * mid glow, then a crisp white core. `path` issues the geometry (beginPath + …);
 * it's replayed once per pass.
 */
function strokeNeon(
  ctx: CanvasRenderingContext2D,
  color: string,
  coreWidth: number,
  path: () => void,
): void {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.shadowColor = color;
  ctx.shadowBlur = 18;
  ctx.strokeStyle = rgba(color, 0.25);
  ctx.lineWidth = coreWidth + 4;
  path();
  ctx.stroke();
  ctx.shadowBlur = 8;
  ctx.strokeStyle = rgba(color, 0.6);
  ctx.lineWidth = coreWidth + 2;
  path();
  ctx.stroke();
  ctx.restore();

  ctx.shadowBlur = 0;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = coreWidth;
  path();
  ctx.stroke();
}

function fillNeon(ctx: CanvasRenderingContext2D, color: string, path: () => void): void {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.shadowColor = color;
  ctx.shadowBlur = 10;
  ctx.fillStyle = rgba(color, 0.18);
  path();
  ctx.fill();
  ctx.restore();
}

/**
 * Draw the interpolated neon light-cycle from the physics snapshot. Cosmetic
 * only — reads poses, never touches physics. Shared by ride + playground.
 *
 * Frame members anchor to the real wheel-hub screen positions (so they track
 * suspension travel); the rider/seat ride the chassis transform and lean to input.
 */
export function drawBike(ctx: CanvasRenderingContext2D, view: BikeView): void {
  const { toX, toY, scale, prev, curr, alpha, skin, inputMask } = view;
  const crashed = curr.crashed;
  const primary = crashed ? CRASH_PRIMARY : skin.primary;
  const secondary = crashed ? CRASH_SECONDARY : skin.secondary;

  const cx = toX(lerp(prev.chassis.x, curr.chassis.x, alpha));
  const cy = toY(lerp(prev.chassis.y, curr.chassis.y, alpha));
  const cAngle = -lerp(prev.chassis.angle, curr.chassis.angle, alpha); // screen rotation (y flipped)
  const cos = Math.cos(cAngle);
  const sin = Math.sin(cAngle);
  // Chassis-local metres → screen px. +x local = forward, +y local = down on screen.
  const L = (lx: number, ly: number): [number, number] => [
    cx + (lx * cos - ly * sin) * scale,
    cy + (lx * sin + ly * cos) * scale,
  ];

  const rear = wheelScreen(view, "rearWheel");
  const front = wheelScreen(view, "frontWheel");

  // ── Draw order (back → front): wheels, swingarm, fork, spine, seat, rider ──
  drawWheel(ctx, rear, primary, secondary);
  drawWheel(ctx, front, primary, secondary);

  // Rear swingarm + cowl: chassis rear mount → rear hub.
  const rearMount = L(-0.45, 0.06);
  strokeNeon(ctx, primary, 2.5, () => {
    ctx.beginPath();
    ctx.moveTo(rearMount[0], rearMount[1]);
    ctx.lineTo(rear.x, rear.y);
  });

  // Exposed front fork: two near-parallel struts from the steering head to the hub.
  const headMount = L(0.5, -0.04);
  const headMount2 = L(0.42, 0.12);
  strokeNeon(ctx, secondary, 2, () => {
    ctx.beginPath();
    ctx.moveTo(headMount[0], headMount[1]);
    ctx.lineTo(front.x, front.y);
    ctx.moveTo(headMount2[0], headMount2[1]);
    ctx.lineTo(front.x, front.y);
  });

  // Long forward-cant frame spine connecting the hubs through the chassis.
  const spineRear = L(-0.7, -0.18);
  const spineMid = L(0.0, -0.28);
  const spineFront = L(0.6, -0.16);
  strokeNeon(ctx, primary, 3, () => {
    ctx.beginPath();
    ctx.moveTo(rear.x, rear.y);
    ctx.lineTo(spineRear[0], spineRear[1]);
    ctx.quadraticCurveTo(spineMid[0], spineMid[1], spineFront[0], spineFront[1]);
    ctx.lineTo(headMount[0], headMount[1]);
  });

  // Seat / tail wedge over the rear.
  const tailA = L(-0.78, -0.26);
  const tailB = L(-0.28, -0.4);
  const tailC = L(-0.2, -0.16);
  const tailPath = (): void => {
    ctx.beginPath();
    ctx.moveTo(tailA[0], tailA[1]);
    ctx.lineTo(tailB[0], tailB[1]);
    ctx.lineTo(tailC[0], tailC[1]);
    ctx.closePath();
  };
  fillNeon(ctx, primary, tailPath);
  strokeNeon(ctx, primary, 2, tailPath);

  // Rider — chassis-local, leaning to input (cosmetic). Ejected on crash.
  drawRider(ctx, L, scale, secondary, inputMask, crashed);
}

interface WheelScreen {
  x: number;
  y: number;
  angle: number;
  r: number;
  grounded: boolean;
}

function wheelScreen(view: BikeView, key: "rearWheel" | "frontWheel"): WheelScreen {
  const { toX, toY, scale, prev, curr, alpha, tune } = view;
  return {
    x: toX(lerp(prev[key].x, curr[key].x, alpha)),
    y: toY(lerp(prev[key].y, curr[key].y, alpha)),
    angle: -lerp(prev[key].angle, curr[key].angle, alpha),
    r: tune.wheelRadius * scale,
    grounded: key === "rearWheel" ? curr.rearGrounded : curr.frontGrounded,
  };
}

/** Glowing outer ring + 3 inner spokes that rotate with the wheel body. */
function drawWheel(
  ctx: CanvasRenderingContext2D,
  w: WheelScreen,
  primary: string,
  secondary: string,
): void {
  strokeNeon(ctx, primary, 2, () => {
    ctx.beginPath();
    ctx.arc(w.x, w.y, w.r, 0, Math.PI * 2);
  });
  const inner = w.r * 0.32;
  strokeNeon(ctx, secondary, 1.5, () => {
    ctx.beginPath();
    for (let k = 0; k < 3; k++) {
      const a = w.angle + (k * 2 * Math.PI) / 3;
      ctx.moveTo(w.x + Math.cos(a) * inner, w.y + Math.sin(a) * inner);
      ctx.lineTo(w.x + Math.cos(a) * w.r, w.y + Math.sin(a) * w.r);
    }
  });
}

/** Minimal angular rider on the chassis transform; lean follows input. */
function drawRider(
  ctx: CanvasRenderingContext2D,
  L: (lx: number, ly: number) => [number, number],
  scale: number,
  color: string,
  inputMask: number,
  crashed: boolean,
): void {
  let lean = 0;
  if (inputMask & INPUT.LEAN_LEFT) lean += RIDER_LEAN; // back
  if (inputMask & INPUT.LEAN_RIGHT) lean -= RIDER_LEAN; // forward
  const crouch = inputMask & INPUT.JUMP ? 0.12 : 0; // tuck on jump-charge
  if (crashed) lean += 0.9; // thrown off

  // Seat point in chassis-local metres; build the rider as offsets from it,
  // rotated by `lean` (and y-raised by crouch).
  const seat: [number, number] = [-0.18, -0.34];
  const hip = L(seat[0], seat[1]);
  const c = Math.cos(lean);
  const s = Math.sin(lean);
  // Rider-local (metres, +y up in rider space) → screen, via chassis L() then lean.
  const R = (rx: number, ry: number): [number, number] => {
    const lx = seat[0] + (rx * c - (ry - crouch) * s);
    const ly = seat[1] - (rx * s + (ry - crouch) * c); // -y: rider up = screen up
    return L(lx, ly);
  };
  const shoulder = R(0.0, 0.42);
  const headC = R(0.05, 0.58);
  const hand = R(0.46, 0.18); // reaching the bars
  const knee = R(0.28, 0.04);

  strokeNeon(ctx, color, 2, () => {
    ctx.beginPath();
    ctx.moveTo(hip[0], hip[1]);
    ctx.lineTo(shoulder[0], shoulder[1]); // torso
    ctx.lineTo(hand[0], hand[1]); // arm to bars
    ctx.moveTo(hip[0], hip[1]);
    ctx.lineTo(knee[0], knee[1]); // thigh toward the pegs
  });
  strokeNeon(ctx, color, 1.5, () => {
    ctx.beginPath();
    ctx.arc(headC[0], headC[1], 0.12 * scale, 0, Math.PI * 2);
  });
}
