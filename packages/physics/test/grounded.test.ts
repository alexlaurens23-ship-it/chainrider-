import { describe, expect, it } from "vitest";
import {
  INPUT,
  createSim,
  getSnapshot,
  getTrackInfo,
  simulateReplay,
  stepSim,
  terrainSlopeAt,
} from "../src/index";
import type { InputLogEntry, TrackPoint } from "../src/index";

/** 30° incline: flat approach, 34.65 m run / 20 m rise (≈29.995°), flat summit. */
const INCLINE_TRACK: TrackPoint[] = [
  [0, 0],
  [10, 0],
  [44.65, 20],
  [60, 20],
];

const INCLINE_TOP_X = 44.65;
const MAX_PITCH_ERROR = (35 * Math.PI) / 180;

function wrap(a: number): number {
  const TWO_PI = Math.PI * 2;
  let r = a % TWO_PI;
  if (r > Math.PI) r -= TWO_PI;
  else if (r <= -Math.PI) r += TWO_PI;
  return r;
}

describe("grounded stabilization layer", () => {
  it("full throttle climbs the 30° incline within 600 ticks, pitch error ≤ 35°", () => {
    const sim = createSim(INCLINE_TRACK);
    const terrain = getTrackInfo(sim).terrain;
    // Measure spawn → incline top. Past the crest the bike launches ballistic
    // (and eventually flies off the run-out) — that is locked airborne
    // behavior, not the grounded layer under test.
    let worstPitchError = 0;
    let reachedTop = false;
    for (let i = 0; i < 600 && !reachedTop; i++) {
      stepSim(sim, INPUT.THROTTLE);
      const snap = getSnapshot(sim);
      const err = Math.abs(wrap(snap.chassis.angle - terrainSlopeAt(terrain, snap.chassis.x)));
      if (err > worstPitchError) worstPitchError = err;
      reachedTop = snap.chassis.x >= INCLINE_TOP_X;
    }
    expect(getSnapshot(sim).crashes).toBe(0);
    expect(reachedTop).toBe(true);
    expect(worstPitchError).toBeLessThanOrEqual(MAX_PITCH_ERROR);
  });

  it("replays bit-identically over the incline (determinism)", () => {
    const log: InputLogEntry[] = [
      [0, INPUT.THROTTLE],
      [120, INPUT.THROTTLE | INPUT.LEAN_LEFT],
      [180, INPUT.THROTTLE],
      [300, INPUT.THROTTLE | INPUT.LEAN_RIGHT],
      [330, INPUT.THROTTLE],
      [500, INPUT.THROTTLE | INPUT.JUMP],
      [505, INPUT.THROTTLE],
    ];
    const a = simulateReplay(INCLINE_TRACK, undefined, log, 1200);
    const b = simulateReplay(INCLINE_TRACK, undefined, log, 1200);
    expect(b).toStrictEqual(a);
  });
});
