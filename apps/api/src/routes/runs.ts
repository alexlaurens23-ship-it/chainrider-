import { SIM_VERSION } from "@chainrider/physics";
import type { InputLogEntry, TrackPoint } from "@chainrider/physics";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FastifyPluginAsync } from "fastify";
import { requireAuth } from "../auth.js";
import { getDb } from "../db.js";
import { eligibleForRank, verifyRun } from "../runVerify.js";

interface SubmitBody {
  trackId: number;
  mode: "raw" | "smooth";
  clientScore: number;
  timeMs: number;
  ticks: number;
  flips: number;
  crashes: number;
  maxCombo: number;
  finished: boolean;
  simVersion: number;
  inputLog: InputLogEntry[];
}

/** Hard cap on the recorded input log (entries, not ticks). */
const MAX_INPUT_LOG = 90000;
/** Per-player submission throttle. */
const RATE_LIMIT_MS = 10_000;
/** UTC-aligned payout window length (30 min). */
const WINDOW_MS = 30 * 60 * 1000;

// In-memory rate-limit (spec: in-memory map is fine; resets on restart).
const lastSubmitMs = new Map<string, number>();

// Cached config; min_run_time_ms changes rarely.
let minRunTimeMs: number | null = null;
async function getMinRunTimeMs(db: SupabaseClient): Promise<number> {
  if (minRunTimeMs !== null) return minRunTimeMs;
  const { data } = await db
    .from("cr_config")
    .select("value")
    .eq("key", "min_run_time_ms")
    .maybeSingle();
  minRunTimeMs = typeof data?.value === "number" ? (data.value as number) : 8000;
  return minRunTimeMs;
}

/**
 * Serial verify queue: replays are CPU-bound, so run exactly one at a time even
 * under concurrent submissions. A module-level promise chain; the handler awaits
 * its own link so it can return the real verify result.
 */
let queueTail: Promise<unknown> = Promise.resolve();
function runSerial<T>(fn: () => Promise<T>): Promise<T> {
  const result = queueTail.then(fn, fn);
  queueTail = result.catch(() => undefined);
  return result;
}

/**
 * Bucket the run into the current UTC-aligned 30-min payout window, creating the
 * row if this is the first run of the window. P7's cron owns window lifecycle
 * (opening/closing/paying); submission only needs the right id to attach.
 */
async function getOrCreateOpenWindow(db: SupabaseClient): Promise<number | null> {
  const startMs = Math.floor(Date.now() / WINDOW_MS) * WINDOW_MS;
  const startsAt = new Date(startMs).toISOString();
  const existing = await db
    .from("cr_payout_windows")
    .select("id")
    .eq("starts_at", startsAt)
    .maybeSingle();
  if (existing.data) return existing.data.id as number;
  const created = await db
    .from("cr_payout_windows")
    .insert({ starts_at: startsAt, ends_at: new Date(startMs + WINDOW_MS).toISOString(), status: "open" })
    .select("id")
    .single();
  if (created.data) return created.data.id as number;
  // Lost a create race — re-select.
  const reselect = await db
    .from("cr_payout_windows")
    .select("id")
    .eq("starts_at", startsAt)
    .maybeSingle();
  return reselect.data ? (reselect.data.id as number) : null;
}

/** Count of strictly-higher verified+finished server_scores on a track (+1 = rank). */
async function rankByScore(
  db: SupabaseClient,
  trackId: number,
  serverScore: number,
  windowId: number | null,
): Promise<number> {
  let q = db
    .from("cr_runs")
    .select("id", { count: "exact", head: true })
    .eq("track_id", trackId)
    .eq("verify_status", "verified")
    .eq("finished", true)
    .gt("server_score", serverScore);
  if (windowId !== null) q = q.eq("window_id", windowId);
  const { count } = await q;
  return (count ?? 0) + 1;
}

/** Run submission + server-side re-simulation via @chainrider/physics (cr_runs). */
export const runsRoutes: FastifyPluginAsync = async (app) => {
  app.decorateRequest("player", null);

  app.post<{ Body: SubmitBody }>(
    "/submit",
    {
      preHandler: requireAuth,
      schema: {
        body: {
          type: "object",
          required: ["trackId", "mode", "clientScore", "timeMs", "ticks", "simVersion", "inputLog"],
          properties: {
            trackId: { type: "integer" },
            mode: { enum: ["raw", "smooth"] },
            clientScore: { type: "number" },
            timeMs: { type: "number" },
            ticks: { type: "integer" },
            flips: { type: "integer" },
            crashes: { type: "integer" },
            maxCombo: { type: "integer" },
            finished: { type: "boolean" },
            simVersion: { type: "integer" },
            inputLog: { type: "array", items: { type: "array", items: { type: "number" } } },
          },
        },
      },
    },
    async (req, reply) => {
      const player = req.player;
      if (!player) return reply.code(401).send({ error: "unauthorized" });
      const db = getDb();
      const body = req.body;

      // ── Fast rejects (before any DB write) ──────────────────────────────
      const { data: playerRow } = await db
        .from("cr_players")
        .select("banned")
        .eq("id", player.playerId)
        .maybeSingle();
      if (!playerRow) return reply.code(401).send({ error: "unknown player" });
      if (playerRow.banned) return reply.code(403).send({ error: "player banned" });

      if (body.simVersion !== SIM_VERSION) {
        return reply.code(400).send({ error: `simVersion must be ${SIM_VERSION}` });
      }
      const minTime = await getMinRunTimeMs(db);
      if (body.timeMs < minTime) {
        return reply.code(400).send({ error: "run too short" });
      }
      if (body.inputLog.length > MAX_INPUT_LOG) {
        return reply.code(400).send({ error: "input log too long" });
      }
      const now = Date.now();
      const last = lastSubmitMs.get(player.playerId) ?? 0;
      if (now - last < RATE_LIMIT_MS) {
        return reply.code(429).send({ error: "slow down" });
      }
      lastSubmitMs.set(player.playerId, now);

      // ── Bucket into the open window + insert as pending ─────────────────
      const windowId = await getOrCreateOpenWindow(db);
      const { data: inserted, error: insErr } = await db
        .from("cr_runs")
        .insert({
          player_id: player.playerId,
          track_id: body.trackId,
          window_id: windowId,
          client_score: Math.round(body.clientScore),
          time_ms: Math.round(body.timeMs),
          flips: body.flips ?? 0,
          crashes: body.crashes ?? 0,
          max_combo: body.maxCombo ?? 1,
          input_log: body.inputLog,
          sim_version: String(body.simVersion),
          verify_status: "pending",
          finished: Boolean(body.finished),
        })
        .select("id")
        .single();
      if (insErr || !inserted) {
        req.log.error({ err: insErr }, "run insert failed");
        return reply.code(500).send({ error: "could not store run" });
      }
      const runId = inserted.id as number;

      // ── Load frozen track + verify (serial) ─────────────────────────────
      const { data: track } = await db
        .from("cr_tracks")
        .select("points, par_time_ms")
        .eq("id", body.trackId)
        .maybeSingle();
      if (!track) {
        await db
          .from("cr_runs")
          .update({ verify_status: "failed" })
          .eq("id", runId);
        return reply.code(404).send({ error: "track not found" });
      }

      const result = await runSerial(() =>
        Promise.resolve(
          verifyRun({
            points: track.points as TrackPoint[],
            parTimeMs: (track.par_time_ms as number | null) ?? undefined,
            inputLog: body.inputLog,
            client: {
              score: body.clientScore,
              flips: body.flips ?? 0,
              crashes: body.crashes ?? 0,
              finished: Boolean(body.finished),
              timeMs: body.timeMs,
            },
          }),
        ),
      );
      req.log.info(
        { runId, durationMs: result.durationMs, status: result.verifyStatus },
        "run verified",
      );

      const serverScore = result.server ? Math.round(result.server.score) : null;
      const serverFinished = result.server ? result.server.finished : Boolean(body.finished);
      await db
        .from("cr_runs")
        .update({
          verify_status: result.verifyStatus,
          server_score: serverScore,
          finished: serverFinished,
        })
        .eq("id", runId);

      // ── Ranks (only verified + finished earns a rank) ───────────────────
      let rankThisWindow: number | undefined;
      let rankAllTime: number | undefined;
      if (eligibleForRank(result.verifyStatus, serverFinished) && serverScore !== null) {
        rankThisWindow = await rankByScore(db, body.trackId, serverScore, windowId);
        rankAllTime = await rankByScore(db, body.trackId, serverScore, null);
      }

      return { verifyStatus: result.verifyStatus, serverScore, rankThisWindow, rankAllTime };
    },
  );
};
