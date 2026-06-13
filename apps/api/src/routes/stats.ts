import type { FastifyPluginAsync } from "fastify";
import { getDb } from "../db.js";

interface StatsConfig {
  windowMinutes: number;
  maxScoreDefault: number;
}

const DEFAULT_CONFIG: StatsConfig = { windowMinutes: 30, maxScoreDefault: 50000 };

/**
 * GET /api/stats — global landing-page stats + the few cr_config values the
 * client needs to bootstrap (payout-window length, default per-track max score
 * for star thresholds). Never 500s: Home must render even if the DB hiccups.
 */
export const statsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async () => {
    const db = getDb();

    let ridesCompleted = 0;
    let totalSolPaid = 0;
    const config = { ...DEFAULT_CONFIG };

    const runsRes = await db.from("cr_runs").select("*", { count: "exact", head: true });
    if (runsRes.error) app.log.error(runsRes.error, "cr_runs count failed");
    else ridesCompleted = runsRes.count ?? 0;

    const payoutsRes = await db.from("cr_payouts").select("amount_sol").eq("status", "paid");
    if (payoutsRes.error) app.log.error(payoutsRes.error, "cr_payouts sum failed");
    else totalSolPaid = (payoutsRes.data ?? []).reduce((s, r) => s + Number(r.amount_sol ?? 0), 0);

    const cfgRes = await db
      .from("cr_config")
      .select("key,value")
      .in("key", ["window_minutes", "max_score_per_track_default"]);
    if (cfgRes.error) {
      app.log.error(cfgRes.error, "cr_config read failed");
    } else {
      for (const row of cfgRes.data ?? []) {
        if (row.key === "window_minutes") config.windowMinutes = Number(row.value) || config.windowMinutes;
        if (row.key === "max_score_per_track_default") {
          config.maxScoreDefault = Number(row.value) || config.maxScoreDefault;
        }
      }
    }

    return { ridesCompleted, totalSolPaid, config };
  });
};
