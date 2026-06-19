/**
 * P9.5 — make every stored track rideable IN PLACE.
 *
 * For each ACTIVE cr_tracks row: load the frozen points, run makeRideable
 * (soften sharp spikes + clamp every segment to RIDEABLE_MAX_SLOPE_DEG, x
 * untouched), recompute the slope stats + par, and write them back. Track IDs
 * and leaderboards are preserved — this is NOT a CoinGecko regeneration (no data
 * drift, no new IDs). worldLength is the x-span, which makeRideable does not
 * change, so par is recomputed but lands on the same value (par keys off x-span,
 * not arc length); we still write it for completeness.
 *
 * REQUIRES the cr_tracks freeze trigger to be lifted first — it normally allows
 * only `active`/`par_time_ms`. Paste sql/011_resmooth_unfreeze.sql (disable),
 * run this, then re-enable. The script aborts with a clear message if the write
 * is rejected, so it is safe to run "blind".
 *
 * Usage: npm run smooth-tracks -w @chainrider/api   (idempotent — re-running on
 * already-rideable points is a near-identity; it just rewrites the same values.)
 */
import "dotenv/config";
import { SCORING_CONFIG } from "@chainrider/physics";
import { getDb } from "../src/db.js";
import {
  RIDEABLE_MAX_SLOPE_DEG,
  RIDEABLE_SMOOTH_PASSES,
  makeRideable,
  stats,
  type Tier,
  type TrackPoint,
} from "../src/trackgen.js";

interface Row {
  id: number;
  tier: Tier;
  mode: string;
  points: TrackPoint[];
}

function maxGradDeg(points: TrackPoint[]): number {
  let m = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i][0] - points[i - 1][0];
    const dy = points[i][1] - points[i - 1][1];
    const d = (Math.atan(Math.abs(dy) / dx) * 180) / Math.PI;
    if (d > m) m = d;
  }
  return Math.round(m * 100) / 100;
}

async function main(): Promise<void> {
  const db = getDb();
  const { data, error } = await db
    .from("cr_tracks")
    .select("id,tier,mode,points")
    .eq("active", true)
    .order("id", { ascending: true });
  if (error) throw new Error(`fetch failed: ${error.message}`);
  const rows = (data ?? []) as Row[];
  console.log(
    `re-smoothing ${rows.length} active tracks (cap=${RIDEABLE_MAX_SLOPE_DEG}° + ${RIDEABLE_SMOOTH_PASSES} passes)…`,
  );

  let updated = 0;
  let worstBefore = 0;
  let worstAfter = 0;
  for (const t of rows) {
    const before = t.points;
    const after = makeRideable(before); // soften + clamp to RIDEABLE_MAX_SLOPE_DEG, x preserved
    const s = stats(after);
    const pace = SCORING_CONFIG.parPaceMps[t.tier];
    const parTimeMs = Math.round((s.worldLength / pace) * 1000);

    worstBefore = Math.max(worstBefore, maxGradDeg(before));
    worstAfter = Math.max(worstAfter, s.maxSlopeDeg);

    const up = await db
      .from("cr_tracks")
      .update({
        points: after,
        point_count: s.pointCount,
        world_length: s.worldLength,
        max_slope_deg: s.maxSlopeDeg,
        volatility: s.volatility,
        difficulty_score: s.difficultyScore,
        par_time_ms: parTimeMs,
      })
      .eq("id", t.id);
    if (up.error) {
      if (/frozen/i.test(up.error.message)) {
        console.error(
          `\n✗ BLOCKED on track ${t.id}: the cr_tracks freeze trigger is still active ` +
            `(only active/par_time_ms updatable).\n  Apply sql/011_resmooth_unfreeze.sql in ` +
            `the Supabase SQL editor to lift it, run this script, then re-enable.\n`,
        );
        process.exit(2);
      }
      throw new Error(`update failed on track ${t.id}: ${up.error.message}`);
    }
    updated++;
  }

  console.log(`done: ${updated} tracks rewritten.`);
  console.log(`worst max gradient: ${worstBefore}° → ${worstAfter}°`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
