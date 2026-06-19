import { describe, expect, it } from "vitest";
import { SCORING_CONFIG, computeFinalScore } from "../src/index";

const PAR = 60_000; // 60 s par for these cases

describe("time-primary scoring — exploit is dead", () => {
  it("a fast clean finish beats a slow trick-stuffed finish on the same track", () => {
    // (a) zero tricks, finished exactly at par.
    const fastClean = computeFinalScore({
      finished: true,
      finishTimeMs: PAR,
      parTimeMs: PAR,
      crashes: 0,
      rawTrickPoints: 0,
    });
    // (b) finished at 2× par with 5 crashes and a moderately-tricked run. Post
    // P8.12 tricks are weighted ×1.0, so this uses a realistic ~4000 raw (a few
    // flips); a clean par finish still beats a slow run with moderate tricks.
    const slowFarm = computeFinalScore({
      finished: true,
      finishTimeMs: 2 * PAR,
      parTimeMs: PAR,
      crashes: 5,
      rawTrickPoints: 4000,
    });
    expect(fastClean.score).toBeGreaterThan(slowFarm.score);
    // The spine: a clean par finish is ~baseFinish; the farmed run's speed
    // component is wrecked by the 2× time plus 5×3 s of crash penalties.
    expect(fastClean.speedScore).toBe(SCORING_CONFIG.baseFinish);
    expect(slowFarm.speedScore).toBeLessThan(fastClean.speedScore);
  });

  it("beating par is richly rewarded (exponent > 1)", () => {
    const atPar = computeFinalScore({ finished: true, finishTimeMs: PAR, parTimeMs: PAR, crashes: 0, rawTrickPoints: 0 });
    const halfPar = computeFinalScore({ finished: true, finishTimeMs: PAR / 2, parTimeMs: PAR, crashes: 0, rawTrickPoints: 0 });
    // 2× pace → 2^1.25 ≈ 2.38× the score (P8.12 exponent), still well above linear.
    expect(halfPar.speedScore).toBeGreaterThan(atPar.speedScore * 2.2);
  });

  it("each crash adds 3 s of effective time", () => {
    const clean = computeFinalScore({ finished: true, finishTimeMs: PAR, parTimeMs: PAR, crashes: 0, rawTrickPoints: 0 });
    const twoCrash = computeFinalScore({ finished: true, finishTimeMs: PAR, parTimeMs: PAR, crashes: 2, rawTrickPoints: 0 });
    expect(twoCrash.effectiveTimeMs).toBe(PAR + 2 * SCORING_CONFIG.crashTimePenaltyMs);
    expect(twoCrash.speedScore).toBeLessThan(clean.speedScore);
  });

  it("a DNF scores only its trick garnish — no speed score, and loses to the same run finished", () => {
    const dnf = computeFinalScore({ finished: false, finishTimeMs: PAR, parTimeMs: PAR, crashes: 0, rawTrickPoints: 4000 });
    const finished = computeFinalScore({ finished: true, finishTimeMs: PAR, parTimeMs: PAR, crashes: 0, rawTrickPoints: 4000 });
    expect(dnf.speedScore).toBe(0);
    expect(dnf.score).toBe(dnf.trickBonus);
    expect(finished.score).toBeGreaterThan(dnf.score);
    // A DNF with moderate tricks still loses to a clean finish (and DNFs never
    // rank anyway — eligibleForRank requires finished). NOTE post-P8.12: with
    // tricks ×1.0, an EXTREME farm could out-score on raw points, so the real
    // anti-exploit guard is the finished-required ranking gate, not this formula.
    const dnfFarmed = computeFinalScore({ finished: false, finishTimeMs: PAR, parTimeMs: PAR, crashes: 0, rawTrickPoints: 4000 });
    const cleanFinish = computeFinalScore({ finished: true, finishTimeMs: PAR, parTimeMs: PAR, crashes: 0, rawTrickPoints: 0 });
    expect(cleanFinish.score).toBeGreaterThan(dnfFarmed.score);
  });

  it("trick bonus is rawTrickPoints × trickWeight", () => {
    const r = computeFinalScore({ finished: true, finishTimeMs: PAR, parTimeMs: PAR, crashes: 0, rawTrickPoints: 1000 });
    expect(r.trickBonus).toBe(Math.round(1000 * SCORING_CONFIG.trickWeight));
  });
});
