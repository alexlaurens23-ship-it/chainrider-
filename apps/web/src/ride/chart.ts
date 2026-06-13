import type { TrackPoint } from "@chainrider/physics";

/** Chart colors: a rising segment glows green, a falling one red (StonkRider feel). */
export const CHART_UP = "#1fd66b";
export const CHART_DOWN = "#ff4d4d";
export const CHART_FLAT = "#5b7184";

export function segmentColor(yA: number, yB: number): string {
  if (yB > yA) return CHART_UP;
  if (yB < yA) return CHART_DOWN;
  return CHART_FLAT;
}

/**
 * Binary-searches the inclusive index range of segments intersecting [xMin, xMax].
 * Returns [startIndex, endIndex] into `points` such that drawing points
 * start..end covers everything visible (plus one segment of margin each side).
 * Assumes points are sorted by ascending x. Used to cull off-screen terrain so
 * large tracks (1000+ points) only touch the ~dozens of visible segments.
 */
export function visibleRange(points: TrackPoint[], xMin: number, xMax: number): [number, number] {
  const n = points.length;
  if (n === 0) return [0, -1];
  const start = Math.max(0, lowerBound(points, xMin) - 1);
  const end = Math.min(n - 1, lowerBound(points, xMax));
  return [start, end];
}

/** First index whose x is >= target (or n if none). */
function lowerBound(points: TrackPoint[], target: number): number {
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid][0] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
