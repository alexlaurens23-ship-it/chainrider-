import type { FastifyPluginAsync } from "fastify";
import { getDb } from "../db.js";

interface PaidRow {
  amount_sol: number;
  tx_sig: string | null;
  paid_at: string | null;
  cr_players: { username: string } | null;
  cr_tracks: { tier: string; mode: string; cr_maps: { symbol: string; period: string } | null } | null;
}

/**
 * Public payout receipts — proof the prize pool actually pays. Open (no auth):
 * the trust flywheel. Private keys never appear here (only the on-chain tx sig).
 */
export const payoutsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/paid", async (_req, reply) => {
    const db = getDb();
    const { data, error } = await db
      .from("cr_payouts")
      .select(
        "amount_sol,tx_sig,paid_at,cr_players(username),cr_tracks(tier,mode,cr_maps(symbol,period))",
      )
      .eq("status", "paid")
      .order("paid_at", { ascending: false })
      .limit(50);
    if (error) {
      app.log.error(error, "payouts/paid query failed");
      return reply.code(500).send({ error: "database error" });
    }
    return ((data ?? []) as unknown as PaidRow[]).map((r) => {
      const t = r.cr_tracks;
      const label = t
        ? `${t.cr_maps?.symbol ?? "?"} ${t.cr_maps?.period ?? "?"} ${t.tier} · ${t.mode}`
        : "track";
      return {
        paidAt: r.paid_at,
        label,
        username: r.cr_players?.username ?? "—",
        amountSol: Number(r.amount_sol),
        txSig: r.tx_sig,
      };
    });
  });
};
