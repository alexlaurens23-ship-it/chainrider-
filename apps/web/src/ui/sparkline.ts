import type { TrackPoint } from "@chainrider/physics";

/**
 * Draws a thin min/max-normalized polyline of a track's y-values into a canvas.
 * Points are downsampled to at most one sample per horizontal pixel.
 */
export function drawSparkline(canvas: HTMLCanvasElement, points: TrackPoint[], accent: string): void {
  const ctx = canvas.getContext("2d");
  if (!ctx || points.length < 2) return;

  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 220;
  const h = canvas.clientHeight || 48;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const pad = 4;
  const sampleCount = Math.min(points.length, Math.max(2, Math.floor(w)));
  const ys: number[] = new Array(sampleCount);
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < sampleCount; i++) {
    const src = points[Math.floor((i * (points.length - 1)) / (sampleCount - 1))][1];
    ys[i] = src;
    if (src < minY) minY = src;
    if (src > maxY) maxY = src;
  }
  const span = maxY - minY || 1;

  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = "round";
  ctx.shadowColor = accent;
  ctx.shadowBlur = 6;
  ctx.beginPath();
  for (let i = 0; i < sampleCount; i++) {
    const x = pad + (i / (sampleCount - 1)) * (w - pad * 2);
    const y = h - pad - ((ys[i] - minY) / span) * (h - pad * 2);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.shadowBlur = 0;
}
