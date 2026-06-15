import { DEFAULT_TUNE, LEAD_IN_METERS, SCORING, SCORING_CONFIG, simulateReplay } from "@chainrider/physics";
import type { FinalResult, InputLogEntry, TrackPoint } from "@chainrider/physics";

/**
 * TRUST-CLIENT-SCORE run verification (P7.4).
 *
 * Chrome-V8 and Node-V8 produce different floating-point results for the same
 * inputLog (transcendentals in planck aren't bit-identical across engines), so
 * the server's re-simulated score diverges from the browser's — catastrophically
 * on the hard tracks that make up the paying pool. So we DON'T use the server's
 * replayed score: we trust the CLIENT's reported score (what the player saw) for
 * ranking/display, and gate it with cheap plausibility checks. The owner's manual
 * replay review (admin WATCH REPLAY) is the real anti-cheat before SOL is sent.
 *
 * A run is VERIFIED iff all hold:
 *   1. well-formed input log,
 *   2. the replay shows REAL PROGRESS — max-x advances ≥ PROGRESS_MIN_METERS past
 *      spawn (rejects empty/jitter/fake logs; does NOT require a finish, since a
 *      legit ride often crashes early in Node),
 *   3. the claimed score is PLAUSIBLE for the log's tick count + activity, and
 *   4. the claimed score is under the generous per-track sanity ceiling.
 * Fails 2/3/4 → 'flagged' (held for owner review, never auto-ranks/pays).
 * Malformed → 'failed'.
 *
 * Pure (no DB/Fastify). Scoring lives ONLY in packages/physics (hard rule 2) —
 * this only reads its constants to size a generous plausibility band.
 */

export type VerifyStatus = "verified" | "flagged" | "failed";

/** 20-minute hard cap (1200 s × 60 fps) — the browser ride loop's MAX_RIDE_TICKS. */
export const MAX_RIDE_TICKS = 72000;
/** Max recorded input-log entries (also enforced at the route before insert). */
export const MAX_INPUT_LOG = 90000;
/** Keymask is a bitmask of 5 input bits — anything ≥ this is malformed. */
const MAX_KEYMASK = 256;

/**
 * Minimum forward travel (meters past spawn) the replay must demonstrate for a
 * run to count as a real ride. Deliberately LOW and generous — its ONLY job is to
 * reject garbage logs that never move the bike. A real ride travels far more even
 * when it diverges and crashes early in Node (e.g. stored run 6 reaches ~59 m of
 * travel before its Node-side crash, well above this gate); a fake log moves ≈0 m.
 */
export const PROGRESS_MIN_METERS = 25;

// ── Sanity ceiling ───────────────────────────────────────────────────────────
// Deliberately GENEROUS — a backstop against absurd glitch scores, never a tight
// cap. A real top run scores ~tens of thousands; this lands in the hundreds of
// thousands, so it can't reject a legit ride but catches scores in the millions.
const GHOST_SPEED_MPS = 60; // ≈3× the real bike top speed
const TRICK_PTS_PER_SEC = 3000; // very loose trick allowance per second of par
const CEILING_SAFETY = 2;
/** Fallback par when a track has none, ms. */
const DEFAULT_PAR_MS = 240000;

/** Generous per-track theoretical max score, from the frozen par + length. */
export function maxReasonableScore(track: {
  parTimeMs: number | undefined;
  worldLength: number;
}): number {
  const parSec = (track.parTimeMs ?? DEFAULT_PAR_MS) / 1000;
  const fastestSec = Math.max(track.worldLength / GHOST_SPEED_MPS, 0.5);
  const speedCeil = SCORING_CONFIG.baseFinish * (parSec / fastestSec) ** SCORING_CONFIG.speedExp;
  const trickCeil = TRICK_PTS_PER_SEC * parSec;
  return Math.round((speedCeil + trickCeil) * CEILING_SAFETY);
}

// ── Plausibility band ──────────────────────────────────────────────────────
// A generous max-plausible score sized from the run's ACTUAL length (ticks) and
// claimed activity, so a tiny/short log can't claim a huge score. Every term is
// loose (max combo throughout, as if airborne/wheelie-ing the whole run) and the
// whole thing is ×PLAUSIBILITY_SAFETY — false-rejecting a real player is the worst
// outcome, so this only catches clear "tiny log, huge claim" fakes.

/** A flip needs airborne rotation time; far fewer ticks than physically possible. */
const MIN_TICKS_PER_FLIP = 10;
const PLAUSIBILITY_SAFETY = 2;

export function maxPlausibleScore(args: {
  ticks: number;
  claimedFlips: number;
  parTimeMs: number | undefined;
  finished: boolean;
  /** Claimed finish time, ms (only used when finished). */
  finishTimeMs: number;
  worldLength: number;
}): number {
  const ticks = Math.max(0, args.ticks);
  // Cap claimed flips by what the run length could physically allow.
  const flips = Math.max(0, Math.min(args.claimedFlips || 0, Math.floor(ticks / MIN_TICKS_PER_FLIP)));

  // Raw trick allowance: every source maxed for the whole run at max combo.
  const flipRaw = flips * SCORING.flipPoints * SCORING.comboMax;
  const airRaw = (ticks / SCORING.airtimeTickWindow) * SCORING.airtimePoints;
  const wheelieRaw = (ticks / SCORING.wheelieTickWindow) * SCORING.wheeliePoints * SCORING.comboMax;
  const cleanRaw = flips * SCORING.cleanLandingPoints * SCORING.comboMax; // ≈ one clean landing per flip
  const trickBonus = (flipRaw + airRaw + wheelieRaw + cleanRaw) * SCORING_CONFIG.trickWeight;

  // Speed allowance (finishers only): the legit speed score for the claimed time,
  // floored at the physically-fastest possible time so an impossible time can't
  // inflate the band (the ceiling backstops that anyway).
  let speedScore = 0;
  if (args.finished && args.parTimeMs && args.parTimeMs > 0) {
    const fastestMs = Math.max((args.worldLength / GHOST_SPEED_MPS) * 1000, 500);
    const effMs = Math.max(args.finishTimeMs, fastestMs);
    speedScore = SCORING_CONFIG.baseFinish * (args.parTimeMs / effMs) ** SCORING_CONFIG.speedExp;
  }

  return Math.round((speedScore + trickBonus) * PLAUSIBILITY_SAFETY);
}

// ── Input-log well-formedness ────────────────────────────────────────────────

/**
 * The recorded log must be a clean change-only `[tick, keymask]` sequence with
 * strictly increasing ticks, all entries before the run's end, within caps.
 */
export function isWellFormedLog(inputLog: unknown, submittedTicks: number): boolean {
  if (!Number.isInteger(submittedTicks) || submittedTicks <= 0 || submittedTicks > MAX_RIDE_TICKS) {
    return false;
  }
  if (!Array.isArray(inputLog) || inputLog.length > MAX_INPUT_LOG) return false;
  let prevTick = -1;
  for (const entry of inputLog) {
    if (!Array.isArray(entry) || entry.length !== 2) return false;
    const [tick, mask] = entry as [unknown, unknown];
    if (!Number.isInteger(tick) || (tick as number) < 0) return false;
    if (!Number.isInteger(mask) || (mask as number) < 0 || (mask as number) >= MAX_KEYMASK) return false;
    if ((tick as number) <= prevTick) return false; // strictly increasing
    prevTick = tick as number;
  }
  // The last input change must fall before the run actually ended.
  if (prevTick >= submittedTicks) return false;
  return true;
}

// ── Verification ─────────────────────────────────────────────────────────────

export interface VerifyArgs {
  points: readonly TrackPoint[];
  parTimeMs: number | undefined;
  worldLength: number;
  inputLog: readonly InputLogEntry[];
  /** The run's total tick count (browser snap.tick) — the replay length. */
  submittedTicks: number;
  /** The CLIENT's reported run — the official numbers we trust + gate. */
  client: {
    score: number;
    flips: number;
    finished: boolean;
    timeMs: number;
  };
  /** Generous per-track sanity ceiling (maxReasonableScore). */
  maxScore: number;
}

export interface VerifyResult {
  verifyStatus: VerifyStatus;
  /** The progress-check replay (NOT authoritative for the score), or null if malformed / threw. */
  replay: FinalResult | null;
  /** Furthest forward travel the replay demonstrated, meters past spawn (diagnostic). */
  progressMeters: number;
  /** Wall-clock cost of the replay+checks, ms (logged; budgeted < 2 s). */
  durationMs: number;
}

/**
 * Replay the submitted inputLog on the FROZEN track (capped at the run's actual
 * length) ONLY to prove a real ride happened, then grade the CLIENT's claimed
 * score:
 *  - malformed log / replay throws        → 'failed' (replay null)
 *  - replay didn't move the bike far       → 'flagged' (no real progress)
 *  - claimed score > sanity ceiling         → 'flagged'
 *  - claimed score implausible for the log  → 'flagged'
 *  - otherwise                              → 'verified' (client score is official)
 */
export function verifyRun(args: VerifyArgs): VerifyResult {
  const t0 = Date.now();

  if (!isWellFormedLog(args.inputLog, args.submittedTicks)) {
    return { verifyStatus: "failed", replay: null, progressMeters: 0, durationMs: Date.now() - t0 };
  }

  // Spawn x mirrors buildTrackInfo: the chassis starts LEAD_IN_METERS/2 ahead of
  // the first chart point. Computed directly (getTrackInfo needs a built Sim).
  const spawnX = (args.points[0]?.[0] ?? 0) - LEAD_IN_METERS / 2;

  let replay: FinalResult;
  try {
    // Replay EXACTLY the steps the browser ran (a finisher breaks at the flag; a
    // DNF stops where the player stopped, not at 72000). We use only maxX here.
    replay = simulateReplay(args.points, DEFAULT_TUNE, args.inputLog, args.submittedTicks, args.parTimeMs);
  } catch {
    return { verifyStatus: "failed", replay: null, progressMeters: 0, durationMs: Date.now() - t0 };
  }

  const progressMeters = replay.maxX - spawnX;

  // Progress: a real ride drives the bike forward; garbage barely moves it.
  if (progressMeters < PROGRESS_MIN_METERS) {
    return { verifyStatus: "flagged", replay, progressMeters, durationMs: Date.now() - t0 };
  }
  // Sanity ceiling on the claimed score.
  if (args.client.score > args.maxScore) {
    return { verifyStatus: "flagged", replay, progressMeters, durationMs: Date.now() - t0 };
  }
  // Plausibility: the claimed score must fit the log's length + activity.
  const plausible = maxPlausibleScore({
    ticks: args.submittedTicks,
    claimedFlips: args.client.flips,
    parTimeMs: args.parTimeMs,
    finished: args.client.finished,
    finishTimeMs: args.client.timeMs,
    worldLength: args.worldLength,
  });
  if (args.client.score > plausible) {
    return { verifyStatus: "flagged", replay, progressMeters, durationMs: Date.now() - t0 };
  }

  return { verifyStatus: "verified", replay, progressMeters, durationMs: Date.now() - t0 };
}

/** Only a verified, finished run earns a leaderboard / window rank. */
export function eligibleForRank(status: VerifyStatus, finished: boolean): boolean {
  return status === "verified" && finished;
}
