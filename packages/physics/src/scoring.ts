/**
 * Scoring — the single source of truth for run scoring.
 * Hard rule: scoring lives ONLY in this package; web and api import it.
 * `stepSim` calls `updateScore` exactly once per fixed step with a plain
 * frame of facts; nothing here touches Planck, wall-clock time, or RNG.
 * Bump SIM_VERSION (constants.ts) whenever any rule here changes.
 *
 * Model (time-primary): the real score is computed AT FINISH —
 *   score = speedScore + trickBonus
 *   speedScore = round(baseFinish * (par / effectiveTime)^speedExp)   [finished only]
 *   effectiveTime = finishTime + crashes * crashTimePenaltyMs
 *   trickBonus = round(rawTrickPoints * trickWeight)
 * A fast clean finish beats a slow trick-stuffed one; a DNF gets trickBonus only.
 */

const TWO_PI = Math.PI * 2;

/** Retune knobs for the time-primary finish formula + per-tier par pace. */
export const SCORING_CONFIG = {
  /** Score for finishing exactly at par with no tricks/crashes. */
  baseFinish: 10000,
  /** Speed multiplier exponent — >1 richly rewards beating par. */
  speedExp: 1.25, // P8.12: raw speed matters a bit less
  /** rawTrickPoints are scaled by this at finish. */
  trickWeight: 1.0, // P8.12: tricks matter much more (was 0.15)
  /** Each crash adds this to the effective finish time. */
  crashTimePenaltyMs: 3000,
  /** Assumed fair pace per difficulty tier (m/s) → par = worldLength/pace*1000. */
  parPaceMps: { VOLATILE: 8, DEGEN: 7, SAVAGE: 6 },
} as const;

export type ScoringConfig = typeof SCORING_CONFIG;

/** Trick-detection values (unchanged) — feed rawTrickPoints, reweighted at finish. */
export const SCORING = {
  /** +points per `airtimeTickWindow` consecutive fully-airborne ticks (flat, no combo). */
  airtimePoints: 10,
  airtimeTickWindow: 6,
  /** Per full ±2π of chassis rotation completed while airborne. Combo-multiplied. */
  flipPoints: 250,
  /** Both wheels down within this many ticks of each other... */
  cleanLandingPairTicks: 10,
  /** ...after at least this many fully-airborne ticks, chassis aligned → clean landing. */
  cleanLandingMinAirTicks: 6,
  /** Clean landing award. Combo-multiplied. */
  cleanLandingPoints: 50,
  /** +points per `wheelieTickWindow` consecutive wheelie ticks. Combo-multiplied. */
  wheeliePoints: 20,
  wheelieTickWindow: 60,
  /** Wheelie ticks only count above this chassis speed, m/s. */
  wheelieMinSpeed: 2,
  /** Tricks within this many ticks of the previous trick grow the combo. */
  comboWindowTicks: 120,
  comboMax: 5,
} as const;

export type ScoringConstants = typeof SCORING;

/** Facts about one completed step, assembled by stepSim. */
export interface ScoreFrame {
  tick: number;
  rearGrounded: boolean;
  frontGrounded: boolean;
  /** Raw chassis angle change this step, radians (unwrapped). */
  angleDelta: number;
  /** Chassis speed, m/s. */
  speed: number;
  /** |chassis angle − terrain slope| within the landing tolerance right now. */
  landingAligned: boolean;
  /** A crash was detected this step. */
  crashed: boolean;
  /** The finish flag was crossed this step. */
  finished: boolean;
  /** Sim time in ms (tick * SIM_DT * 1000). */
  timeMs: number;
  parTimeMs: number | undefined;
}

export interface ScoreState {
  /** Displayed score: live = trickBonus (DNF-equivalent); at finish = speedScore + trickBonus. */
  score: number;
  /** Speed component, set at finish (0 during the run / on DNF). */
  speedScore: number;
  /** Weighted trick component (round(rawTrickPoints * trickWeight)). */
  trickBonus: number;
  /** Finish time + crash penalties, ms (set at finish). */
  effectiveTimeMs: number;
  /** Un-weighted accumulated trick points (flips/clean/wheelie/airtime × combo). */
  rawTrickPoints: number;
  /** Current multiplier ×1..×5. */
  combo: number;
  /** Tick of the last combo-building trick; -1 = none yet. */
  lastTrickTick: number;
  flips: number;
  backflips: number;
  frontflips: number;
  crashes: number;
  /** Current consecutive fully-airborne streak, ticks. */
  airStreak: number;
  /** Total fully-airborne ticks this run. */
  airTicks: number;
  /** Unwrapped chassis rotation accumulated during the current airborne streak. */
  flipAccum: number;
  /** Current consecutive wheelie streak, ticks. */
  wheelieStreak: number;
  /** Tick the first wheel touched down for a pending clean-landing check; -1 = none. */
  landingFirstDownTick: number;
}

export function createScoreState(): ScoreState {
  return {
    score: 0,
    speedScore: 0,
    trickBonus: 0,
    effectiveTimeMs: 0,
    rawTrickPoints: 0,
    combo: 1,
    lastTrickTick: -1,
    flips: 0,
    backflips: 0,
    frontflips: 0,
    crashes: 0,
    airStreak: 0,
    airTicks: 0,
    flipAccum: 0,
    wheelieStreak: 0,
    landingFirstDownTick: -1,
  };
}

export interface FinalScoreInput {
  finished: boolean;
  /** Finish time in ms (or total sim time on DNF). */
  finishTimeMs: number;
  parTimeMs: number | undefined;
  crashes: number;
  rawTrickPoints: number;
}

export interface FinalScoreResult {
  score: number;
  speedScore: number;
  trickBonus: number;
  effectiveTimeMs: number;
}

/**
 * Pure time-primary finish formula. A finished run earns the speed multiplier
 * (richly for beating par, eroded by crash time penalties) plus a small trick
 * garnish; a DNF earns the trick garnish only. Tested directly.
 */
export function computeFinalScore(input: FinalScoreInput): FinalScoreResult {
  const trickBonus = Math.round(input.rawTrickPoints * SCORING_CONFIG.trickWeight);
  if (!input.finished) {
    return { score: trickBonus, speedScore: 0, trickBonus, effectiveTimeMs: input.finishTimeMs };
  }
  const effectiveTimeMs = input.finishTimeMs + input.crashes * SCORING_CONFIG.crashTimePenaltyMs;
  const ratio =
    input.parTimeMs !== undefined && input.parTimeMs > 0 && effectiveTimeMs > 0
      ? input.parTimeMs / effectiveTimeMs
      : 1;
  const speedScore = Math.round(SCORING_CONFIG.baseFinish * Math.pow(ratio, SCORING_CONFIG.speedExp));
  return { score: speedScore + trickBonus, speedScore, trickBonus, effectiveTimeMs };
}

/** Combo-building trick: grow ×1→×5 within the window, award base × combo to rawTrickPoints. */
function awardTrick(state: ScoreState, basePoints: number, tick: number): void {
  if (state.lastTrickTick >= 0 && tick - state.lastTrickTick <= SCORING.comboWindowTicks) {
    state.combo = Math.min(SCORING.comboMax, state.combo + 1);
  } else {
    state.combo = 1;
  }
  state.rawTrickPoints += basePoints * state.combo;
  state.lastTrickTick = tick;
}

/** Reset transient streaks (on crash/respawn). Earned points, totals, crashes persist. */
export function resetScoreStreaks(state: ScoreState): void {
  state.airStreak = 0;
  state.flipAccum = 0;
  state.wheelieStreak = 0;
  state.landingFirstDownTick = -1;
}

export function updateScore(state: ScoreState, frame: ScoreFrame): void {
  if (frame.crashed) {
    // Crashes no longer subtract points — they cost effective time at finish.
    state.crashes += 1;
    state.combo = 1;
    state.lastTrickTick = -1;
    resetScoreStreaks(state);
  } else {
    const fullyAirborne = !frame.rearGrounded && !frame.frontGrounded;

    if (fullyAirborne) {
      state.airStreak += 1;
      state.airTicks += 1;
      if (state.airStreak % SCORING.airtimeTickWindow === 0) {
        state.rawTrickPoints += SCORING.airtimePoints; // flat: airtime never builds the combo
      }

      state.flipAccum += frame.angleDelta;
      while (state.flipAccum >= TWO_PI) {
        state.flipAccum -= TWO_PI;
        state.flips += 1;
        state.backflips += 1; // CCW while riding +x = backflip
        awardTrick(state, SCORING.flipPoints, frame.tick);
      }
      while (state.flipAccum <= -TWO_PI) {
        state.flipAccum += TWO_PI;
        state.flips += 1;
        state.frontflips += 1;
        awardTrick(state, SCORING.flipPoints, frame.tick);
      }
    } else {
      // Touchdown of the first wheel after a real airborne stretch opens a
      // clean-landing window; both wheels must settle within pairTicks, aligned.
      if (state.airStreak >= SCORING.cleanLandingMinAirTicks) {
        state.landingFirstDownTick = frame.tick;
      }
      state.airStreak = 0;
      state.flipAccum = 0;

      if (state.landingFirstDownTick >= 0) {
        if (frame.rearGrounded && frame.frontGrounded) {
          if (
            frame.tick - state.landingFirstDownTick <= SCORING.cleanLandingPairTicks &&
            frame.landingAligned
          ) {
            awardTrick(state, SCORING.cleanLandingPoints, frame.tick);
          }
          state.landingFirstDownTick = -1;
        } else if (frame.tick - state.landingFirstDownTick > SCORING.cleanLandingPairTicks) {
          state.landingFirstDownTick = -1;
        }
      }
    }

    if (frame.rearGrounded && !frame.frontGrounded && frame.speed > SCORING.wheelieMinSpeed) {
      state.wheelieStreak += 1;
      if (state.wheelieStreak >= SCORING.wheelieTickWindow) {
        state.wheelieStreak = 0;
        awardTrick(state, SCORING.wheeliePoints, frame.tick);
      }
    } else {
      state.wheelieStreak = 0;
    }

    if (frame.finished) {
      const r = computeFinalScore({
        finished: true,
        finishTimeMs: frame.timeMs,
        parTimeMs: frame.parTimeMs,
        crashes: state.crashes,
        rawTrickPoints: state.rawTrickPoints,
      });
      state.speedScore = r.speedScore;
      state.effectiveTimeMs = r.effectiveTimeMs;
    }
  }

  // Recompute the displayed score every tick: trick garnish always, speed once finished.
  state.trickBonus = Math.round(state.rawTrickPoints * SCORING_CONFIG.trickWeight);
  state.score = state.speedScore + state.trickBonus;
}
