import { DEFAULT_TUNE, INPUT, simulateReplay } from "@chainrider/physics";
import type { FinalResult, InputLogEntry, TrackPoint } from "@chainrider/physics";
import { describe, expect, it } from "vitest";
import { eligibleForRank, verifyRun, type ClientClaim } from "../src/runVerify.js";

/** Short flat track — the bike throttles straight to the finish. */
const FLAT: TrackPoint[] = [
  [0, 0],
  [120, 0],
];
/** Long flat track (~1 vertex/m) to time a realistically large replay. */
const LONG_FLAT: TrackPoint[] = Array.from({ length: 1255 }, (_, i) => [i, 0] as TrackPoint);

/** Hold throttle from tick 0. */
const THROTTLE_LOG: InputLogEntry[] = [[0, INPUT.THROTTLE]];
/** Test replay cap: enough to finish a short flat track quickly. */
const TEST_MAX_TICKS = 6000;

/** A known-good finishing run, recorded by the same engine the server uses. */
function record(points: TrackPoint[], log: InputLogEntry[], maxTicks: number): FinalResult {
  return simulateReplay(points, DEFAULT_TUNE, log, maxTicks);
}

function claimFrom(r: FinalResult): ClientClaim {
  return { score: r.score, flips: r.flips, crashes: r.crashes, finished: r.finished, timeMs: r.timeMs };
}

describe("verifyRun — anti-cheat", () => {
  const good = record(FLAT, THROTTLE_LOG, TEST_MAX_TICKS);

  it("(setup) the recorded run actually finishes", () => {
    expect(good.finished).toBe(true);
    expect(good.score).toBeGreaterThan(0);
  });

  it("(a) a faithful client claim verifies, server score is authoritative", () => {
    const res = verifyRun({
      points: FLAT,
      parTimeMs: undefined,
      inputLog: THROTTLE_LOG,
      client: claimFrom(good),
      maxTicks: TEST_MAX_TICKS,
    });
    expect(res.verifyStatus).toBe("verified");
    expect(res.server?.score).toBe(good.score);
  });

  it("(b) the SAME log with clientScore inflated +5000 never verifies", () => {
    const res = verifyRun({
      points: FLAT,
      parTimeMs: undefined,
      inputLog: THROTTLE_LOG,
      client: { ...claimFrom(good), score: good.score + 5000 },
      maxTicks: TEST_MAX_TICKS,
    });
    expect(res.verifyStatus).not.toBe("verified");
    expect(["flagged", "failed"]).toContain(res.verifyStatus);
  });

  it("(c) a tampered inputLog yields a server score different from the claimed one", () => {
    // Claim the good finishing score, but submit a genuinely different ride
    // (throttle then brake → never reaches the finish). The re-simulation
    // diverges from the claim, so the lie is caught: you can't submit log A
    // and claim run B's score.
    const tampered: InputLogEntry[] = [
      [0, INPUT.THROTTLE],
      [40, INPUT.BRAKE],
    ];
    const res = verifyRun({
      points: FLAT,
      parTimeMs: undefined,
      inputLog: tampered,
      client: claimFrom(good), // claims the untampered finishing result
      maxTicks: 1500,
    });
    expect(res.server).not.toBeNull();
    expect(res.server?.score).not.toBe(good.score);
    expect(res.verifyStatus).not.toBe("verified");
  });

  it("(d) a DNF never earns a rank", () => {
    // Throttle briefly then stop: never reaches the finish within the cap.
    const dnfLog: InputLogEntry[] = [
      [0, INPUT.THROTTLE],
      [30, 0],
    ];
    const res = verifyRun({
      points: FLAT,
      parTimeMs: undefined,
      inputLog: dnfLog,
      client: { score: 0, flips: 0, crashes: 0, finished: false, timeMs: 0 },
      maxTicks: 1200,
    });
    expect(res.server?.finished).toBe(false);
    expect(eligibleForRank("verified", false)).toBe(false);
    expect(eligibleForRank("verified", res.server?.finished ?? false)).toBe(false);
  });

  it("eligibleForRank gates correctly", () => {
    expect(eligibleForRank("verified", true)).toBe(true);
    expect(eligibleForRank("flagged", true)).toBe(false);
    expect(eligibleForRank("failed", true)).toBe(false);
    expect(eligibleForRank("verified", false)).toBe(false);
  });

  it("a malformed input log fails (not throws)", () => {
    // Non-increasing ticks make simulateReplay throw → graceful 'failed'.
    const bad: InputLogEntry[] = [
      [10, INPUT.THROTTLE],
      [5, 0],
    ];
    const res = verifyRun({
      points: FLAT,
      parTimeMs: undefined,
      inputLog: bad,
      client: { score: 1, flips: 0, crashes: 0, finished: false, timeMs: 0 },
      maxTicks: TEST_MAX_TICKS,
    });
    expect(res.verifyStatus).toBe("failed");
    expect(res.server).toBeNull();
  });

  it("a large (~1255-pt, ~minutes) replay verifies in well under 1 s", () => {
    const big = record(LONG_FLAT, THROTTLE_LOG, 72000);
    expect(big.finished).toBe(true);
    const res = verifyRun({
      points: LONG_FLAT,
      parTimeMs: undefined,
      inputLog: THROTTLE_LOG,
      client: claimFrom(big),
      // default cap (72000) — but it finishes well before
    });
    expect(res.verifyStatus).toBe("verified");
    expect(res.durationMs).toBeLessThan(1000);
  });
});
