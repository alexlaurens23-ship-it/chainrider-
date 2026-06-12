/**
 * Pure terrain geometry over the (strictly x-increasing) terrain polyline.
 * Plain arithmetic only — no Planck, no allocation surprises, deterministic.
 */
import type { TrackPoint } from "./types";

/** Index of the segment [i, i+1] containing x (clamped to the ends). */
function segmentIndexAt(terrain: readonly TrackPoint[], x: number): number {
  let lo = 0;
  let hi = terrain.length - 2;
  if (x <= terrain[0][0]) return 0;
  if (x >= terrain[hi][0]) return hi;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (terrain[mid][0] <= x) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Terrain surface y at x (linear interpolation, clamped to the ends). */
export function terrainYAt(terrain: readonly TrackPoint[], x: number): number {
  const i = segmentIndexAt(terrain, x);
  const [x0, y0] = terrain[i];
  const [x1, y1] = terrain[i + 1];
  if (x1 === x0) return y0;
  const t = Math.min(1, Math.max(0, (x - x0) / (x1 - x0)));
  return y0 + (y1 - y0) * t;
}

/** Terrain slope angle (radians) of the segment under x. */
export function terrainSlopeAt(terrain: readonly TrackPoint[], x: number): number {
  const i = segmentIndexAt(terrain, x);
  const [x0, y0] = terrain[i];
  const [x1, y1] = terrain[i + 1];
  return Math.atan2(y1 - y0, x1 - x0);
}

/** Wrap an angle to (-π, π]. */
export function wrapAngle(a: number): number {
  const TWO_PI = Math.PI * 2;
  let r = a % TWO_PI;
  if (r > Math.PI) r -= TWO_PI;
  else if (r <= -Math.PI) r += TWO_PI;
  return r;
}

function orient(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

function segmentsIntersect(
  p0x: number,
  p0y: number,
  p1x: number,
  p1y: number,
  q0x: number,
  q0y: number,
  q1x: number,
  q1y: number,
): boolean {
  const d1 = orient(q0x, q0y, q1x, q1y, p0x, p0y);
  const d2 = orient(q0x, q0y, q1x, q1y, p1x, p1y);
  const d3 = orient(p0x, p0y, p1x, p1y, q0x, q0y);
  const d4 = orient(p0x, p0y, p1x, p1y, q1x, q1y);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function distSqPointToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const lenSq = abx * abx + aby * aby;
  let t = lenSq === 0 ? 0 : ((px - ax) * abx + (py - ay) * aby) / lenSq;
  t = Math.min(1, Math.max(0, t));
  const dx = px - (ax + abx * t);
  const dy = py - (ay + aby * t);
  return dx * dx + dy * dy;
}

/**
 * Swept head-vs-terrain death check (X-Moto pattern): true if the circle of
 * `radius` at (x1,y1) overlaps the terrain, or the segment (x0,y0)→(x1,y1)
 * crosses it (catches tunneling on fast face-plants).
 */
export function sweptCircleHitsTerrain(
  terrain: readonly TrackPoint[],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  radius: number,
): boolean {
  const minX = Math.min(x0, x1) - radius;
  const maxX = Math.max(x0, x1) + radius;
  const start = segmentIndexAt(terrain, minX);
  const end = segmentIndexAt(terrain, maxX);
  const rSq = radius * radius;
  for (let i = start; i <= end; i++) {
    const [ax, ay] = terrain[i];
    const [bx, by] = terrain[i + 1];
    if (distSqPointToSegment(x1, y1, ax, ay, bx, by) < rSq) return true;
    if (segmentsIntersect(x0, y0, x1, y1, ax, ay, bx, by)) return true;
  }
  return false;
}
