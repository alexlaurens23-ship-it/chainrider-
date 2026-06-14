/**
 * One-time backfill of cr_tracks.difficulty_score for all existing tracks.
 *
 * Reads each frozen track's `points`, recomputes `stats(points).difficultyScore`
 * (pure, deterministic), and writes only difficulty_score — points are never
 * touched, so the freeze guard is not tripped. Idempotent: re-running recomputes
 * the same value. Requires sql/004 (the difficulty_score column) applied first.
 *
 * Usage: npm run backfill -w @chainrider/api   (needs SUPABASE_* in apps/api/.env)
 */
import "dotenv/config";
import { getDb } from "../src/db.js";
import { stats, type TrackPoint } from "../src/trackgen.js";

async function main(): Promise<void> {
  const db = getDb();

  const res = await db.from("cr_tracks").select("id,points");
  if (res.error) {
    console.error("failed to read cr_tracks:", res.error.message);
    process.exit(1);
  }
  const rows = (res.data ?? []) as { id: number; points: TrackPoint[] }[];
  console.log(`backfilling difficulty_score for ${rows.length} tracks…`);

  let updated = 0;
  let failures = 0;
  for (const row of rows) {
    let score: number;
    try {
      score = stats(row.points).difficultyScore;
    } catch (err) {
      failures++;
      console.error(`  track ${row.id}: compute failed — ${String(err)}`);
      continue;
    }
    const up = await db.from("cr_tracks").update({ difficulty_score: score }).eq("id", row.id);
    if (up.error) {
      failures++;
      console.error(`  track ${row.id}: update failed — ${up.error.message}`);
    } else {
      updated++;
    }
  }

  console.log(`done: ${updated} updated, ${failures} failed.`);
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
