import { describe, expect, it } from "vitest";
import {
  MAX_BAND_M,
  MAX_CANDLES,
  RIDEABLE_MAX_SLOPE_DEG,
  SPACING_M,
  amplify,
  clampSlope,
  difficultyFor,
  downsample,
  generateTier,
  makeRideable,
  normalize,
  rawTrack,
  roughness,
  smoothSpikes,
  smoothTrack,
  stats,
  type TrackPoint,
} from "../src/trackgen.js";

/** Count segments at or above `thr` degrees — the "sustained challenge" metric.
 *  Threshold sits below the rideable clamp (36°) so escalation is still visible. */
function steepCount(points: TrackPoint[], thr = 30): number {
  let c = 0;
  for (let i = 1; i < points.length; i++) {
    const deg =
      (Math.atan(Math.abs(points[i][1] - points[i - 1][1]) / (points[i][0] - points[i - 1][0])) *
        180) /
      Math.PI;
    if (deg >= thr) c++;
  }
  return c;
}

// ~24 closes with a violent spike so the 55-degree clamp engages.
const SPIKY_CLOSES = [
  100, 102, 99, 104, 108, 105, 111, 118, 114, 122, 240, 130, 126, 133, 129, 138, 145, 141, 152,
  148, 158, 163, 159, 168,
];

// Gentle drift: low vol, clamp must NOT engage.
const CALM_CLOSES = [
  100, 100.5, 101.2, 100.8, 101.5, 102.1, 101.7, 102.4, 103.0, 102.6, 103.3, 103.9,
];

// ── Golden strings ──────────────────────────────────────────────────────────
// Generated once from the implementation (scripts/gen-golden.ts era) and
// frozen: generation must stay byte-identical so track audits are
// reproducible. If a deliberate algorithm change breaks these, that is a
// track-generation version change — regenerate consciously, never casually.

const SPIKY_NORMALIZED =
  "[[0,0.0726],[6,0.2178],[12,0],[18,0.3631],[24,0.6535],[30,0.4357],[36,0.8713],[42,1.3796],[48,1.0892],[54,1.67],[60,10.2381],[66,2.2509],[72,1.9605],[78,2.4688],[84,2.1783],[90,2.8318],[96,3.3401],[102,3.0496],[108,3.8484],[114,3.5579],[120,4.284],[126,4.6471],[132,4.3566],[138,5.0101]]";

const SPIKY_RAW_STATS =
  '{"worldLength":138,"maxSlopeDeg":54.9975,"volatility":14.2101,"difficulty":"insane","pointCount":24,"difficultyScore":0.08696483}';

const SPIKY_SMOOTH_STATS =
  '{"worldLength":138,"maxSlopeDeg":64.1268,"volatility":18.0644,"difficulty":"insane","pointCount":149,"difficultyScore":0.12838966}';

const CALM_NORMALIZED =
  "[[0,0],[6,3.586],[12,8.6065],[18,5.7376],[24,10.7581],[30,15.0613],[36,12.1925],[42,17.2129],[48,21.5161],[54,18.6473],[60,23.6678],[66,27.971]]";

const CALM_RAW_STATS =
  '{"worldLength":66,"maxSlopeDeg":39.9209,"volatility":5.8168,"difficulty":"hard","pointCount":12,"difficultyScore":0.63639765}';

const CALM_SMOOTH =
  "[[0,0],[0.8634,0.5044],[1.7335,0.9973],[2.6052,1.4874],[3.4735,1.9834],[4.3332,2.4942],[5.1791,3.0274],[6.0057,3.5902],[6.7779,4.2245],[7.4896,4.9268],[8.171,5.6586],[8.8476,6.395],[9.5439,7.1127],[10.29,7.7778],[11.1254,8.3242],[12.0763,8.6111],[13.0508,8.4331],[13.9268,7.9539],[14.7389,7.3707],[15.5365,6.7676],[16.3648,6.2082],[17.275,5.8019],[18.2624,5.7878],[19.1786,6.1784],[19.9853,6.7674],[20.7183,7.4472],[21.4106,8.1687],[22.088,8.9043],[22.7736,9.6323],[23.4908,10.3288],[24.2607,10.9667],[25.0158,11.622],[25.7495,12.3015],[26.4825,12.9818],[27.2351,13.6401],[28.0302,14.246],[28.8944,14.7467],[29.8459,15.0421],[30.8314,14.948],[31.7284,14.511],[32.552,13.9443],[33.3513,13.3434],[34.1713,12.7716],[35.0614,12.3208],[36.0432,12.1998],[36.9842,12.5232],[37.8128,13.0804],[38.5591,13.7453],[39.258,14.4604],[39.9368,15.1947],[40.6185,15.9263],[41.3265,16.6323],[42.0866,17.2814],[42.8498,17.9274],[43.5864,18.6037],[44.3178,19.2856],[45.0641,19.951],[45.8475,20.5722],[46.6938,21.103],[47.6262,21.4567],[48.6166,21.4641],[49.536,21.0793],[50.3718,20.5312],[51.1725,19.9321],[51.9839,19.348],[52.8539,18.8578],[53.8208,18.6362],[54.784,18.8789],[55.6361,19.3984],[56.3976,20.0458],[57.1044,20.7529],[57.7856,21.485],[58.4647,22.219],[59.1647,22.9331],[59.9118,23.5971],[60.7055,24.2054],[61.51,24.7993],[62.322,25.3829],[63.1389,25.9597],[63.9584,26.5328],[64.7779,27.1059],[65.5952,27.6821],[66,27.971]]";

const CALM_SMOOTH_STATS =
  '{"worldLength":66,"maxSlopeDeg":47.4234,"volatility":11.1365,"difficulty":"insane","pointCount":83,"difficultyScore":0.56100977}';

describe("golden determinism (byte-identical generation)", () => {
  it("normalize(SPIKY) matches the golden string", () => {
    expect(JSON.stringify(normalize(SPIKY_CLOSES))).toBe(SPIKY_NORMALIZED);
  });

  it("normalize(CALM) matches the golden string", () => {
    expect(JSON.stringify(normalize(CALM_CLOSES))).toBe(CALM_NORMALIZED);
  });

  it("smoothTrack(normalize(CALM)) matches the golden string", () => {
    expect(JSON.stringify(smoothTrack(normalize(CALM_CLOSES)))).toBe(CALM_SMOOTH);
  });

  it("stats match the golden strings for both modes of both fixtures", () => {
    expect(JSON.stringify(stats(rawTrack(normalize(SPIKY_CLOSES))))).toBe(SPIKY_RAW_STATS);
    expect(JSON.stringify(stats(smoothTrack(normalize(SPIKY_CLOSES))))).toBe(SPIKY_SMOOTH_STATS);
    expect(JSON.stringify(stats(rawTrack(normalize(CALM_CLOSES))))).toBe(CALM_RAW_STATS);
    expect(JSON.stringify(stats(smoothTrack(normalize(CALM_CLOSES))))).toBe(CALM_SMOOTH_STATS);
  });

  it("two runs in the same process produce identical bytes", () => {
    const a = JSON.stringify(smoothTrack(normalize(SPIKY_CLOSES)));
    const b = JSON.stringify(smoothTrack(normalize(SPIKY_CLOSES)));
    expect(b).toBe(a);
  });
});

// ── Difficulty tiers ────────────────────────────────────────────────────────
const SPIKY_VOLATILE =
  "[[0,-1.8952],[6,-1.7984],[12,-1.6563],[18,-1.4372],[24,-1.149],[30,-0.8173],[36,-0.4009],[42,0.3844],[48,1.969],[54,4.0804],[60,5.3831],[66,4.9811],[72,3.68],[78,2.8228],[84,2.7743],[90,3.1531],[96,3.6275],[102,4.0894],[108,4.5358],[114,4.9927],[120,5.4721],[126,5.9651],[132,6.4704],[138,6.9923]]";

const SPIKY_DEGEN =
  "[[0,-4.3548],[6,-4.2057],[12,-3.9484],[18,-3.5381],[24,-3.0626],[30,-2.6083],[36,-2.0379],[42,-0.8231],[48,1.69],[54,5.0152],[60,7.0324],[66,6.326],[72,4.1962],[78,2.8438],[84,2.8652],[90,3.5702],[96,4.3677],[102,5.1161],[108,5.8537],[114,6.583],[120,7.2394],[126,7.8399],[132,8.5564],[138,9.4702]]";

const SPIKY_SAVAGE =
  "[[0,-6.3226],[6,-6.0109],[12,-5.6231],[18,-5.2072],[24,-4.8245],[30,-4.3839],[36,-3.6355],[42,-1.9967],[48,1.2958],[54,5.6137],[60,8.2365],[66,7.3277],[72,4.5229],[78,2.6553],[84,2.6018],[90,3.5536],[96,4.6132],[102,5.428],[108,6.1655],[114,7.1038],[120,8.1905],[126,9.2228],[132,10.2643],[138,11.4524]]";

describe("difficulty tiers", () => {
  it("VOLATILE/DEGEN/SAVAGE match their golden strings (seeded roughness is deterministic)", () => {
    expect(JSON.stringify(generateTier(SPIKY_CLOSES, "VOLATILE"))).toBe(SPIKY_VOLATILE);
    expect(JSON.stringify(generateTier(SPIKY_CLOSES, "DEGEN"))).toBe(SPIKY_DEGEN);
    expect(JSON.stringify(generateTier(SPIKY_CLOSES, "SAVAGE"))).toBe(SPIKY_SAVAGE);
  });

  it("roughness is reproducible across runs", () => {
    const a = JSON.stringify(generateTier(SPIKY_CLOSES, "SAVAGE"));
    const b = JSON.stringify(generateTier(SPIKY_CLOSES, "SAVAGE"));
    expect(b).toBe(a);
  });

  // A longer varied series with headroom (a short series saturates to ~all-steep
  // at DEGEN, leaving nothing for SAVAGE to exceed). Deterministic test fixture.
  const VARIED_CLOSES = Array.from(
    { length: 50 },
    (_, i) => 100 + 22 * Math.sin(i * 0.7) + 9 * Math.sin(i * 1.9) + 4 * Math.cos(i * 0.4),
  );

  it("harder tiers hit steep grades far more often (sustained challenge escalates)", () => {
    const volatile = generateTier(VARIED_CLOSES, "VOLATILE");
    const degen = generateTier(VARIED_CLOSES, "DEGEN");
    const savage = generateTier(VARIED_CLOSES, "SAVAGE");
    expect(steepCount(volatile)).toBeLessThan(steepCount(degen));
    expect(steepCount(degen)).toBeLessThan(steepCount(savage));
  });

  it("shorter-period amplitude makes the same tier steeper more often", () => {
    const oneYear = generateTier(VARIED_CLOSES, "VOLATILE", 1.0);
    const sixMonth = generateTier(VARIED_CLOSES, "VOLATILE", 1.25);
    const threeMonth = generateTier(VARIED_CLOSES, "VOLATILE", 1.5);
    expect(steepCount(sixMonth)).toBeGreaterThan(steepCount(oneYear));
    expect(steepCount(threeMonth)).toBeGreaterThan(steepCount(sixMonth));
  });

  it("periodAmp = 1 leaves the tier output unchanged (golden-stable)", () => {
    expect(JSON.stringify(generateTier(SPIKY_CLOSES, "DEGEN", 1))).toBe(SPIKY_DEGEN);
  });

  it("never exceeds the rideable clamp on any tier or period amplitude", () => {
    for (const tier of ["VOLATILE", "DEGEN", "SAVAGE"] as const) {
      for (const amp of [1.0, 1.25, 1.5]) {
        expect(stats(generateTier(SPIKY_CLOSES, tier, amp)).maxSlopeDeg).toBeLessThanOrEqual(
          RIDEABLE_MAX_SLOPE_DEG,
        );
        expect(stats(generateTier(CALM_CLOSES, tier, amp)).maxSlopeDeg).toBeLessThanOrEqual(
          RIDEABLE_MAX_SLOPE_DEG,
        );
      }
    }
  });

  it("amplify(_,1) and roughness(_,0) are exact identities", () => {
    const pts = normalize(SPIKY_CLOSES);
    expect(JSON.stringify(amplify(pts, 1))).toBe(JSON.stringify(pts));
    expect(JSON.stringify(roughness(pts, 0))).toBe(JSON.stringify(pts));
  });
});

describe("rideability (P9.5: smoothSpikes / clampSlope / makeRideable)", () => {
  // A vertical-walled spike track: 0→big up→big down at 6 m spacing (≈80°+ walls).
  const WALLS: TrackPoint[] = [
    [0, 0],
    [6, 35],
    [12, 0],
    [18, 35],
    [24, 0],
    [30, 0],
  ];
  const grad = (p: TrackPoint[]): number => stats(p).maxSlopeDeg;

  it("clampSlope caps every segment at the given angle (dx-aware), x untouched", () => {
    const clamped = clampSlope(WALLS, RIDEABLE_MAX_SLOPE_DEG);
    expect(grad(clamped)).toBeLessThanOrEqual(RIDEABLE_MAX_SLOPE_DEG);
    expect(clamped.map(([x]) => x)).toEqual(WALLS.map(([x]) => x));
  });

  it("clampSlope honours actual dx (1 m vertices clamp tighter than 6 m)", () => {
    const oneMetre: TrackPoint[] = [
      [0, 0],
      [1, 5],
      [2, 0],
    ];
    const clamped = clampSlope(oneMetre, 36);
    // 36° over 1 m allows |dy| ≈ tan(36°) ≈ 0.73 m, far less than the raw 5 m step.
    expect(Math.abs(clamped[1][1] - clamped[0][1])).toBeLessThan(0.75);
  });

  it("smoothSpikes softens peaks, pins endpoints, preserves x and point count", () => {
    const smoothed = smoothSpikes(WALLS, 4);
    expect(smoothed.length).toBe(WALLS.length);
    expect(smoothed[0]).toEqual([WALLS[0][0], WALLS[0][1]]);
    expect(smoothed[smoothed.length - 1]).toEqual([WALLS[5][0], WALLS[5][1]]);
    expect(smoothed.map(([x]) => x)).toEqual(WALLS.map(([x]) => x));
    expect(grad(smoothed)).toBeLessThan(grad(WALLS)); // peaks are lower/rounder
  });

  it("smoothSpikes(_, 0) is an exact identity", () => {
    expect(JSON.stringify(smoothSpikes(WALLS, 0))).toBe(JSON.stringify(WALLS));
  });

  it("makeRideable brings vertical walls under the rideable cap, x preserved", () => {
    expect(grad(WALLS)).toBeGreaterThan(RIDEABLE_MAX_SLOPE_DEG); // precondition: a wall
    const ride = makeRideable(WALLS);
    expect(grad(ride)).toBeLessThanOrEqual(RIDEABLE_MAX_SLOPE_DEG);
    expect(ride.map(([x]) => x)).toEqual(WALLS.map(([x]) => x)); // in-place safe (x grid intact)
    expect(ride.length).toBe(WALLS.length);
  });

  it("makeRideable is deterministic (byte-identical across runs)", () => {
    expect(JSON.stringify(makeRideable(WALLS))).toBe(JSON.stringify(makeRideable(WALLS)));
  });
});

describe("normalize", () => {
  it("spaces x at SPACING_M per candle", () => {
    const points = normalize(CALM_CLOSES);
    points.forEach(([x], i) => expect(x).toBe(i * SPACING_M));
  });

  it("never exceeds 55 degrees on any segment (clamp engages on spiky data)", () => {
    expect(stats(normalize(SPIKY_CLOSES)).maxSlopeDeg).toBeLessThanOrEqual(55);
  });

  it("keeps y extent within the max height band", () => {
    for (const closes of [SPIKY_CLOSES, CALM_CLOSES]) {
      const ys = normalize(closes).map(([, y]) => y);
      expect(Math.max(...ys) - Math.min(...ys)).toBeLessThanOrEqual(MAX_BAND_M);
    }
  });

  it("maps flat closes to all-zero y", () => {
    const points = normalize(new Array(12).fill(50));
    points.forEach(([, y]) => expect(y).toBe(0));
  });

  it("rejects fewer than 10 closes", () => {
    expect(() => normalize([1, 2, 3, 4, 5, 6, 7, 8, 9])).toThrow();
  });

  it("rejects non-positive and non-finite closes", () => {
    expect(() => normalize([...CALM_CLOSES, 0])).toThrow();
    expect(() => normalize([...CALM_CLOSES, -5])).toThrow();
    expect(() => normalize([...CALM_CLOSES, NaN])).toThrow();
  });
});

describe("smoothTrack", () => {
  it("outputs strictly increasing x (physics terrain requirement)", () => {
    for (const closes of [SPIKY_CLOSES, CALM_CLOSES]) {
      const smooth = smoothTrack(normalize(closes));
      for (let i = 1; i < smooth.length; i++) {
        expect(smooth[i][0]).toBeGreaterThan(smooth[i - 1][0]);
      }
    }
  });

  it("pins first and last points to the raw endpoints", () => {
    const points = normalize(SPIKY_CLOSES);
    const smooth = smoothTrack(points);
    expect(smooth[0]).toEqual(points[0]);
    expect(smooth[smooth.length - 1]).toEqual(points[points.length - 1]);
  });

  it("resamples to roughly 1 vertex per metre of arc length", () => {
    const points = normalize(CALM_CLOSES);
    const smooth = smoothTrack(points);
    // Arc length >= x-span (66m); vertex count should be in the same ballpark.
    expect(smooth.length).toBeGreaterThan(66);
    expect(smooth.length).toBeLessThan(200);
  });
});

describe("stats / difficulty", () => {
  it("classifies difficulty at the documented boundaries", () => {
    expect(difficultyFor(19.9)).toBe("easy");
    expect(difficultyFor(20)).toBe("medium");
    expect(difficultyFor(31.9)).toBe("medium");
    expect(difficultyFor(32)).toBe("hard");
    expect(difficultyFor(44.9)).toBe("hard");
    expect(difficultyFor(45)).toBe("insane");
  });

  it("computes worldLength as the x-span and counts points", () => {
    const flat: TrackPoint[] = [
      [0, 0],
      [10, 0],
      [25, 0],
    ];
    const s = stats(flat);
    expect(s.worldLength).toBe(25);
    expect(s.maxSlopeDeg).toBe(0);
    expect(s.volatility).toBe(0);
    expect(s.difficulty).toBe("easy");
    expect(s.pointCount).toBe(3);
  });
});

describe("rawTrack", () => {
  it("returns an equal but independent copy", () => {
    const points = normalize(CALM_CLOSES);
    const raw = rawTrack(points);
    expect(raw).toEqual(points);
    expect(raw).not.toBe(points);
    expect(raw[0]).not.toBe(points[0]);
  });

  it("rejects non-increasing x", () => {
    expect(() =>
      rawTrack([
        [0, 0],
        [0, 1],
      ]),
    ).toThrow();
  });
});

describe("downsample", () => {
  it("is a no-op copy for short series", () => {
    const out = downsample(CALM_CLOSES);
    expect(out).toEqual(CALM_CLOSES);
    expect(out).not.toBe(CALM_CLOSES);
  });

  it("caps long series at MAX_CANDLES, keeping first and last", () => {
    const long = Array.from({ length: 4700 }, (_, i) => 100 + (i % 37));
    const out = downsample(long);
    expect(out.length).toBe(MAX_CANDLES);
    expect(out[0]).toBe(long[0]);
    expect(out[out.length - 1]).toBe(long[long.length - 1]);
  });

  it("is deterministic", () => {
    const long = Array.from({ length: 2500 }, (_, i) => 100 + (i % 13));
    expect(JSON.stringify(downsample(long))).toBe(JSON.stringify(downsample(long)));
  });
});
