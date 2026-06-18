import { terrainYAt } from "@chainrider/physics";
import type { BikeTune, SimSnapshot, TrackInfo } from "@chainrider/physics";
import { drawBike } from "../shared/bike";
import { createTrail } from "../shared/trail";
import { getActiveSkin, prefersReducedMotion } from "../skins";
import { CHART_UP, segmentColor, visibleRange } from "./chart";
import { MINIMAP_H, MINIMAP_W } from "./hud";

const SHAKE_MS = 250;
const SHAKE_PX = 9;
const CRASH_PARTICLES = 10;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
}

const BASE_PX_PER_M = 26;
const MIN_ZOOM = 0.8; // zoomed out at speed
const SPEED_FOR_MIN_ZOOM = 22; // m/s at which zoom hits MIN_ZOOM
const LEAD_K = 0.32; // lookahead metres per (m/s)
const MAX_LEAD_M = 6;
const CAM_SMOOTH = 0.12; // camera lerp factor per frame

// ── DEV-ONLY collision-shape overlay (REMOVE BEFORE LAUNCH) ─────────────────
// Thin bright outlines of the REAL physics bodies (wheel circles + chassis box)
// over the bike art, to line the sprite up with collision using the B tuner.
// Toggle with `J`, or show on load with ?showbodies=1. Inert until toggled; no
// physics touched (reads the snapshot poses + tune fixture sizes only).
let showBodies = false;
try {
  showBodies = new URLSearchParams(location.search).get("showbodies") === "1";
} catch {
  /* no window — ignore */
}
if (typeof window !== "undefined") {
  window.addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() !== "j") return;
    const el = document.activeElement;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
    showBodies = !showBodies;
  });
}

function drawBodies(
  ctx: CanvasRenderingContext2D,
  toX: (wx: number) => number,
  toY: (wy: number) => number,
  scale: number,
  prev: SimSnapshot,
  curr: SimSnapshot,
  alpha: number,
  tune: BikeTune,
): void {
  ctx.save();
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
  ctx.lineWidth = 1.5;

  // Wheel circles (radius = the real fixture radius) + a spoke to show spin.
  ctx.strokeStyle = "#00ffff";
  for (const key of ["rearWheel", "frontWheel"] as const) {
    const x = toX(lerp(prev[key].x, curr[key].x, alpha));
    const y = toY(lerp(prev[key].y, curr[key].y, alpha));
    const r = tune.wheelRadius * scale;
    const a = -lerp(prev[key].angle, curr[key].angle, alpha);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    ctx.stroke();
  }

  // Chassis collision box.
  const cx = toX(lerp(prev.chassis.x, curr.chassis.x, alpha));
  const cy = toY(lerp(prev.chassis.y, curr.chassis.y, alpha));
  const cAngle = -lerp(prev.chassis.angle, curr.chassis.angle, alpha);
  ctx.strokeStyle = "#ffe000";
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(cAngle);
  ctx.strokeRect(
    (-tune.chassisWidth / 2) * scale,
    (-tune.chassisHeight / 2) * scale,
    tune.chassisWidth * scale,
    tune.chassisHeight * scale,
  );
  ctx.restore();

  ctx.restore();
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export interface RideRenderer {
  render(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    prev: SimSnapshot,
    curr: SimSnapshot,
    alpha: number,
    speed: number,
    tune: BikeTune,
    /** Live input bitmask for the rider lean (cosmetic). */
    mask: number,
  ): void;
  /** Reset camera smoothing + effects (on respawn). */
  reset(spawnX: number, spawnY: number): void;
}

export function createRideRenderer(track: TrackInfo, minimap: HTMLCanvasElement): RideRenderer {
  const terrain = track.terrain;
  let camX = terrain.length ? terrain[0][0] : 0;
  let camY = 0;
  let zoom = 1;

  // Track x-extent + y-extent for gridlines and minimap.
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of terrain) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const bakedMinimap = bakeMinimap(terrain, minX, maxX, minY, maxY);

  // ── Cosmetic effect state (render-only) ──────────────────────────────────
  const trail = createTrail();
  let particles: Particle[] = [];
  let shakeUntil = 0;
  let lastNow = performance.now();
  let lastFlips = 0;
  let lastCombo = 1;
  let lastCrashed = false;
  const reduceMotion = prefersReducedMotion();

  function spawnCrashBurst(wx: number, wy: number): void {
    for (let i = 0; i < CRASH_PARTICLES; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * 5;
      const life = 0.35 + Math.random() * 0.35;
      particles.push({ x: wx, y: wy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp + 2, life, maxLife: life });
    }
  }

  return {
    reset(spawnX, spawnY) {
      camX = spawnX;
      camY = spawnY;
      zoom = 1;
      trail.clear();
      particles = [];
      shakeUntil = 0;
      lastFlips = 0;
      lastCombo = 1;
      lastCrashed = false;
    },

    render(ctx, w, h, prev, curr, alpha, speed, tune, mask) {
      const now = performance.now();
      const dt = Math.min(0.05, (now - lastNow) / 1000);
      lastNow = now;
      const skin = getActiveSkin();
      const chassisX = lerp(prev.chassis.x, curr.chassis.x, alpha);
      const chassisY = lerp(prev.chassis.y, curr.chassis.y, alpha);

      // Speed zoom + smoothed lookahead.
      const targetZoom = lerp(1, MIN_ZOOM, clamp(Math.abs(speed) / SPEED_FOR_MIN_ZOOM, 0, 1));
      zoom += (targetZoom - zoom) * CAM_SMOOTH;
      const pxPerM = BASE_PX_PER_M * zoom;

      const lead = clamp(speed * LEAD_K, -MAX_LEAD_M, MAX_LEAD_M);
      camX += (chassisX + lead - camX) * CAM_SMOOTH;
      camY += (chassisY - camY) * CAM_SMOOTH;
      // Never reveal below the kill floor: keep it at or beneath the bottom edge.
      const halfViewH = h / 2 / pxPerM;
      camY = Math.max(camY, track.killY + halfViewH);

      const toX = (wx: number): number => (wx - camX) * pxPerM + w / 2;
      const toY = (wy: number): number => h / 2 - (wy - camY) * pxPerM;

      // ── Effects: trail, crash burst/shake, combo pulse ──────────────────
      const rearX = lerp(prev.rearWheel.x, curr.rearWheel.x, alpha);
      const rearY = lerp(prev.rearWheel.y, curr.rearWheel.y, alpha);
      if (!curr.crashed) trail.push(rearX, rearY);
      if (curr.flips > lastFlips || curr.combo > lastCombo) trail.pulse();
      if (!lastCrashed && curr.crashed) {
        spawnCrashBurst(chassisX, chassisY);
        if (!reduceMotion) shakeUntil = now + SHAKE_MS;
      }
      lastFlips = curr.flips;
      lastCombo = curr.combo;
      lastCrashed = curr.crashed;
      // Advance particles (real-time; cosmetic).
      for (const p of particles) {
        p.life -= dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy -= 10 * dt; // gravity (world +y up)
      }
      particles = particles.filter((p) => p.life > 0);

      ctx.fillStyle = "#05060a";
      ctx.fillRect(0, 0, w, h);

      // Screen shake wraps the world draw (skipped under reduced motion).
      let shaken = false;
      if (now < shakeUntil) {
        const k = ((shakeUntil - now) / SHAKE_MS) * SHAKE_PX;
        ctx.save();
        ctx.translate((Math.random() - 0.5) * 2 * k, (Math.random() - 0.5) * 2 * k);
        shaken = true;
      }

      const camXMin = camX - w / 2 / pxPerM;
      const camXMax = camX + w / 2 / pxPerM;

      drawGrid(ctx, w, h, toX, toY, camXMin, camXMax, minX, maxX, minY, maxY);
      drawTerrain(ctx, h, toX, toY, terrain, camXMin, camXMax);
      drawMarkers(ctx, w, h, toX, toY, track, tune);

      trail.draw(ctx, toX, toY, skin.trail);
      drawBike(ctx, { toX, toY, scale: pxPerM, prev, curr, alpha, tune, skin, inputMask: mask });
      if (showBodies) drawBodies(ctx, toX, toY, pxPerM, prev, curr, alpha, tune);
      drawParticles(ctx, particles, toX, toY, pxPerM, skin.primary);

      if (shaken) ctx.restore();

      drawMinimap(minimap, bakedMinimap, terrain, chassisX, minX, maxX, minY, maxY);
    },
  };
}

function drawParticles(
  ctx: CanvasRenderingContext2D,
  particles: Particle[],
  toX: (wx: number) => number,
  toY: (wy: number) => number,
  scale: number,
  color: string,
): void {
  if (particles.length === 0) return;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.shadowColor = color;
  for (const p of particles) {
    const a = Math.max(0, p.life / p.maxLife);
    ctx.globalAlpha = a;
    ctx.shadowBlur = 8 * a;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(toX(p.x), toY(p.y), Math.max(1, 0.06 * scale * a), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
}

function drawTerrain(
  ctx: CanvasRenderingContext2D,
  h: number,
  toX: (wx: number) => number,
  toY: (wy: number) => number,
  terrain: TrackInfo["terrain"],
  camXMin: number,
  camXMax: number,
): void {
  const [start, end] = visibleRange(terrain as [number, number][], camXMin, camXMax);
  if (end <= start) return;

  // Gradient fill under the visible line.
  ctx.beginPath();
  ctx.moveTo(toX(terrain[start][0]), h);
  for (let i = start; i <= end; i++) ctx.lineTo(toX(terrain[i][0]), toY(terrain[i][1]));
  ctx.lineTo(toX(terrain[end][0]), h);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "rgba(0, 229, 255, 0.10)");
  grad.addColorStop(1, "rgba(0, 229, 255, 0)");
  ctx.fillStyle = grad;
  ctx.fill();

  // Per-segment colored line: a soft glow halo then a bright core.
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (let pass = 0; pass < 2; pass++) {
    const glow = pass === 0;
    ctx.lineWidth = glow ? 6 : 2;
    ctx.shadowBlur = glow ? 12 : 0;
    ctx.globalAlpha = glow ? 0.35 : 1;
    for (let i = start + 1; i <= end; i++) {
      const color = segmentColor(terrain[i - 1][1], terrain[i][1]);
      ctx.strokeStyle = color;
      ctx.shadowColor = color;
      ctx.beginPath();
      ctx.moveTo(toX(terrain[i - 1][0]), toY(terrain[i - 1][1]));
      ctx.lineTo(toX(terrain[i][0]), toY(terrain[i][1]));
      ctx.stroke();
    }
  }
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  toX: (wx: number) => number,
  toY: (wy: number) => number,
  camXMin: number,
  camXMax: number,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
): void {
  ctx.strokeStyle = "rgba(91, 113, 132, 0.14)";
  ctx.fillStyle = "rgba(91, 113, 132, 0.5)";
  ctx.lineWidth = 1;
  ctx.font = "10px monospace";

  // Horizontal price levels (5 bands across the track's y range).
  const spanY = maxY - minY || 1;
  for (let i = 0; i <= 5; i++) {
    const wy = minY + (i / 5) * spanY;
    const sy = toY(wy);
    if (sy < -20 || sy > h + 20) continue;
    ctx.beginPath();
    ctx.moveTo(0, sy);
    ctx.lineTo(w, sy);
    ctx.stroke();
    ctx.fillText(`L${i}`, 6, sy - 3);
  }

  // Vertical progress ticks every 10% of the chart span.
  const spanX = maxX - minX || 1;
  const step = spanX / 10;
  const firstK = Math.max(0, Math.floor((camXMin - minX) / step));
  const lastK = Math.min(10, Math.ceil((camXMax - minX) / step));
  for (let k = firstK; k <= lastK; k++) {
    const wx = minX + k * step;
    const sx = toX(wx);
    ctx.beginPath();
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, h);
    ctx.stroke();
    ctx.fillText(`${k * 10}%`, sx + 4, h - 8);
  }
}

function drawMarkers(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  toX: (wx: number) => number,
  toY: (wy: number) => number,
  track: TrackInfo,
  tune: BikeTune,
): void {
  // Kill floor.
  const killY = toY(track.killY);
  if (killY < h + 50) {
    ctx.strokeStyle = "rgba(255, 60, 60, 0.5)";
    ctx.setLineDash([12, 8]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, killY);
    ctx.lineTo(w, killY);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Checkpoints.
  ctx.strokeStyle = "rgba(255, 230, 0, 0.6)";
  ctx.lineWidth = 2;
  for (const cp of track.checkpoints) {
    const sx = toX(cp.x);
    if (sx < -20 || sx > w + 20) continue;
    const sy = toY(cp.y - tune.wheelRadius - tune.axleDropY);
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx, sy - 24);
    ctx.stroke();
  }

  // Finish flag.
  const fx = toX(track.finishX);
  if (fx > -20 && fx < w + 20) {
    ctx.strokeStyle = "#00ff88";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(fx, 0);
    ctx.lineTo(fx, h);
    ctx.stroke();
  }
}

// ── Minimap (whole track baked once, position dot live) ─────────────────────

function bakeMinimap(
  terrain: TrackInfo["terrain"],
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
): HTMLCanvasElement {
  const off = document.createElement("canvas");
  const dpr = window.devicePixelRatio || 1;
  off.width = Math.floor(MINIMAP_W * dpr);
  off.height = Math.floor(MINIMAP_H * dpr);
  const ctx = off.getContext("2d");
  if (!ctx) return off;
  ctx.scale(dpr, dpr);

  const pad = 5;
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const sx = (x: number): number => pad + ((x - minX) / spanX) * (MINIMAP_W - pad * 2);
  const sy = (y: number): number => MINIMAP_H - pad - ((y - minY) / spanY) * (MINIMAP_H - pad * 2);

  ctx.strokeStyle = "rgba(0, 229, 255, 0.7)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  const stride = Math.max(1, Math.floor(terrain.length / MINIMAP_W));
  for (let i = 0; i < terrain.length; i += stride) {
    const px = sx(terrain[i][0]);
    const py = sy(terrain[i][1]);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
  return off;
}

function drawMinimap(
  minimap: HTMLCanvasElement,
  baked: HTMLCanvasElement,
  terrain: TrackInfo["terrain"],
  chassisX: number,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
): void {
  const ctx = minimap.getContext("2d");
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, minimap.width, minimap.height);
  ctx.drawImage(baked, 0, 0);
  ctx.scale(dpr, dpr);

  const pad = 5;
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const t = clamp((chassisX - minX) / spanX, 0, 1);
  const dotX = pad + t * (MINIMAP_W - pad * 2);
  // Ride the dot on the polyline: sample the track y at the bike's x and map it
  // through the same transform the baked line uses.
  const trackY = terrainYAt(terrain, chassisX);
  const dotY = MINIMAP_H - pad - ((trackY - minY) / spanY) * (MINIMAP_H - pad * 2);
  ctx.fillStyle = CHART_UP;
  ctx.shadowColor = CHART_UP;
  ctx.shadowBlur = 6;
  ctx.beginPath();
  ctx.arc(dotX, dotY, 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
}
