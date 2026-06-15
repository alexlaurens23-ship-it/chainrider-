/**
 * Rear-wheel light trail — the signature effect. A ring buffer of recent
 * rear-wheel WORLD positions, drawn as a tapered additive glow ribbon
 * (newest = bright/wide → oldest = faint/thin). Cosmetic; cleared on respawn.
 */

const MAX_POINTS = 52;
const HEAD_WIDTH = 11; // px at the newest sample — a thick light-wall tail
const HEAD_ALPHA = 0.85;
const PULSE_MS = 260; // combo/flip-land flash duration
const PULSE_SCALE = 1.8; // width multiplier at the pulse peak

export interface Trail {
  /** Record one rear-wheel world position (call once per frame while riding). */
  push(wx: number, wy: number): void;
  /** Brief double-width flash (flip-land / combo). */
  pulse(): void;
  /** Wipe the ribbon (on respawn). */
  clear(): void;
  /** Render newest→oldest through the camera transform, in `color`. */
  draw(
    ctx: CanvasRenderingContext2D,
    toX: (wx: number) => number,
    toY: (wy: number) => number,
    color: string,
  ): void;
}

function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export function createTrail(): Trail {
  // pts[0] is the newest. Bounded to MAX_POINTS.
  const pts: { x: number; y: number }[] = [];
  let pulseStart = -Infinity;

  return {
    push(wx, wy) {
      pts.unshift({ x: wx, y: wy });
      if (pts.length > MAX_POINTS) pts.pop();
    },
    pulse() {
      pulseStart = performance.now();
    },
    clear() {
      pts.length = 0;
    },
    draw(ctx, toX, toY, color) {
      if (pts.length < 2) return;
      const pulseT = Math.max(0, 1 - (performance.now() - pulseStart) / PULSE_MS);
      const widthMul = 1 + (PULSE_SCALE - 1) * pulseT;

      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.shadowColor = color;
      // Per-segment taper: each segment is drawn with its own width + alpha so the
      // ribbon fades and thins toward the tail.
      for (let i = 1; i < pts.length; i++) {
        const t = 1 - i / pts.length; // 1 at head → ~0 at tail
        ctx.lineWidth = Math.max(0.5, HEAD_WIDTH * t * widthMul);
        ctx.strokeStyle = rgba(color, HEAD_ALPHA * t);
        ctx.shadowBlur = 14 * t;
        ctx.beginPath();
        ctx.moveTo(toX(pts[i - 1].x), toY(pts[i - 1].y));
        ctx.lineTo(toX(pts[i].x), toY(pts[i].y));
        ctx.stroke();
      }
      ctx.restore();
      ctx.shadowBlur = 0;
    },
  };
}
