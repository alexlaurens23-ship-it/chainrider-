import { DEFAULT_TUNE, SCORING_CONFIG, simulateReplay } from "@chainrider/physics";
import type { FinalResult, InputLogEntry, TrackPoint } from "@chainrider/physics";

/**
 * AUTHORITATIVE-SERVER run verification (P7.2).
 *
 * Chrome-V8 and Node-V8 produce different floating-point results for the same
 * inputLog (transcendentals in planck aren't bit-identical across engines), so
 * "server score ≈ client score" is unachievable. Instead, the server's OWN
 * re-simulation of the submitted inputLog is the SOLE source of truth: we never
 * compare to the client's score. A cheater can't fake a score because the server
 * computes it from their actual replayed inputs; a generous per-track ceiling
 * backstops absurd physics-glitch scores.
 *
 * Pure (no DB/Fastify) so the fixtures drive it with real simulateReplay.
 * Scoring lives ONLY in packages/physics (hard rule 2) — unchanged here.
 */

export type VerifyStatus = "verified" | "flagged" | "failed";

/** 20-minute hard cap (1200 s × 60 fps) — the browser ride loop's MAX_RIDE_TICKS. */
export const MAX_RIDE_TICKS = 72000;
/** Max recorded input-log entries (also enforced at the route before insert). */
export const MAX_INPUT_LOG = 90000;
/** Keymask is a bitmask of 5 input bits — anything ≥ this is malformed. */
const MAX_KEYMASK = 256;

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
  inputLog: readonly InputLogEntry[];
  /** The run's total tick count (browser snap.tick) — the replay length. */
  submittedTicks: number;
  /** Generous per-track sanity ceiling (maxReasonableScore). */
  maxScore: number;
}

export interface VerifyResult {
  verifyStatus: VerifyStatus;
  /** The authoritative re-simulation, or null if malformed / replay threw. */
  server: FinalResult | null;
  /** Wall-clock cost of the replay+checks, ms (logged; budgeted < 2 s). */
  durationMs: number;
}

/**
 * Re-simulate the submitted inputLog on the FROZEN track, capped at the run's
 * actual length, and grade it on the SERVER's result alone:
 *  - malformed log / replay throws  → 'failed' (server null)
 *  - server replay didn't finish     → 'failed' (DNF, no rank)
 *  - server score > ceiling          → 'flagged' (held for admin review)
 *  - otherwise                       → 'verified' (server score is authoritative)
 */
export function verifyRun(args: VerifyArgs): VerifyResult {
  const t0 = Date.now();

  if (!isWellFormedLog(args.inputLog, args.submittedTicks)) {
    return { verifyStatus: "failed", server: null, durationMs: Date.now() - t0 };
  }

  let server: FinalResult;
  try {
    // Bug A fix: replay EXACTLY the steps the browser ran (a finisher still
    // breaks at the flag; a DNF stops where the player stopped, not at 72000).
    server = simulateReplay(args.points, DEFAULT_TUNE, args.inputLog, args.submittedTicks, args.parTimeMs);
  } catch {
    return { verifyStatus: "failed", server: null, durationMs: Date.now() - t0 };
  }

  if (!server.finished) {
    return { verifyStatus: "failed", server, durationMs: Date.now() - t0 }; // DNF → no rank
  }
  if (server.score > args.maxScore) {
    return { verifyStatus: "flagged", server, durationMs: Date.now() - t0 }; // sanity ceiling
  }
  return { verifyStatus: "verified", server, durationMs: Date.now() - t0 };
}

/** Only a verified, finished run earns a leaderboard / window rank. */
export function eligibleForRank(status: VerifyStatus, finished: boolean): boolean {
  return status === "verified" && finished;
}
