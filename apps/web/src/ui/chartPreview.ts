import type { TrackPoint } from "@chainrider/physics";
import { segmentColor } from "../ride/chart";

/**
 * Renders a whole track fit-to-canvas as the green-up / red-down chart line
 * with a subtle gradient fill — the static preview used on the map detail page.
 */
export function drawChartPreview(canvas: HTMLCanvasElement, points: TrackPoint[]): void {
  const ctx = canvas.getContext("2d");
  if (!ctx || points.length < 2) return;

  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 600;
  const h = canvas.clientHeight || 320;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const pad = 16;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const sx = (x: number): number => pad + ((x - minX) / spanX) * (w - pad * 2);
  const sy = (y: number): number => h - pad - ((y - minY) / spanY) * (h - pad * 2);

  // Faint horizontal gridlines.
  ctx.strokeStyle = "rgba(91,113,132,0.18)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const gy = pad + (i / 4) * (h - pad * 2);
    ctx.beginPath();
    ctx.moveTo(pad, gy);
    ctx.lineTo(w - pad, gy);
    ctx.stroke();
  }

  // Gradient fill under the line.
  const grad = ctx.createLinearGradient(0, pad, 0, h - pad);
  grad.addColorStop(0, "rgba(0,229,255,0.16)");
  grad.addColorStop(1, "rgba(0,229,255,0)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(sx(points[0][0]), h - pad);
  for (const [x, y] of points) ctx.lineTo(sx(x), sy(y));
  ctx.lineTo(sx(points[points.length - 1][0]), h - pad);
  ctx.closePath();
  ctx.fill();

  // Per-segment colored line.
  ctx.lineWidth = 1.8;
  ctx.lineJoin = "round";
  for (let i = 1; i < points.length; i++) {
    ctx.strokeStyle = segmentColor(points[i - 1][1], points[i][1]);
    ctx.beginPath();
    ctx.moveTo(sx(points[i - 1][0]), sy(points[i - 1][1]));
    ctx.lineTo(sx(points[i][0]), sy(points[i][1]));
    ctx.stroke();
  }
}
