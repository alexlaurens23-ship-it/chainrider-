/**
 * Steepness-graded payout pool + window-close payout logic.
 *
 * The pool is the TOP-N hardest tracks by difficulty_score, with prizes assigned
 * by RANK (a rule in cr_config.payout_tiers), so re-grading reshuffles the pool
 * automatically — no track ids are ever hardcoded. The pure core (rankPool,
 * prizeForRank, computeWindowPayouts) is unit-tested; closeWindow orchestrates
 * over a small PayoutRepo so it can run against Supabase OR a fake in tests.
 *
 * Hard rule: a track only pays out for a window if at least one VERIFIED,
 * FINISHING run exists for it that window. Empty / DNF-only tracks pay nothing.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** A prize rule: rank ≤ maxRank (and above the previous rule's) earns `sol`. */
export interface PayoutRule {
  maxRank: number;
  sol: number;
}
export interface PayoutTiers {
  poolSize: number;
  rules: PayoutRule[];
}

/**
 * Paying pool: the top-10 hardest RAW tracks (smooth is the chill mode and never
 * pays). Prize by pool rank: 1 → 0.2, 2–5 → 0.1, 6–10 → 0.05 SOL (max 0.85/window).
 * cr_config.payout_tiers is the live source of truth; this is the fallback.
 */
export const DEFAULT_PAYOUT_TIERS: PayoutTiers = {
  poolSize: 10,
  rules: [
    { maxRank: 1, sol: 0.2 },
    { maxRank: 5, sol: 0.1 },
    { maxRank: 10, sol: 0.05 },
  ],
};

export interface PoolTrack {
  id: number;
  difficulty_score: number | null;
}
export interface RankedTrack {
  trackId: number;
  rank: number;
  prizeSol: number;
  difficultyScore: number;
}
export interface Finisher {
  trackId: number;
  playerId: string;
  runId: number;
  serverScore: number;
}
export interface PayoutRow {
  window_id: number;
  track_id: number;
  player_id: string;
  run_id: number;
  rank: number;
  amount_sol: number;
  status: "pending";
}

/** SOL for a 1-based pool rank (the first rule it falls under), else 0. */
export function prizeForRank(rank: number, tiers: PayoutTiers): number {
  for (const rule of tiers.rules) {
    if (rank <= rule.maxRank) return rule.sol;
  }
  return 0;
}

/**
 * Rank the paying pool: the top `poolSize` tracks by difficulty_score DESC
 * (id ASC as a deterministic tiebreaker), each with its rank + prize. Tracks
 * without a score are excluded. Pure.
 */
export function rankPool(tracks: readonly PoolTrack[], tiers: PayoutTiers): RankedTrack[] {
  const graded = tracks
    .filter((t) => t.difficulty_score != null)
    .map((t) => ({ id: t.id, score: t.difficulty_score as number }))
    .sort((a, b) => b.score - a.score || a.id - b.id);

  return graded.slice(0, tiers.poolSize).map((t, i) => {
    const rank = i + 1;
    return { trackId: t.id, rank, prizeSol: prizeForRank(rank, tiers), difficultyScore: t.score };
  });
}

/**
 * One winner per paying track: the highest-server_score finisher (lowest runId
 * breaks ties for determinism). Tracks with no finisher produce NO row — that
 * is the no-dead-window guard. Pure. `finishers` must already be filtered to
 * verified + finishing runs for the window.
 */
export function computeWindowPayouts(
  windowId: number,
  pool: readonly RankedTrack[],
  finishers: readonly Finisher[],
): PayoutRow[] {
  const byTrack = new Map<number, Finisher>();
  for (const f of finishers) {
    const best = byTrack.get(f.trackId);
    if (
      !best ||
      f.serverScore > best.serverScore ||
      (f.serverScore === best.serverScore && f.runId < best.runId)
    ) {
      byTrack.set(f.trackId, f);
    }
  }

  const rows: PayoutRow[] = [];
  for (const t of pool) {
    const winner = byTrack.get(t.trackId);
    if (!winner) continue; // no verified finisher → no payout for this track
    rows.push({
      window_id: windowId,
      track_id: t.trackId,
      player_id: winner.playerId,
      run_id: winner.runId,
      rank: t.rank,
      amount_sol: t.prizeSol,
      status: "pending",
    });
  }
  return rows;
}

/** IO surface closeWindow needs — swap a fake in for tests. */
export interface PayoutRepo {
  fetchPayoutTiers(): Promise<PayoutTiers>;
  fetchPoolTracks(): Promise<PoolTrack[]>;
  fetchVerifiedFinishers(windowId: number): Promise<Finisher[]>;
  fetchPaidTrackIds(windowId: number): Promise<Set<number>>;
  insertPayouts(rows: PayoutRow[]): Promise<void>;
  settleWindow(windowId: number): Promise<void>;
}

export interface CloseWindowResult {
  windowId: number;
  payouts: PayoutRow[];
  inserted: number;
  skippedAlreadyPaid: number;
}

/**
 * Compute + persist the pending payouts for a closed window. Idempotent: tracks
 * already paid this window are dropped (app-level), backed by the DB
 * unique(window_id, track_id) constraint — closing twice inserts nothing new.
 */
export async function closeWindow(repo: PayoutRepo, windowId: number): Promise<CloseWindowResult> {
  const [tiers, poolTracks, finishers, paid] = await Promise.all([
    repo.fetchPayoutTiers(),
    repo.fetchPoolTracks(),
    repo.fetchVerifiedFinishers(windowId),
    repo.fetchPaidTrackIds(windowId),
  ]);

  const pool = rankPool(poolTracks, tiers);
  const computed = computeWindowPayouts(windowId, pool, finishers);
  const fresh = computed.filter((r) => !paid.has(r.track_id));

  if (fresh.length > 0) await repo.insertPayouts(fresh);
  await repo.settleWindow(windowId);

  return {
    windowId,
    payouts: fresh,
    inserted: fresh.length,
    skippedAlreadyPaid: computed.length - fresh.length,
  };
}

/** Production repo over the service-role Supabase client. */
export function createSupabaseRepo(db: SupabaseClient): PayoutRepo {
  return {
    async fetchPayoutTiers() {
      const res = await db.from("cr_config").select("value").eq("key", "payout_tiers").maybeSingle();
      if (res.error) throw res.error;
      return (res.data?.value as PayoutTiers) ?? DEFAULT_PAYOUT_TIERS;
    },
    async fetchPoolTracks() {
      // Order/limit happen in rankPool; fetch all graded active RAW tracks only
      // (smooth never pays). The top-10 by difficulty_score become the pool.
      const res = await db
        .from("cr_tracks")
        .select("id,difficulty_score")
        .eq("active", true)
        .eq("mode", "raw")
        .not("difficulty_score", "is", null);
      if (res.error) throw res.error;
      return (res.data ?? []) as PoolTrack[];
    },
    async fetchVerifiedFinishers(windowId) {
      const res = await db
        .from("cr_runs")
        .select("id,track_id,player_id,server_score")
        .eq("window_id", windowId)
        .eq("verify_status", "verified")
        .eq("finished", true)
        .not("server_score", "is", null);
      if (res.error) throw res.error;
      return (res.data ?? []).map((r) => ({
        trackId: r.track_id as number,
        playerId: r.player_id as string,
        runId: r.id as number,
        serverScore: Number(r.server_score),
      }));
    },
    async fetchPaidTrackIds(windowId) {
      const res = await db.from("cr_payouts").select("track_id").eq("window_id", windowId);
      if (res.error) throw res.error;
      return new Set((res.data ?? []).map((r) => r.track_id as number));
    },
    async insertPayouts(rows) {
      // unique(window_id, track_id) is the hard idempotency backstop.
      const res = await db
        .from("cr_payouts")
        .upsert(rows, { onConflict: "window_id,track_id", ignoreDuplicates: true });
      if (res.error) throw res.error;
    },
    async settleWindow(windowId) {
      const res = await db.from("cr_payout_windows").update({ status: "settled" }).eq("id", windowId);
      if (res.error) throw res.error;
    },
  };
}
