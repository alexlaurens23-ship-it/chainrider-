import { DEFAULT_TUNE, simulateReplay } from "@chainrider/physics";
import type { FinalResult, InputLogEntry, TrackPoint } from "@chainrider/physics";

/**
 * Server-authoritative run verification (hard rule 4: client scores are never
 * trusted). Pure — no DB, no Fastify — so the anti-cheat fixtures can drive it
 * directly with real `simulateReplay`. The route layer in routes/runs.ts wraps
 * this with persistence, the serial queue, and ranking.
 *
 * Scoring lives ONLY in packages/physics (hard rule 2): we re-run the exact
 * recorded input log through `simulateReplay` under DEFAULT_TUNE and compare the
 * server's FinalResult to what the client claimed. server_score is the only
 * number that ever ranks or pays.
 */

export type VerifyStatus = "verified" | "flagged" | "failed";

/** 20-minute replay cap (1200 s × 60 fps), matching the ride loop's hard cap. */
export const MAX_REPLAY_TICKS = 72000;

/** Score must match within this fraction (plus exact stat/time match) to verify. */
export const SCORE_EXACT_PCT = 0.01;
/** Within this looser fraction (but not exact) → flagged for P7 admin review. */
export const SCORE_FLAG_PCT = 0.05;
/** Server vs client finish-time tolerance for a clean verify. */
export const TIME_TOLERANCE_MS = 250;

/** The client-claimed stats we cross-check against the re-simulation. */
export interface ClientClaim {
  score: number;
  flips: number;
  crashes: number;
  finished: boolean;
  timeMs: number;
}

export interface VerifyArgs {
  points: readonly TrackPoint[];
  parTimeMs: number | undefined;
  inputLog: readonly InputLogEntry[];
  client: ClientClaim;
  /** Replay tick cap; defaults to MAX_REPLAY_TICKS. The route always uses the default. */
  maxTicks?: number;
}

export interface VerifyResult {
  verifyStatus: VerifyStatus;
  /** The authoritative re-simulation, or null if the replay threw. */
  server: FinalResult | null;
  /** Wall-clock cost of the replay+compare, ms (logged; must be < 1 s). */
  durationMs: number;
}

/**
 * Re-simulate `inputLog` on the FROZEN track points and grade the client claim.
 * - exact (score ±1% AND flips/crashes/finished match AND time ±250ms) → verified
 * - else within ±5% score → flagged (stored, never auto-pays)
 * - else, or any replay error → failed
 */
export function verifyRun(args: VerifyArgs): VerifyResult {
  const t0 = Date.now();
  let server: FinalResult;
  try {
    server = simulateReplay(
      args.points,
      DEFAULT_TUNE,
      args.inputLog,
      args.maxTicks ?? MAX_REPLAY_TICKS,
      args.parTimeMs,
    );
  } catch {
    return { verifyStatus: "failed", server: null, durationMs: Date.now() - t0 };
  }

  const { client } = args;
  const scoreDiffPct = Math.abs(server.score - client.score) / Math.max(client.score, 1);
  const exact =
    scoreDiffPct <= SCORE_EXACT_PCT &&
    server.flips === client.flips &&
    server.crashes === client.crashes &&
    server.finished === client.finished &&
    Math.abs(server.timeMs - client.timeMs) <= TIME_TOLERANCE_MS;

  const verifyStatus: VerifyStatus = exact
    ? "verified"
    : scoreDiffPct <= SCORE_FLAG_PCT
      ? "flagged"
      : "failed";

  return { verifyStatus, server, durationMs: Date.now() - t0 };
}

/** Only a verified, finished run earns a leaderboard / window rank. */
export function eligibleForRank(status: VerifyStatus, finished: boolean): boolean {
  return status === "verified" && finished;
}
