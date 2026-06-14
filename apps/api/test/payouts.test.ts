import { describe, expect, it } from "vitest";
import {
  DEFAULT_PAYOUT_TIERS,
  closeWindow,
  computeWindowPayouts,
  prizeForRank,
  rankPool,
  type Finisher,
  type PayoutRepo,
  type PayoutRow,
  type PoolTrack,
} from "../src/payouts.js";

const TIERS = DEFAULT_PAYOUT_TIERS;

/** 25 tracks with descending scores (ids 1..25, score = 100-id). */
function tracks(n: number): PoolTrack[] {
  return Array.from({ length: n }, (_, i) => ({ id: i + 1, difficulty_score: 100 - i }));
}

describe("rankPool / prizeForRank", () => {
  it("takes the top 20 by score and prices them 0.2 / 0.1×9 / 0.05×10 (sum 1.6)", () => {
    const pool = rankPool(tracks(25), TIERS);
    expect(pool).toHaveLength(20);
    expect(pool[0]).toMatchObject({ rank: 1, prizeSol: 0.2, trackId: 1 });
    expect(pool.slice(1, 10).every((p) => p.prizeSol === 0.1)).toBe(true);
    expect(pool.slice(10, 20).every((p) => p.prizeSol === 0.05)).toBe(true);
    const total = pool.reduce((s, p) => s + p.prizeSol, 0);
    expect(total).toBeCloseTo(1.6, 9);
  });

  it("ranks by score DESC then id ASC; excludes ungraded tracks", () => {
    const pool = rankPool(
      [
        { id: 5, difficulty_score: 0.5 },
        { id: 2, difficulty_score: 0.9 },
        { id: 9, difficulty_score: 0.9 },
        { id: 7, difficulty_score: null },
      ],
      TIERS,
    );
    expect(pool.map((p) => p.trackId)).toEqual([2, 9, 5]); // 0.9(id2) > 0.9(id9) > 0.5
  });

  it("prizeForRank falls off past the pool", () => {
    expect(prizeForRank(1, TIERS)).toBe(0.2);
    expect(prizeForRank(10, TIERS)).toBe(0.1);
    expect(prizeForRank(20, TIERS)).toBe(0.05);
    expect(prizeForRank(21, TIERS)).toBe(0);
  });
});

describe("computeWindowPayouts", () => {
  const pool = rankPool(tracks(25), TIERS); // ids 1..20 in the pool

  it("one winner per track = highest server_score (min runId breaks ties)", () => {
    const finishers: Finisher[] = [
      { trackId: 1, playerId: "alice", runId: 10, serverScore: 5000 },
      { trackId: 1, playerId: "bob", runId: 11, serverScore: 9000 }, // bob wins track 1
      { trackId: 2, playerId: "carol", runId: 12, serverScore: 3000 },
      { trackId: 3, playerId: "alice", runId: 13, serverScore: 4000 }, // alice also wins track 3
    ];
    const rows = computeWindowPayouts(42, pool, finishers);
    expect(rows).toHaveLength(3);
    const t1 = rows.find((r) => r.track_id === 1)!;
    expect(t1).toMatchObject({ player_id: "bob", run_id: 11, rank: 1, amount_sol: 0.2 });
    expect(rows.find((r) => r.track_id === 2)).toMatchObject({ player_id: "carol", amount_sol: 0.1 });
    // A player can win multiple tracks in one window.
    expect(rows.filter((r) => r.player_id === "alice")).toHaveLength(1);
    expect(rows.find((r) => r.track_id === 3)).toMatchObject({ player_id: "alice", amount_sol: 0.1 });
  });

  it("a pool track with no finisher produces no payout", () => {
    const rows = computeWindowPayouts(42, pool, [
      { trackId: 5, playerId: "alice", runId: 1, serverScore: 100 },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].track_id).toBe(5);
  });

  it("a finisher on a NON-pool track (rank > 20) pays nothing", () => {
    const rows = computeWindowPayouts(42, pool, [
      { trackId: 25, playerId: "z", runId: 1, serverScore: 999 }, // id 25 is outside the top 20
    ]);
    expect(rows).toHaveLength(0);
  });
});

/** In-memory PayoutRepo: pre-filtered verified finishers, records inserts. */
function fakeRepo(finishers: Finisher[]): PayoutRepo & { inserted: PayoutRow[]; settled: number[] } {
  const inserted: PayoutRow[] = [];
  const settled: number[] = [];
  return {
    inserted,
    settled,
    fetchPayoutTiers: async () => TIERS,
    fetchPoolTracks: async () => tracks(25),
    fetchVerifiedFinishers: async () => finishers,
    // Idempotency source of truth: what's already been inserted for the window.
    fetchPaidTrackIds: async (windowId) =>
      new Set(inserted.filter((r) => r.window_id === windowId).map((r) => r.track_id)),
    insertPayouts: async (rows) => {
      inserted.push(...rows);
    },
    settleWindow: async (windowId) => {
      settled.push(windowId);
    },
  };
}

describe("closeWindow", () => {
  it("verified finishers on 3 paying tracks → 3 pending payouts at the right amounts", async () => {
    const repo = fakeRepo([
      { trackId: 1, playerId: "a", runId: 1, serverScore: 9000 },
      { trackId: 2, playerId: "b", runId: 2, serverScore: 8000 },
      { trackId: 11, playerId: "c", runId: 3, serverScore: 7000 },
    ]);
    const res = await closeWindow(repo, 100);
    expect(res.inserted).toBe(3);
    expect(repo.inserted.map((r) => r.amount_sol).sort()).toEqual([0.05, 0.1, 0.2]);
    expect(repo.inserted.every((r) => r.status === "pending" && r.window_id === 100)).toBe(true);
    expect(repo.settled).toContain(100);
  });

  it("never pays a track with zero finishers (dead-window guard)", async () => {
    const repo = fakeRepo([{ trackId: 1, playerId: "a", runId: 1, serverScore: 9000 }]);
    const res = await closeWindow(repo, 101);
    expect(res.inserted).toBe(1);
    expect(repo.inserted).toHaveLength(1);
    expect(repo.inserted[0].track_id).toBe(1);
  });

  it("closing the same window twice does not duplicate payouts", async () => {
    const repo = fakeRepo([
      { trackId: 1, playerId: "a", runId: 1, serverScore: 9000 },
      { trackId: 2, playerId: "b", runId: 2, serverScore: 8000 },
    ]);
    const first = await closeWindow(repo, 102);
    const second = await closeWindow(repo, 102);
    expect(first.inserted).toBe(2);
    expect(second.inserted).toBe(0);
    expect(second.skippedAlreadyPaid).toBe(2);
    expect(repo.inserted).toHaveLength(2); // total unchanged
  });
});
