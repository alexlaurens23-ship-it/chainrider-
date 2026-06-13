/**
 * Pure, deterministic track generation: daily closes -> terrain polylines.
 *
 * MUST stay free of I/O and nondeterminism: no fetch, no Date, no Math.random,
 * no Math.pow (not IEEE-pinned), no toFixed/locale formatting. Every emitted
 * coordinate passes through round4 so JSON.stringify output is byte-identical
 * across runs (golden-tested in test/trackgen.test.ts).
 *
 * External data fetching lives in chartdata.ts only.
 */

/** World metres of x per daily candle. */
export const SPACING_M = 6;
/** No raw segment may exceed this absolute slope. */
export const MAX_SLOPE_DEG = 55;
/** Height band (price range -> y span) bounds, scaled by realized volatility. */
export const MIN_BAND_M = 25;
export const MAX_BAND_M = 90;
/** ALL-period series are stride-downsampled to at most this many candles. */
export const MAX_CANDLES = 1000;

/** Daily log-return stdev that maps to the full MAX_BAND_M (memecoin territory). */
const VOL_REF = 0.1;
/** Keeps post-rounding slopes strictly under MAX_SLOPE_DEG. */
const SLOPE_SAFETY = 0.9999;
/** Max |dy| over one SPACING_M segment at MAX_SLOPE_DEG. */
const SEGMENT_DY_LIMIT = SPACING_M * Math.tan((MAX_SLOPE_DEG * Math.PI) / 180);

/** [x, y] in world metres; x strictly increasing (required by the physics terrain). */
export type TrackPoint = [number, number];

export type Difficulty = "easy" | "medium" | "hard" | "insane";

/** Difficulty tiers — each generates a separate, more dramatic terrain. */
export type Tier = "CHILL" | "VOLATILE" | "DEGEN";
export const TIERS: readonly Tier[] = ["CHILL", "VOLATILE", "DEGEN"];

/** Per-tier terrain knobs. amplify scales vertical deviation; roughness adds bumps (m). */
export const TIER_CONFIG: Record<Tier, { amplify: number; roughness: number }> = {
  CHILL: { amplify: 1.0, roughness: 0.0 },
  VOLATILE: { amplify: 1.8, roughness: 0.4 },
  DEGEN: { amplify: 2.8, roughness: 0.9 },
};

export interface TrackStats {
  /** x-span of the polyline in metres (the sim adds its own lead-in/run-out). */
  worldLength: number;
  maxSlopeDeg: number;
  /** Population stdev of segment slope angles, degrees. */
  volatility: number;
  difficulty: Difficulty;
  pointCount: number;
}

const round4 = (v: number): number => Math.round(v * 1e4) / 1e4;

function assertTrack(points: readonly TrackPoint[]): void {
  if (points.length < 2) throw new Error("track needs at least 2 points");
  for (let i = 0; i < points.length; i++) {
    const [x, y] = points[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error(`non-finite coordinate at index ${i}`);
    }
    if (i > 0 && x <= points[i - 1][0]) {
      throw new Error(`x must be strictly increasing (index ${i})`);
    }
  }
}

/**
 * Deterministic stride pick down to `max` samples; always keeps first and last.
 * Used for ALL-period series so tracks stay a playable length.
 */
export function downsample(closes: readonly number[], max: number = MAX_CANDLES): number[] {
  const n = closes.length;
  if (n <= max) return closes.slice();
  const out = new Array<number>(max);
  for (let i = 0; i < max; i++) {
    out[i] = closes[Math.floor((i * (n - 1)) / (max - 1))];
  }
  return out;
}

/**
 * Closes -> polyline. x[i] = i * SPACING_M. The price range is mapped onto a
 * height band scaled by realized volatility (stdev of daily log returns),
 * then the whole profile is vertically compressed in one global rescale if any
 * segment would exceed MAX_SLOPE_DEG — a single y-scale preserves the chart
 * shape exactly, unlike per-segment clamping. The slope clamp wins over
 * MIN_BAND_M for spiky data.
 */
export function normalize(closes: readonly number[]): TrackPoint[] {
  if (closes.length < 10) throw new Error("need at least 10 closes");
  for (let i = 0; i < closes.length; i++) {
    if (!Number.isFinite(closes[i]) || closes[i] <= 0) {
      throw new Error(`invalid close at index ${i}`);
    }
  }

  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    returns.push(Math.log(closes[i] / closes[i - 1]));
  }
  const vol = populationStdev(returns);
  const band = MIN_BAND_M + (MAX_BAND_M - MIN_BAND_M) * Math.min(vol / VOL_REF, 1);

  let pMin = Infinity;
  let pMax = -Infinity;
  for (const c of closes) {
    if (c < pMin) pMin = c;
    if (c > pMax) pMax = c;
  }
  const range = pMax - pMin;

  const ys = closes.map((c) => (range === 0 ? 0 : ((c - pMin) / range) * band));

  let maxAbsDy = 0;
  for (let i = 1; i < ys.length; i++) {
    const dy = Math.abs(ys[i] - ys[i - 1]);
    if (dy > maxAbsDy) maxAbsDy = dy;
  }
  if (maxAbsDy > SEGMENT_DY_LIMIT) {
    const scale = (SEGMENT_DY_LIMIT * SLOPE_SAFETY) / maxAbsDy;
    for (let i = 0; i < ys.length; i++) ys[i] *= scale;
  }

  return ys.map((y, i) => [i * SPACING_M, round4(y)]);
}

/**
 * Scales each point's vertical deviation from the track's mean line by `factor`,
 * making price moves dramatically taller. factor === 1 is an exact identity
 * (so CHILL stays byte-identical to normalize). x is untouched.
 */
export function amplify(points: readonly TrackPoint[], factor: number): TrackPoint[] {
  if (factor === 1) return points.map(([x, y]) => [x, y]);
  let sum = 0;
  for (const [, y] of points) sum += y;
  const meanY = sum / points.length;
  return points.map(([x, y]) => [x, round4(meanY + (y - meanY) * factor)]);
}

/** Deterministic 32-bit FNV-1a hash of the (rounded) point coordinates. */
function hashPoints(points: readonly TrackPoint[]): number {
  let h = 0x811c9dc5;
  for (const [x, y] of points) {
    for (const v of [Math.round(x * 1e4), Math.round(y * 1e4)]) {
      // Mix the integer's bytes (handles negatives via >>> 0).
      let u = v >>> 0;
      for (let b = 0; b < 4; b++) {
        h ^= u & 0xff;
        h = Math.imul(h, 0x01000193);
        u >>>= 8;
      }
    }
  }
  return h >>> 0;
}

/** Seeded PRNG (mulberry32) → deterministic floats in [0, 1). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Adds a deterministic high-frequency noise layer (±intensity m) on top of the
 * macro chart shape — small kickers that create airtime even on flat stretches.
 * Seeded by a hash of the input points (NOT Math.random) so it is reproducible
 * and golden-stable. intensity === 0 is an exact identity. Endpoints are left
 * fixed so the sim's lead-in/run-out attach cleanly.
 */
export function roughness(points: readonly TrackPoint[], intensity: number): TrackPoint[] {
  if (intensity === 0) return points.map(([x, y]) => [x, y]);
  const prng = mulberry32(hashPoints(points));
  const n = points.length;
  return points.map(([x, y], i) => {
    if (i === 0 || i === n - 1) return [x, y];
    return [x, round4(y + (prng() * 2 - 1) * intensity)];
  });
}

/**
 * Per-segment slope clamp: caps each segment's |dy| at the 55° limit, walking
 * left→right and rebuilding y cumulatively. Unlike normalize's global rescale
 * (which lets one spike squash the whole track), this makes amplified tracks
 * hit ~55° OFTEN — sustained challenge. If nothing exceeds the limit it is an
 * exact identity (so an already-tame CHILL track is untouched).
 */
export function clampSlopeSegments(points: readonly TrackPoint[]): TrackPoint[] {
  let maxAbsDy = 0;
  for (let i = 1; i < points.length; i++) {
    const dy = Math.abs(points[i][1] - points[i - 1][1]);
    if (dy > maxAbsDy) maxAbsDy = dy;
  }
  if (maxAbsDy <= SEGMENT_DY_LIMIT) return points.map(([x, y]) => [x, y]);

  const limit = SEGMENT_DY_LIMIT * SLOPE_SAFETY;
  const out: TrackPoint[] = [[points[0][0], round4(points[0][1])]];
  for (let i = 1; i < points.length; i++) {
    const dy = points[i][1] - points[i - 1][1];
    const capped = dy > limit ? limit : dy < -limit ? -limit : dy;
    out.push([points[i][0], round4(out[i - 1][1] + capped)]);
  }
  return out;
}

/**
 * Full tier pipeline: normalize → amplify → roughness → per-segment clamp.
 * CHILL (amplify 1, roughness 0) is byte-identical to normalize(closes); the
 * harder tiers get taller, bumpier, and steeper-more-often terrain.
 */
export function generateTier(closes: readonly number[], tier: Tier): TrackPoint[] {
  const cfg = TIER_CONFIG[tier];
  const base = normalize(closes);
  const amplified = amplify(base, cfg.amplify);
  const rough = roughness(amplified, cfg.roughness);
  return clampSlopeSegments(rough);
}

/** The polyline as-is (validated fresh copy) — "raw" mode. */
export function rawTrack(points: readonly TrackPoint[]): TrackPoint[] {
  assertTrack(points);
  return points.map(([x, y]) => [x, y]);
}

/**
 * Centripetal Catmull-Rom (alpha = 0.5) through the points, resampled to
 * ~1 vertex per metre of arc length — "smooth" mode. Endpoints are pinned to
 * the raw endpoints so lead-in/run-out heights match raw mode. Output x is
 * guaranteed strictly increasing (the spline can locally overshoot backward
 * in x near steep sections; offending samples are dropped, not clamped —
 * clamping would create near-vertical micro-segments).
 */
export function smoothTrack(points: readonly TrackPoint[]): TrackPoint[] {
  assertTrack(points);
  const n = points.length;
  if (n === 2) return resamplePolyline(points);

  // Phantom endpoints by reflection; never duplicate endpoints (a zero chord
  // gives a zero knot interval -> division by zero in centripetal CR).
  const first = points[0];
  const second = points[1];
  const last = points[n - 1];
  const penult = points[n - 2];
  const pre: TrackPoint = [2 * first[0] - second[0], 2 * first[1] - second[1]];
  const post: TrackPoint = [2 * last[0] - penult[0], 2 * last[1] - penult[1]];

  const dense: TrackPoint[] = [];
  for (let i = 0; i < n - 1; i++) {
    const p0 = i === 0 ? pre : points[i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = i === n - 2 ? post : points[i + 2];
    sampleSegment(p0, p1, p2, p3, dense);
  }
  dense.push([last[0], last[1]]);

  return resamplePolyline(dense, first, last);
}

/** worldLength / maxSlopeDeg / slope volatility / difficulty for a polyline. */
export function stats(points: readonly TrackPoint[]): TrackStats {
  assertTrack(points);
  const angles: number[] = [];
  let maxSlope = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i][0] - points[i - 1][0];
    const dy = points[i][1] - points[i - 1][1];
    const deg = (Math.atan(Math.abs(dy) / dx) * 180) / Math.PI;
    angles.push(deg);
    if (deg > maxSlope) maxSlope = deg;
  }
  const maxSlopeDeg = round4(maxSlope);
  return {
    worldLength: round4(points[points.length - 1][0] - points[0][0]),
    maxSlopeDeg,
    volatility: round4(populationStdev(angles)),
    difficulty: difficultyFor(maxSlopeDeg),
    pointCount: points.length,
  };
}

export function difficultyFor(maxSlopeDeg: number): Difficulty {
  if (maxSlopeDeg < 20) return "easy";
  if (maxSlopeDeg < 32) return "medium";
  if (maxSlopeDeg < 45) return "hard";
  return "insane";
}

function populationStdev(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  const mean = sum / values.length;
  let sq = 0;
  for (const v of values) sq += (v - mean) * (v - mean);
  return Math.sqrt(sq / values.length);
}

/** Centripetal knot increment: dist^0.5 via nested sqrt (Math.pow is banned). */
function knotStep(a: TrackPoint, b: TrackPoint): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  return Math.sqrt(Math.sqrt(dx * dx + dy * dy));
}

/**
 * Dense-samples one CR segment (p1 -> p2) via Barry-Goldman, appending to
 * `out`. Includes t = p1, excludes p2 (the next segment or the caller adds it).
 */
function sampleSegment(
  p0: TrackPoint,
  p1: TrackPoint,
  p2: TrackPoint,
  p3: TrackPoint,
  out: TrackPoint[],
): void {
  const t0 = 0;
  const t1 = t0 + knotStep(p0, p1);
  const t2 = t1 + knotStep(p1, p2);
  const t3 = t2 + knotStep(p2, p3);

  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  const chord = Math.sqrt(dx * dx + dy * dy);
  const k = Math.max(8, Math.ceil(chord) * 4);

  for (let j = 0; j < k; j++) {
    const t = t1 + ((t2 - t1) * j) / k;
    const a1x = ((t1 - t) * p0[0] + (t - t0) * p1[0]) / (t1 - t0);
    const a1y = ((t1 - t) * p0[1] + (t - t0) * p1[1]) / (t1 - t0);
    const a2x = ((t2 - t) * p1[0] + (t - t1) * p2[0]) / (t2 - t1);
    const a2y = ((t2 - t) * p1[1] + (t - t1) * p2[1]) / (t2 - t1);
    const a3x = ((t3 - t) * p2[0] + (t - t2) * p3[0]) / (t3 - t2);
    const a3y = ((t3 - t) * p2[1] + (t - t2) * p3[1]) / (t3 - t2);
    const b1x = ((t2 - t) * a1x + (t - t0) * a2x) / (t2 - t0);
    const b1y = ((t2 - t) * a1y + (t - t0) * a2y) / (t2 - t0);
    const b2x = ((t3 - t) * a2x + (t - t1) * a3x) / (t3 - t1);
    const b2y = ((t3 - t) * a2y + (t - t1) * a3y) / (t3 - t1);
    out.push([
      ((t2 - t) * b1x + (t - t1) * b2x) / (t2 - t1),
      ((t2 - t) * b1y + (t - t1) * b2y) / (t2 - t1),
    ]);
  }
}

/**
 * Resamples a dense polyline to 1 vertex per metre of arc length, rounds,
 * pins the first/last points, and enforces strictly increasing x.
 */
function resamplePolyline(
  dense: readonly TrackPoint[],
  firstPin?: TrackPoint,
  lastPin?: TrackPoint,
): TrackPoint[] {
  const first = firstPin ?? dense[0];
  const last = lastPin ?? dense[dense.length - 1];

  // Cumulative arc length table over the dense samples.
  const cum = new Array<number>(dense.length);
  cum[0] = 0;
  for (let i = 1; i < dense.length; i++) {
    const dx = dense[i][0] - dense[i - 1][0];
    const dy = dense[i][1] - dense[i - 1][1];
    cum[i] = cum[i - 1] + Math.sqrt(dx * dx + dy * dy);
  }
  const total = cum[dense.length - 1];

  const out: TrackPoint[] = [[round4(first[0]), round4(first[1])]];
  let seg = 0;
  for (let s = 1; s < total; s++) {
    while (seg < dense.length - 2 && cum[seg + 1] < s) seg++;
    const span = cum[seg + 1] - cum[seg];
    const u = span === 0 ? 0 : (s - cum[seg]) / span;
    const x = round4(dense[seg][0] + (dense[seg + 1][0] - dense[seg][0]) * u);
    const y = round4(dense[seg][1] + (dense[seg + 1][1] - dense[seg][1]) * u);
    // Monotonic-x guard: drop samples that step backward/sideways in x.
    if (x > out[out.length - 1][0]) out.push([x, y]);
  }

  // Exact final point always wins over any resampled neighbor.
  const fx = round4(last[0]);
  const fy = round4(last[1]);
  while (out.length > 0 && out[out.length - 1][0] >= fx) out.pop();
  out.push([fx, fy]);
  return out;
}
