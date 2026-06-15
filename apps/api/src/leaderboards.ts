/**
 * Leaderboard shaping — pure, unit-tested. The routes fetch verified+finished
 * cr_runs and hand them here; ranking/payout never trusts client stats
 * (server_score only). One row PER PLAYER (their best), ranked.
 */

/** A verified run as the leaderboard consumes it. */
export interface LeaderboardRun {
  playerId: string;
  username: string;
  serverScore: number;
  timeMs: number;
  flips: number;
  createdAt: string;
}

export interface LeaderboardEntry {
  rank: number;
  username: string;
  score: number;
  timeMs: number;
  flips: number;
  createdAt: string;
}

/** Better-first comparator: higher server_score, then lower time_ms. */
function bestFirst(a: LeaderboardRun, b: LeaderboardRun): number {
  return b.serverScore - a.serverScore || a.timeMs - b.timeMs;
}

/** Collapse runs to each player's single best run, ordered best-first. */
function perPlayerBests(runs: readonly LeaderboardRun[]): LeaderboardRun[] {
  const best = new Map<string, LeaderboardRun>();
  for (const r of runs) {
    const cur = best.get(r.playerId);
    if (!cur || bestFirst(r, cur) < 0) best.set(r.playerId, r);
  }
  return [...best.values()].sort(bestFirst);
}

/**
 * One row per player (their best), ordered best-first, top `n`, 1-based ranks.
 */
export function topPerPlayer(runs: readonly LeaderboardRun[], n: number): LeaderboardEntry[] {
  return perPlayerBests(runs)
    .slice(0, n)
    .map((r, i) => ({
      rank: i + 1,
      username: r.username,
      score: r.serverScore,
      timeMs: r.timeMs,
      flips: r.flips,
      createdAt: r.createdAt,
    }));
}

/**
 * 1-based all-time rank of `playerId` among per-player bests, or null if the
 * player has no qualifying run.
 */
export function rankOfPlayer(runs: readonly LeaderboardRun[], playerId: string): number | null {
  const idx = perPlayerBests(runs).findIndex((r) => r.playerId === playerId);
  return idx === -1 ? null : idx + 1;
}
