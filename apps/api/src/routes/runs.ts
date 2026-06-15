import { SIM_VERSION } from "@chainrider/physics";
import type { InputLogEntry, TrackPoint } from "@chainrider/physics";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FastifyPluginAsync } from "fastify";
import { requireAuth } from "../auth.js";
import { getDb } from "../db.js";
import { MAX_RIDE_TICKS, eligibleForRank, maxReasonableScore, verifyRun } from "../runVerify.js";
import { ensureOpenWindow } from "../windows.js";

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
/**
 * Max submissions doing verify work at once (M4). The per-run cost is already
 * bounded by MAX_REPLAY_TICKS and isn't attacker-inflatable, so the real DoS
 * vector is queue depth — shed load with 503 past this.
 */
const MAX_VERIFY_INFLIGHT = 25;
/** Per-run wall-clock budget (M4). An over-budget replay is failed, never awarded. */
const VERIFY_BUDGET_MS = 2000;

// In-memory rate-limit (spec: in-memory map is fine; resets on restart).
const lastSubmitMs = new Map<string, number>();
// Submissions currently holding a verify slot (bounded queue, M4).
let verifyInFlight = 0;

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

  // ── Public replay source ────────────────────────────────────────────────
  // Replays are shareable proof (no auth) — return the stored input log + the
  // track id; the client fetches frozen points via /tracks/:id and re-sims it
  // read-only. Never exposes anything sensitive.
  app.get<{ Params: { runId: string } }>(
    "/:runId/replay",
    {
      schema: {
        params: {
          type: "object",
          required: ["runId"],
          properties: { runId: { type: "string", pattern: "^[0-9]+$" } },
        },
      },
    },
    async (req, reply) => {
      const db = getDb();
      const { data, error } = await db
        .from("cr_runs")
        .select(
          "track_id,input_log,server_score,verify_status,time_ms,cr_players(username),cr_tracks(tier,mode,cr_maps(symbol,period))",
        )
        .eq("id", Number(req.params.runId))
        .maybeSingle();
      if (error) {
        req.log.error(error, "replay query failed");
        return reply.code(500).send({ error: "database error" });
      }
      if (!data) return reply.code(404).send({ error: "run not found" });
      const row = data as unknown as {
        track_id: number;
        input_log: InputLogEntry[];
        server_score: number | null;
        verify_status: string;
        time_ms: number;
        cr_players: { username: string } | null;
        cr_tracks: {
          tier: string;
          mode: string;
          cr_maps: { symbol: string; period: string } | null;
        } | null;
      };
      const t = row.cr_tracks;
      const label = t
        ? `${t.cr_maps?.symbol ?? "?"} ${t.cr_maps?.period ?? "?"} ${t.tier} · ${t.mode}`
        : "track";
      return {
        trackId: row.track_id,
        inputLog: row.input_log ?? [],
        username: row.cr_players?.username ?? "—",
        label,
        serverScore: row.server_score,
        verifyStatus: row.verify_status,
        timeMs: row.time_ms,
      };
    },
  );

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
      // The replay runs EXACTLY body.ticks steps (Bug A) — validate it's sane first.
      if (!Number.isInteger(body.ticks) || body.ticks <= 0 || body.ticks > MAX_RIDE_TICKS) {
        return reply.code(400).send({ error: "invalid tick count" });
      }
      const now = Date.now();
      const last = lastSubmitMs.get(player.playerId) ?? 0;
      if (now - last < RATE_LIMIT_MS) {
        return reply.code(429).send({ error: "slow down" });
      }
      lastSubmitMs.set(player.playerId, now);

      // ── Shed load if the verify queue is saturated (M4) ─────────────────
      if (verifyInFlight >= MAX_VERIFY_INFLIGHT) {
        return reply.code(503).send({ error: "verification busy — retry shortly" });
      }

      // ── Load the FROZEN track; only ACTIVE versions accept runs (M7) ────
      const { data: track } = await db
        .from("cr_tracks")
        .select("points, par_time_ms, world_length, active")
        .eq("id", body.trackId)
        .maybeSingle();
      if (!track) return reply.code(404).send({ error: "track not found" });
      if (!track.active) return reply.code(409).send({ error: "track version is not active" });
      const parTimeMs = (track.par_time_ms as number | null) ?? undefined;
      const ceiling = maxReasonableScore({
        parTimeMs,
        worldLength: Number(track.world_length) || 0,
      });

      // Reserve a verify slot for the remainder of this submission (M4).
      verifyInFlight += 1;
      try {
        // ── Bucket into the open window + insert as pending ───────────────
        const windowId = await ensureOpenWindow(db);
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

        // ── Verify (serial queue) — replay only proves a real ride; the
        // CLIENT's score is trusted (cross-engine float makes the server's
        // replayed score unusable). Manual replay review gates payouts.
        const clientScore = Math.round(body.clientScore);
        const clientFinished = Boolean(body.finished);
        const result = await runSerial(() =>
          Promise.resolve(
            verifyRun({
              points: track.points as TrackPoint[],
              parTimeMs,
              worldLength: Number(track.world_length) || 0,
              inputLog: body.inputLog,
              submittedTicks: body.ticks,
              client: {
                score: clientScore,
                flips: body.flips ?? 0,
                finished: clientFinished,
                timeMs: Math.round(body.timeMs),
              },
              maxScore: ceiling,
            }),
          ),
        );

        // Per-run budget (M4): a replay that blew the time budget is never
        // awarded — fail it (and surface the anomaly).
        let verifyStatus = result.verifyStatus;
        if (result.durationMs > VERIFY_BUDGET_MS) {
          req.log.warn(
            { runId, durationMs: result.durationMs },
            "verify exceeded time budget — failing run",
          );
          verifyStatus = "failed";
        }
        req.log.info(
          { runId, durationMs: result.durationMs, progressM: result.progressMeters, status: verifyStatus },
          "run verified",
        );

        // The client's reported values are official — the numbers that rank/pay
        // and display. server_score holds the official score (kept as the column
        // all downstream — ranking, leaderboards, payouts — already reads). A
        // failed run earns no score.
        const officialScore = verifyStatus === "failed" ? null : clientScore;
        const update: Record<string, unknown> = {
          verify_status: verifyStatus,
          server_score: officialScore,
          finished: clientFinished,
          flips: body.flips ?? 0,
          crashes: body.crashes ?? 0,
        };
        const { error: updErr } = await db.from("cr_runs").update(update).eq("id", runId);
        if (updErr) {
          // Never swallow this: a rejected write leaves the run stuck 'pending'
          // while the client was told its real status (e.g. a stale
          // cr_runs_verify_status_check constraint — see sql/009).
          req.log.error(
            { runId, status: verifyStatus, updErr },
            "run status write FAILED — run left pending; check cr_runs status CHECK constraint (sql/009)",
          );
        }

        // ── Ranks (only verified + finished earns a rank) ─────────────────
        let rankThisWindow: number | undefined;
        let rankAllTime: number | undefined;
        if (eligibleForRank(verifyStatus, clientFinished) && officialScore !== null) {
          rankThisWindow = await rankByScore(db, body.trackId, officialScore, windowId);
          rankAllTime = await rankByScore(db, body.trackId, officialScore, null);
        }

        return { verifyStatus, serverScore: officialScore, rankThisWindow, rankAllTime };
      } finally {
        verifyInFlight -= 1;
      }
    },
  );
};
