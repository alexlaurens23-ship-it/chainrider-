import type { FastifyPluginAsync } from "fastify";
import { getDb } from "../db.js";
import { DEFAULT_PAYOUT_TIERS, prizeForRank, type PayoutTiers } from "../payouts.js";

interface PoolRow {
  id: number;
  tier: string;
  mode: string;
  difficulty_score: number | null;
  cr_maps: { symbol: string; period: string } | null;
}

/**
 * GET /api/payout-pool — the current paying pool: the top-N hardest tracks by
 * difficulty_score, each with pool rank + SOL prize + coin/period/tier/mode.
 * Re-computed live, so re-grading reshuffles it. Tracks not listed pay 0.
 */
export const payoutPoolRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (_req, reply) => {
    const db = getDb();

    const cfgRes = await db
      .from("cr_config")
      .select("value")
      .eq("key", "payout_tiers")
      .maybeSingle();
    if (cfgRes.error) {
      app.log.error(cfgRes.error, "payout_tiers read failed");
      return reply.code(500).send({ error: "database error" });
    }
    const tiers = (cfgRes.data?.value as PayoutTiers) ?? DEFAULT_PAYOUT_TIERS;

    const tracksRes = await db
      .from("cr_tracks")
      .select("id,tier,mode,difficulty_score,cr_maps(symbol,period)")
      .eq("active", true)
      .eq("mode", "raw") // RAW-only paying pool; smooth never pays.
      .not("difficulty_score", "is", null)
      .order("difficulty_score", { ascending: false })
      .order("id", { ascending: true })
      .limit(tiers.poolSize);
    if (tracksRes.error) {
      app.log.error(tracksRes.error, "payout pool query failed");
      return reply.code(500).send({ error: "database error" });
    }
    const rows = (tracksRes.data ?? []) as unknown as PoolRow[];

    const tracks = rows.map((r, i) => {
      const rank = i + 1;
      return {
        rank,
        trackId: r.id,
        prizeSol: prizeForRank(rank, tiers),
        difficultyScore: r.difficulty_score,
        symbol: r.cr_maps?.symbol ?? null,
        period: r.cr_maps?.period ?? null,
        tier: r.tier,
        mode: r.mode,
      };
    });

    let maxSolPerWindow = 0;
    for (let rank = 1; rank <= tiers.poolSize; rank++) maxSolPerWindow += prizeForRank(rank, tiers);

    return { poolSize: tiers.poolSize, maxSolPerWindow: Number(maxSolPerWindow.toFixed(6)), tracks };
  });
};
