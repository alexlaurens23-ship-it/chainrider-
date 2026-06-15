import { DEFAULT_TUNE, INPUT, simulateReplay } from "@chainrider/physics";
import type { FinalResult, InputLogEntry, TrackPoint } from "@chainrider/physics";
import { describe, expect, it } from "vitest";
import {
  eligibleForRank,
  isWellFormedLog,
  maxReasonableScore,
  verifyRun,
} from "../src/runVerify.js";

/** Short flat track — the bike throttles straight to the finish. */
const FLAT: TrackPoint[] = [
  [0, 0],
  [120, 0],
];
/** Hold throttle from tick 0 → finishes the flat track. */
const THROTTLE_LOG: InputLogEntry[] = [[0, INPUT.THROTTLE]];

/** A generous ceiling for the flat track so legit runs are never flagged. */
const FLAT_CEILING = maxReasonableScore({ parTimeMs: 30000, worldLength: 170 });

/** Record the canonical finishing run (the server is the source of truth). */
function record(): { result: FinalResult; ticks: number } {
  const result = simulateReplay(FLAT, DEFAULT_TUNE, THROTTLE_LOG, 72000);
  return { result, ticks: result.ticks };
}

describe("verifyRun — authoritative-server model", () => {
  const good = record();

  it("(setup) the recorded run finishes", () => {
    expect(good.result.finished).toBe(true);
    expect(good.result.score).toBeGreaterThan(0);
  });

  it("(a) a well-formed finishing log verifies at the SERVER's score", () => {
    const res = verifyRun({
      points: FLAT,
      parTimeMs: undefined,
      inputLog: THROTTLE_LOG,
      submittedTicks: good.ticks,
      maxScore: FLAT_CEILING,
    });
    expect(res.verifyStatus).toBe("verified");
    expect(res.server?.score).toBe(good.result.score);
    expect(res.server?.finished).toBe(true);
  });

  it("(b) the client's claimed score is NOT an input — the result is client-independent", () => {
    // There is no client-score parameter anymore. The same log always yields the
    // same verified server score, no matter what the client claimed.
    const a = verifyRun({ points: FLAT, parTimeMs: undefined, inputLog: THROTTLE_LOG, submittedTicks: good.ticks, maxScore: FLAT_CEILING });
    const b = verifyRun({ points: FLAT, parTimeMs: undefined, inputLog: THROTTLE_LOG, submittedTicks: good.ticks, maxScore: FLAT_CEILING });
    expect(a.verifyStatus).toBe("verified");
    expect(a.server?.score).toBe(b.server?.score);
    expect(a.server?.score).toBe(good.result.score);
  });

  it("(c) a malformed inputLog → failed (server null), no throw", () => {
    const nonIncreasing: InputLogEntry[] = [
      [10, INPUT.THROTTLE],
      [5, 0],
    ];
    const res = verifyRun({
      points: FLAT,
      parTimeMs: undefined,
      inputLog: nonIncreasing,
      submittedTicks: good.ticks,
      maxScore: FLAT_CEILING,
    });
    expect(res.verifyStatus).toBe("failed");
    expect(res.server).toBeNull();
  });

  it("(d) a DNF log (stops before the flag) → failed, not verified", () => {
    // Throttle briefly then idle; the bike never reaches the finish in `cap` ticks.
    const dnf: InputLogEntry[] = [
      [0, INPUT.THROTTLE],
      [30, 0],
    ];
    const res = verifyRun({
      points: FLAT,
      parTimeMs: undefined,
      inputLog: dnf,
      submittedTicks: 1200,
      maxScore: FLAT_CEILING,
    });
    expect(res.verifyStatus).toBe("failed");
    expect(res.server?.finished).toBe(false);
    expect(eligibleForRank(res.verifyStatus, res.server?.finished ?? false)).toBe(false);
  });

  it("(e) a finishing run whose score exceeds the ceiling → flagged (not verified)", () => {
    const res = verifyRun({
      points: FLAT,
      parTimeMs: undefined,
      inputLog: THROTTLE_LOG,
      submittedTicks: good.ticks,
      maxScore: 1, // absurdly tight ceiling forces the flag
    });
    expect(res.verifyStatus).toBe("flagged");
    expect(res.server?.finished).toBe(true); // still a real finishing run, just held
  });

  it("eligibleForRank gates on verified + finished", () => {
    expect(eligibleForRank("verified", true)).toBe(true);
    expect(eligibleForRank("verified", false)).toBe(false);
    expect(eligibleForRank("flagged", true)).toBe(false);
    expect(eligibleForRank("failed", true)).toBe(false);
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
