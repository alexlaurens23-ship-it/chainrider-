import { DEFAULT_TUNE, INPUT, simulateReplay } from "@chainrider/physics";
import type { FinalResult, InputLogEntry, TrackPoint } from "@chainrider/physics";
import { describe, expect, it } from "vitest";
import {
  eligibleForRank,
  isWellFormedLog,
  maxPlausibleScore,
  maxReasonableScore,
  verifyRun,
} from "../src/runVerify.js";

/** Short flat track — the bike throttles straight to the finish. */
const FLAT: TrackPoint[] = [
  [0, 0],
  [120, 0],
];
/** Long flat track — won't finish in a few hundred ticks. */
const LONG: TrackPoint[] = [
  [0, 0],
  [400, 0],
];
/** Hold throttle from tick 0. */
const THROTTLE_LOG: InputLogEntry[] = [[0, INPUT.THROTTLE]];

/** A generous ceiling for the flat track so legit runs are never flagged. */
const FLAT_CEILING = maxReasonableScore({ parTimeMs: 30000, worldLength: 170 });

/** Record the canonical finishing run on FLAT (for tick counts + a realistic score). */
function record(): { result: FinalResult; ticks: number } {
  const result = simulateReplay(FLAT, DEFAULT_TUNE, THROTTLE_LOG, 72000);
  return { result, ticks: result.ticks };
}

describe("verifyRun — trust-client-score model", () => {
  const good = record();

  it("(setup) the recorded run finishes and moved the bike forward", () => {
    expect(good.result.finished).toBe(true);
    expect(good.result.maxX).toBeGreaterThan(100); // travelled the whole flat track
  });

  it("(a) well-formed log + real progress + plausible client score → verified", () => {
    // The client's claimed score is a realistic finishing value, well under the
    // ceiling and plausibility band. The client score is what we trust + rank.
    const clientScore = good.result.score; // a real, plausible finish score
    const res = verifyRun({
      points: FLAT,
      parTimeMs: 30000,
      worldLength: 170,
      inputLog: THROTTLE_LOG,
      submittedTicks: good.ticks,
      client: { score: clientScore, flips: good.result.flips, finished: true, timeMs: good.result.timeMs },
      maxScore: FLAT_CEILING,
    });
    expect(res.verifyStatus).toBe("verified");
    expect(res.progressMeters).toBeGreaterThan(25);
    // The replay is only a progress probe — the OFFICIAL score is the client's,
    // applied by the route. verifyRun never substitutes the replay's score.
    expect(eligibleForRank(res.verifyStatus, true)).toBe(true);
  });

  it("(b) empty/near-empty log claiming a high score → flagged (no progress)", () => {
    // An empty log is well-formed but drives the bike nowhere → no real ride.
    const res = verifyRun({
      points: FLAT,
      parTimeMs: 30000,
      worldLength: 170,
      inputLog: [],
      submittedTicks: 600,
      client: { score: 5000, flips: 0, finished: false, timeMs: 10000 },
      maxScore: FLAT_CEILING,
    });
    expect(res.verifyStatus).toBe("flagged");
    expect(res.progressMeters).toBeLessThan(25);
  });

  it("(c) a real-progress but tiny log claiming an absurd score → flagged (implausible)", () => {
    // Throttles forward (clears the progress gate) but never finishes; 300 ticks
    // of riding can't justify a 5000-point score → implausible (yet under ceiling).
    const submittedTicks = 300;
    const clientScore = 5000;
    const plausible = maxPlausibleScore({
      ticks: submittedTicks,
      claimedFlips: 0,
      parTimeMs: 60000,
      finished: false,
      finishTimeMs: 5000,
      worldLength: 410,
    });
    expect(clientScore).toBeGreaterThan(plausible); // implausible
    expect(clientScore).toBeLessThan(maxReasonableScore({ parTimeMs: 60000, worldLength: 410 })); // but under ceiling
    const res = verifyRun({
      points: LONG,
      parTimeMs: 60000,
      worldLength: 410,
      inputLog: THROTTLE_LOG,
      submittedTicks,
      client: { score: clientScore, flips: 0, finished: false, timeMs: 5000 },
      maxScore: maxReasonableScore({ parTimeMs: 60000, worldLength: 410 }),
    });
    expect(res.progressMeters).toBeGreaterThan(25); // a real ride, just over-claimed
    expect(res.verifyStatus).toBe("flagged");
  });

  it("(d) a malformed inputLog → failed (replay null), no throw", () => {
    const nonIncreasing: InputLogEntry[] = [
      [10, INPUT.THROTTLE],
      [5, 0],
    ];
    const res = verifyRun({
      points: FLAT,
      parTimeMs: 30000,
      worldLength: 170,
      inputLog: nonIncreasing,
      submittedTicks: good.ticks,
      client: { score: 5000, flips: 0, finished: true, timeMs: good.result.timeMs },
      maxScore: FLAT_CEILING,
    });
    expect(res.verifyStatus).toBe("failed");
    expect(res.replay).toBeNull();
  });

  it("(e) a claimed score over the per-track ceiling → flagged (not verified)", () => {
    const res = verifyRun({
      points: FLAT,
      parTimeMs: 30000,
      worldLength: 170,
      inputLog: THROTTLE_LOG,
      submittedTicks: good.ticks,
      client: { score: 10_000_000, flips: 0, finished: true, timeMs: good.result.timeMs },
      maxScore: FLAT_CEILING,
    });
    expect(res.verifyStatus).toBe("flagged");
  });

  it("eligibleForRank gates on verified + finished", () => {
    expect(eligibleForRank("verified", true)).toBe(true);
    expect(eligibleForRank("verified", false)).toBe(false);
    expect(eligibleForRank("flagged", true)).toBe(false);
    expect(eligibleForRank("failed", true)).toBe(false);
  });
});

describe("maxPlausibleScore", () => {
  it("scales with run length — a short run can't justify a big score", () => {
    const short = maxPlausibleScore({ ticks: 300, claimedFlips: 0, parTimeMs: 60000, finished: false, finishTimeMs: 5000, worldLength: 410 });
    const long = maxPlausibleScore({ ticks: 30000, claimedFlips: 0, parTimeMs: 60000, finished: false, finishTimeMs: 5000, worldLength: 410 });
    expect(long).toBeGreaterThan(short);
    expect(short).toBeLessThan(3000); // a 5s ride stays small vs a real finish (~10000+); trickWeight 1.0 (P8.12)
  });
  it("is generous enough that a real finishing run clears it", () => {
    const result = simulateReplay(FLAT, DEFAULT_TUNE, THROTTLE_LOG, 72000);
    const plausible = maxPlausibleScore({
      ticks: result.ticks,
      claimedFlips: result.flips,
      parTimeMs: 30000,
      finished: true,
      finishTimeMs: result.timeMs,
      worldLength: 170,
    });
    expect(plausible).toBeGreaterThan(result.score);
  });
});

describe("isWellFormedLog", () => {
  it("accepts a clean strictly-increasing change-only log within the run", () => {
    expect(isWellFormedLog([[0, 1], [60, 5], [120, 0]], 200)).toBe(true);
    expect(isWellFormedLog([], 200)).toBe(true);
  });
  it("rejects bad tick counts, non-monotonic ticks, bad entries, and last≥ticks", () => {
    expect(isWellFormedLog([[0, 1]], 0)).toBe(false); // ticks must be > 0
    expect(isWellFormedLog([[0, 1]], 99999999)).toBe(false); // > MAX_RIDE_TICKS
    expect(isWellFormedLog([[10, 1], [5, 0]], 200)).toBe(false); // non-increasing
    expect(isWellFormedLog([[0, 1], [0, 2]], 200)).toBe(false); // not strictly increasing
    expect(isWellFormedLog([[0, -1]], 200)).toBe(false); // negative mask
    expect(isWellFormedLog([[0, 99999]], 200)).toBe(false); // mask out of range
    expect(isWellFormedLog([[0, 1.5]], 200)).toBe(false); // non-integer
    expect(isWellFormedLog([[250, 1]], 200)).toBe(false); // last tick >= submittedTicks
    expect(isWellFormedLog("nope", 200)).toBe(false);
  });
});

describe("maxReasonableScore", () => {
  it("is generous — far above a real finishing run's score", () => {
    const { result } = record();
    const ceiling = maxReasonableScore({ parTimeMs: 30000, worldLength: 170 });
    expect(ceiling).toBeGreaterThan(result.score * 10);
  });
  it("grows with par time and shrinks with length (monotone-ish)", () => {
    const base = maxReasonableScore({ parTimeMs: 90000, worldLength: 1000 });
    expect(maxReasonableScore({ parTimeMs: 180000, worldLength: 1000 })).toBeGreaterThan(base);
    expect(maxReasonableScore({ parTimeMs: 90000, worldLength: 3000 })).toBeLessThan(base);
  });
});
