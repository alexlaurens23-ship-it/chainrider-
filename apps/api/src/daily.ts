import type { SupabaseClient } from "@supabase/supabase-js";
import cron from "node-cron";
import type { FastifyInstance } from "fastify";
import { getDb } from "./db.js";
import { notifyDailyWinner } from "./telegram.js";

/**
 * Daily challenge engine — one random track per UTC day; the top verified +
 * finished run that day wins (1st only). Layered on the existing system: daily
 * runs are just cr_runs filtered by the day's track + window, and the payout is
 * a cr_payouts row (kind='daily') the Telegram bot + receipts already handle.
 *
 * !!! SINGLE INSTANCE ONLY !!! node-cron is in-process (same as windows.ts).
 */

const DEFAULT_DAILY_PRIZE = 0.5;

// ── Pure helpers (unit-tested) ──────────────────────────────────────────────

/** UTC-day bounds for the day containing `now`. challengeDate is YYYY-MM-DD. */
export function dayBoundsUTC(now: Date): { challengeDate: string; startsAt: string; endsAt: string } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  const start = new Date(Date.UTC(y, m, d, 0, 0, 0, 0));
  const end = new Date(Date.UTC(y, m, d + 1, 0, 0, 0, 0));
  return {
    challengeDate: start.toISOString().slice(0, 10),
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
  };
}

/** Uniformly pick one id (Math.random — NOT the deterministic sim, RNG is fine here). */
export function pickRandomTrackId(ids: readonly number[]): number | null {
  if (ids.length === 0) return null;
  return ids[Math.floor(Math.random() * ids.length)];
}

/** A daily-eligible run (verified + finished) as the winner picker consumes it. */
export interface DailyRun {
  runId: number;
  playerId: string;
  serverScore: number;
  timeMs: number;
}

/** The winner: highest server_score, lower time_ms breaks ties. Null if none. */
export function pickDailyWinner(runs: readonly DailyRun[]): DailyRun | null {
  let best: DailyRun | null = null;
  for (const r of runs) {
    if (!best || r.serverScore > best.serverScore || (r.serverScore === best.serverScore && r.timeMs < best.timeMs)) {
      best = r;
    }
  }
  return best;
}

// ── DB ops ──────────────────────────────────────────────────────────────────

export interface DailyChallengeRow {
  id: number;
  track_id: number;
  challenge_date: string;
  starts_at: string;
  ends_at: string;
  status: string;
}

/** Tunable daily prize (SOL) from cr_config; falls back to 0.5. */
export async function dailyPrizeSol(db: SupabaseClient): Promise<number> {
  const { data } = await db.from("cr_config").select("value").eq("key", "daily_prize_sol").maybeSingle();
  const v = typeof data?.value === "number" ? data.value : Number(data?.value);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_DAILY_PRIZE;
}

async function activeTrackIds(db: SupabaseClient): Promise<number[]> {
  const { data, error } = await db.from("cr_tracks").select("id").eq("active", true);
  if (error) throw error;
  return (data ?? []).map((r) => r.id as number);
}

/**
 * Ensure today's UTC challenge row exists; if not, pick a random active track
 * and create it. Idempotent (the challenge_date unique makes a concurrent/repeat
 * create a no-op). Returns the open row, or null if no active tracks exist.
 */
export async function ensureTodayDaily(
  db: SupabaseClient,
  log: FastifyInstance["log"],
): Promise<DailyChallengeRow | null> {
  const { challengeDate, startsAt, endsAt } = dayBoundsUTC(new Date());

  const existing = await db
    .from("cr_daily_challenges")
    .select("id,track_id,challenge_date,starts_at,ends_at,status")
    .eq("challenge_date", challengeDate)
    .maybeSingle();
  if (existing.data) return existing.data as DailyChallengeRow;

  const trackId = pickRandomTrackId(await activeTrackIds(db));
  if (trackId == null) {
    log.error("daily-engine: no active tracks to pick from");
    return null;
  }

  const created = await db
    .from("cr_daily_challenges")
    .upsert(
      { track_id: trackId, challenge_date: challengeDate, starts_at: startsAt, ends_at: endsAt, status: "open" },
      { onConflict: "challenge_date", ignoreDuplicates: true },
    )
    .select("id,track_id,challenge_date,starts_at,ends_at,status")
    .maybeSingle();
  if (created.data) {
    log.info({ challengeDate, trackId: created.data.track_id }, "daily-engine: opened daily challenge");
    return created.data as DailyChallengeRow;
  }

  // Lost the create race — re-select.
  const reselect = await db
    .from("cr_daily_challenges")
    .select("id,track_id,challenge_date,starts_at,ends_at,status")
    .eq("challenge_date", challengeDate)
    .maybeSingle();
  return (reselect.data as DailyChallengeRow) ?? null;
}

/**
 * Settle one daily: find the top verified + finished run on its track within its
 * window, record the winner, and (if any) create a pending cr_payouts row +
 * notify Telegram. No finisher → settled with no payout. Idempotent: only ever
 * called for status='open' rows, and the cr_payouts daily unique index backstops
 * a double insert.
 */
export async function settleDaily(
  db: SupabaseClient,
  row: DailyChallengeRow,
  log: FastifyInstance["log"],
): Promise<{ winner: DailyRun | null }> {
  const { data, error } = await db
    .from("cr_runs")
    .select("id,player_id,server_score,time_ms")
    .eq("track_id", row.track_id)
    .eq("verify_status", "verified")
    .eq("finished", true)
    .not("server_score", "is", null)
    .gte("created_at", row.starts_at)
    .lt("created_at", row.ends_at);
  if (error) throw error;

  const runs: DailyRun[] = (data ?? []).map((r) => ({
    runId: r.id as number,
    playerId: r.player_id as string,
    serverScore: Number(r.server_score),
    timeMs: r.time_ms as number,
  }));
  const winner = pickDailyWinner(runs);

  await db
    .from("cr_daily_challenges")
    .update({
      status: "settled",
      winner_player_id: winner?.playerId ?? null,
      winner_score: winner?.serverScore ?? null,
    })
    .eq("id", row.id)
    .eq("status", "open");

  if (!winner) {
    log.info({ dailyId: row.id, trackId: row.track_id }, "daily-engine: settled with no finisher (no payout)");
    return { winner: null };
  }

  const prize = await dailyPrizeSol(db);
  const ins = await db.from("cr_payouts").insert({
    kind: "daily",
    daily_challenge_id: row.id,
    window_id: null,
    track_id: row.track_id,
    player_id: winner.playerId,
    run_id: winner.runId,
    rank: 1,
    amount_sol: prize,
    status: "pending",
  });
  if (ins.error) {
    // Unique backstop (already paid this daily) or a real error — log, don't throw.
    log.error({ err: ins.error, dailyId: row.id }, "daily-engine: payout insert failed");
    return { winner };
  }
  log.info({ dailyId: row.id, winner: winner.playerId, score: winner.serverScore, prize }, "daily-engine: settled with winner");

  try {
    await notifyDailyWinner(db, row.id, log);
  } catch (err) {
    log.error({ err, dailyId: row.id }, "daily-engine: winner notify failed");
  }
  return { winner };
}

/** Settle every open daily whose day has ended (boot catch-up + the 00:00 cron). */
export async function settleElapsedDailies(db: SupabaseClient, log: FastifyInstance["log"]): Promise<void> {
  const nowIso = new Date().toISOString();
  const { data, error } = await db
    .from("cr_daily_challenges")
    .select("id,track_id,challenge_date,starts_at,ends_at,status")
    .eq("status", "open")
    .lte("ends_at", nowIso);
  if (error) {
    log.error(error, "daily-engine: failed to list elapsed dailies");
    return;
  }
  for (const row of (data ?? []) as DailyChallengeRow[]) {
    try {
      await settleDaily(db, row, log);
    } catch (err) {
      log.error({ err, dailyId: row.id }, "daily-engine: settleDaily failed");
    }
  }
}

async function tick(db: SupabaseClient, log: FastifyInstance["log"]): Promise<void> {
  await settleElapsedDailies(db, log);
  await ensureTodayDaily(db, log);
}

/**
 * Boot the daily engine: catch-up tick now (settle elapsed + ensure today), then
 * the 00:00 UTC cron. SINGLE INSTANCE ONLY.
 */
export function startDailyEngine(app: FastifyInstance): void {
  const run = (): Promise<void> =>
    tick(getDb(), app.log).catch((err) => app.log.error(err, "daily-engine: tick failed"));
  void run();
  cron.schedule("0 0 * * *", () => void run(), { timezone: "UTC" });
  app.log.info("daily-engine: scheduled at 00:00 UTC (single-instance only)");
}
