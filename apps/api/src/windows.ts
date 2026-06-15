import type { SupabaseClient } from "@supabase/supabase-js";
import cron from "node-cron";
import type { FastifyInstance } from "fastify";
import { closeWindow, createSupabaseRepo } from "./payouts.js";
import { getDb } from "./db.js";
import { notifyWindowClose } from "./telegram.js";

/**
 * Window engine — opens/closes the 30-minute UTC-aligned payout slots and calls
 * the EXISTING closeWindow() (P4.6) at each boundary. No payout math lives here.
 *
 * !!! SINGLE INSTANCE ONLY !!!
 * node-cron runs IN-PROCESS. Run exactly ONE API instance, or every instance
 * will fire the :00/:30 job and try to close the same window. A double-close is
 * SAFE (closeWindow is idempotent: app-level paid-track filter + the DB
 * unique(window_id, track_id) constraint), but do not deploy multiple schedulers.
 */

/** Payout window length: 30 minutes, aligned to the UTC clock (:00 / :30). */
export const WINDOW_MS = 30 * 60 * 1000;

/** Start of the UTC slot containing `nowMs`. */
export function slotStartMs(nowMs: number): number {
  return Math.floor(nowMs / WINDOW_MS) * WINDOW_MS;
}

/**
 * Ensure an OPEN window row exists for the current UTC slot and return its id.
 * Returns the id only if the slot's window is `open` (a slot already settled by
 * the cron returns null). The unique index on starts_at (sql/006) makes the
 * create idempotent, so concurrent first-submits can't double-create the slot.
 * This is the shared bucketing helper that routes/runs.ts also uses.
 */
export async function ensureOpenWindow(db: SupabaseClient): Promise<number | null> {
  const startMs = slotStartMs(Date.now());
  const startsAt = new Date(startMs).toISOString();

  const existing = await db
    .from("cr_payout_windows")
    .select("id, status")
    .eq("starts_at", startsAt)
    .maybeSingle();
  if (existing.data) {
    return existing.data.status === "open" ? (existing.data.id as number) : null;
  }

  const created = await db
    .from("cr_payout_windows")
    .upsert(
      { starts_at: startsAt, ends_at: new Date(startMs + WINDOW_MS).toISOString(), status: "open" },
      { onConflict: "starts_at", ignoreDuplicates: true },
    )
    .select("id, status")
    .maybeSingle();
  if (created.data) {
    return created.data.status === "open" ? (created.data.id as number) : null;
  }

  // Upsert ignored (lost the create race) — re-select.
  const reselect = await db
    .from("cr_payout_windows")
    .select("id, status")
    .eq("starts_at", startsAt)
    .maybeSingle();
  if (!reselect.data) return null;
  return reselect.data.status === "open" ? (reselect.data.id as number) : null;
}

/**
 * Close every still-open window whose end time has passed by calling the
 * EXISTING closeWindow(). Catches up any windows missed while the API was down.
 * Idempotent — a window already settled is not selected; re-closing inserts
 * nothing new.
 */
export async function closeElapsedWindows(
  db: SupabaseClient,
  log: FastifyInstance["log"],
): Promise<void> {
  const nowIso = new Date().toISOString();
  const { data, error } = await db
    .from("cr_payout_windows")
    .select("id, starts_at")
    .eq("status", "open")
    .lte("ends_at", nowIso);
  if (error) {
    log.error(error, "window-engine: failed to list elapsed windows");
    return;
  }
  const repo = createSupabaseRepo(db);
  for (const row of data ?? []) {
    const windowId = row.id as number;
    try {
      const result = await closeWindow(repo, windowId);
      log.info(
        { windowId, inserted: result.inserted, skippedAlreadyPaid: result.skippedAlreadyPaid },
        "window-engine: closed window",
      );
      // Additive side-effect: DM the owner the payouts to send (silent if none).
      // Wrapped so a Telegram failure can never break the close/settle path.
      if (result.inserted > 0) {
        try {
          await notifyWindowClose(db, windowId, (row.starts_at as string) ?? null, log);
        } catch (err) {
          log.error({ err, windowId }, "window-engine: payout notify failed");
        }
      }
    } catch (err) {
      log.error({ err, windowId }, "window-engine: closeWindow failed");
    }
  }
}

/** Close elapsed windows, then make sure the current slot is open. */
async function tick(db: SupabaseClient, log: FastifyInstance["log"]): Promise<void> {
  await closeElapsedWindows(db, log);
  const windowId = await ensureOpenWindow(db);
  if (windowId !== null) log.info({ windowId }, "window-engine: current window open");
}

/**
 * Boot the window engine: run a catch-up tick now (recovering any window missed
 * while down + opening the current slot), then schedule the :00/:30 boundary job.
 * Boot DB work is wrapped so the API still starts (and /api/health responds)
 * even without a database.
 */
export function startWindowEngine(app: FastifyInstance): void {
  const run = (): Promise<void> =>
    tick(getDb(), app.log).catch((err) => app.log.error(err, "window-engine: tick failed"));

  // Catch-up on boot (don't block listen on it).
  void run();

  // Fire on the UTC minute 0 and 30 of every hour.
  cron.schedule("0,30 * * * *", () => void run(), { timezone: "UTC" });
  app.log.info("window-engine: scheduled at :00 and :30 UTC (single-instance only)");
}
