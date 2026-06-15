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
const RIDER_LEAN = (14 * Math.PI) / 180; // extra rider tilt with A/D, over the tucked base

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
  ctx.shadowBlur = 12;
  ctx.fillStyle = rgba(color, 0.16);
  path();
  ctx.fill();
  ctx.restore();
}

/**
 * Draw the interpolated bike — a long, low, flowing neon light-cycle CHOPPER.
 * Cosmetic only: reads poses, never touches physics. The flowing frame + rider
 * live on the chassis transform (so they rotate/flip with it); short swingarm/
 * fork stubs anchor to the real wheel-hub screen positions (suspension travel).
 * Shared by ride + playground.
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
  // Chassis-local metres → screen px. +x local = forward, +y local = DOWN on screen.
  const L = (lx: number, ly: number): [number, number] => [
    cx + (lx * cos - ly * sin) * scale,
    cy + (lx * sin + ly * cos) * scale,
  ];

  const rear = wheelScreen(view, "rearWheel");
  const front = wheelScreen(view, "frontWheel");

  // ── Draw order (back → front): wheels, fork/swingarm stubs, flowing frame, rider ──
  drawWheel(ctx, rear, primary, secondary);
  drawWheel(ctx, front, primary, secondary);

  // Raked front fork + rear swingarm: short stubs from the low frame to the real
  // hubs, so the wheels stay attached through suspension travel and rotation.
  const neck = L(0.62, -0.18);
  const swingRoot = L(-0.62, -0.05);
  strokeNeon(ctx, secondary, 2, () => {
    ctx.beginPath();
    ctx.moveTo(neck[0], neck[1]);
    ctx.lineTo(front.x, front.y); // raked fork
    ctx.moveTo(swingRoot[0], swingRoot[1]);
    ctx.lineTo(rear.x, rear.y); // swingarm
  });

  // THE FRAME — one continuous flowing line: long low tail overhang, sweeping up
  // over a low seat/tank hump, then a forward-raked neck out to a nose overhang.
  const framePath = (): void => {
    const tail = L(-1.28, 0.16); // behind/below the rear wheel
    const s1 = L(-0.98, -0.16);
    const s2 = L(-0.5, -0.46);
    const seat = L(-0.12, -0.48); // low hump over the tank
    const t1 = L(0.26, -0.5);
    const t2 = L(0.5, -0.34);
    const mid = L(0.82, -0.04);
    const n1 = L(1.04, 0.1);
    const nose = L(1.32, 0.22); // raked nose, pushed out past the front wheel
    ctx.beginPath();
    ctx.moveTo(tail[0], tail[1]);
    ctx.bezierCurveTo(s1[0], s1[1], s2[0], s2[1], seat[0], seat[1]);
    ctx.bezierCurveTo(t1[0], t1[1], t2[0], t2[1], mid[0], mid[1]);
    ctx.quadraticCurveTo(n1[0], n1[1], nose[0], nose[1]);
  };
  // A faint filled belly under the frame gives the long body some mass.
  fillNeon(ctx, primary, () => {
    framePath();
    const bellyA = L(0.82, 0.06);
    const bellyB = L(-0.62, 0.12);
    ctx.lineTo(bellyA[0], bellyA[1]);
    ctx.lineTo(bellyB[0], bellyB[1]);
    ctx.closePath();
  });
  strokeNeon(ctx, primary, 2.6, framePath);

  // Rider — hunched/tucked forward, drawn in the same flowing neon line style.
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

/** Thin elegant ring + small hub + 3 refined spokes that rotate with the wheel. */
function drawWheel(
  ctx: CanvasRenderingContext2D,
  w: WheelScreen,
  primary: string,
  secondary: string,
): void {
  strokeNeon(ctx, primary, 1.4, () => {
    ctx.beginPath();
    ctx.arc(w.x, w.y, w.r, 0, Math.PI * 2);
  });
  // Small clean hub.
  strokeNeon(ctx, secondary, 1.2, () => {
    ctx.beginPath();
    ctx.arc(w.x, w.y, w.r * 0.18, 0, Math.PI * 2);
  });
  // Refined spokes hub→rim.
  const inner = w.r * 0.2;
  strokeNeon(ctx, secondary, 1, () => {
    ctx.beginPath();
    for (let k = 0; k < 3; k++) {
      const a = w.angle + (k * 2 * Math.PI) / 3;
      ctx.moveTo(w.x + Math.cos(a) * inner, w.y + Math.sin(a) * inner);
      ctx.lineTo(w.x + Math.cos(a) * w.r * 0.92, w.y + Math.sin(a) * w.r * 0.92);
    }
  });
}

/**
 * Rider tucked low over the tank, flowing-line style. Base pose is hunched
 * forward + aggressive; input adds lean (A/D rotate the upper body about the
 * hips) and a deeper tuck on jump. Rotates/flips with the chassis via L().
 */
function drawRider(
  ctx: CanvasRenderingContext2D,
  L: (lx: number, ly: number) => [number, number],
  scale: number,
  color: string,
  inputMask: number,
  crashed: boolean,
): void {
  let lean = 0;
  if (inputMask & INPUT.LEAN_LEFT) lean += RIDER_LEAN; // weight back
  if (inputMask & INPUT.LEAN_RIGHT) lean -= RIDER_LEAN; // weight forward
  const tuck = inputMask & INPUT.JUMP ? 0.1 : 0; // compress on jump-charge
  if (crashed) lean += 1.0; // thrown off

  // Hips sit on the seat hump; the torso curves forward+down into a racer tuck.
  const hipL: [number, number] = [-0.16, -0.46];
  const hip = L(hipL[0], hipL[1]);
  const c = Math.cos(lean);
  const s = Math.sin(lean);
  // Rider-local (metres, +y UP) rotated by lean about the hips, then chassis L().
  const R = (rx: number, ry: number): [number, number] => {
    const lx = hipL[0] + (rx * c - (ry - tuck) * s);
    const ly = hipL[1] - (rx * s + (ry - tuck) * c); // -y: rider up = screen up
    return L(lx, ly);
  };
  const back = R(0.16, 0.16); // lower back, already pitched forward
  const shoulder = R(0.42, 0.26); // shoulders well forward over the tank
  const head = R(0.6, 0.24); // head low + forward
  const hand = R(0.74, -0.02); // arms stretched to the bars
  const knee = R(0.06, -0.04); // tucked knee toward the peg

  // Flowing spine (hip → back → shoulder) + arm to the bars + thigh.
  strokeNeon(ctx, color, 2, () => {
    ctx.beginPath();
    ctx.moveTo(hip[0], hip[1]);
    ctx.quadraticCurveTo(back[0], back[1], shoulder[0], shoulder[1]);
    ctx.lineTo(hand[0], hand[1]);
    ctx.moveTo(hip[0], hip[1]);
    ctx.lineTo(knee[0], knee[1]);
  });
  // Head.
  strokeNeon(ctx, color, 1.5, () => {
    ctx.beginPath();
    ctx.arc(head[0], head[1], 0.11 * scale, 0, Math.PI * 2);
  });
}
