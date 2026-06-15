import type { SupabaseClient } from "@supabase/supabase-js";
import type { FastifyPluginAsync } from "fastify";
import { requireAuth } from "../auth.js";
import { getDb } from "../db.js";
import { rankOfPlayer, topPerPlayer, type LeaderboardRun } from "../leaderboards.js";
import { createSupabaseRepo, rankPool } from "../payouts.js";
import { ensureOpenWindow, slotStartMs, WINDOW_MS } from "../windows.js";

const ID_PATTERN = "^[0-9]+$";
/** How many verified runs to pull before per-player dedupe (bounded fetch). */
const FETCH_LIMIT = 400;
/** Leaderboard depth. */
const TOP_N = 20;

interface RunRow {
  player_id: string;
  server_score: number | null;
  time_ms: number;
  flips: number;
  created_at: string;
  cr_players: { username: string } | null;
}

function toLeaderboardRuns(rows: RunRow[]): LeaderboardRun[] {
  return rows
    .filter((r) => r.server_score != null && r.cr_players)
    .map((r) => ({
      playerId: r.player_id,
      username: r.cr_players!.username,
      serverScore: Number(r.server_score),
      timeMs: r.time_ms,
      flips: r.flips,
      createdAt: r.created_at,
    }));
}

/** Verified + finished runs for a track (optionally one window), best scores first. */
async function fetchTrackRuns(
  db: SupabaseClient,
  trackId: number,
  windowId: number | null,
): Promise<LeaderboardRun[]> {
  let q = db
    .from("cr_runs")
    .select("player_id,server_score,time_ms,flips,created_at,cr_players(username)")
    .eq("track_id", trackId)
    .eq("verify_status", "verified")
    .eq("finished", true)
    .not("server_score", "is", null)
    .order("server_score", { ascending: false })
    .limit(FETCH_LIMIT);
  if (windowId !== null) q = q.eq("window_id", windowId);
  const { data, error } = await q;
  if (error) throw error;
  return toLeaderboardRuns((data ?? []) as unknown as RunRow[]);
}

/** Per-track leaderboards built from validated runs only (server_score). */
export const leaderboardsRoutes: FastifyPluginAsync = async (app) => {
  app.decorateRequest("player", null);

  // ── Main payout board (Home centrepiece) ────────────────────────────────
  // Top-20 paying tracks (reuse the P4.6 pool math) + each track's CURRENT
  // open-window leader + prize + label, plus the window ends_at for one
  // shared countdown.
  app.get("/payout-board", async (_req, reply) => {
    const db = getDb();
    const repo = createSupabaseRepo(db);
    let tiers;
    let poolTracks;
    try {
      [tiers, poolTracks] = await Promise.all([repo.fetchPayoutTiers(), repo.fetchPoolTracks()]);
    } catch (err) {
      app.log.error(err, "payout-board: pool fetch failed");
      return reply.code(500).send({ error: "database error" });
    }
    const pool = rankPool(poolTracks, tiers);
    const trackIds = pool.map((p) => p.trackId);

    const startMs = slotStartMs(Date.now());
    const startsAt = new Date(startMs).toISOString();
    const windowRes = await db
      .from("cr_payout_windows")
      .select("id, ends_at, status")
      .eq("starts_at", startsAt)
      .maybeSingle();
    const windowId =
      windowRes.data && windowRes.data.status === "open" ? (windowRes.data.id as number) : null;
    const endsAt = (windowRes.data?.ends_at as string) ?? new Date(startMs + WINDOW_MS).toISOString();

    // Current-window leader per pool track (one query, dedupe per track).
    const leaders = new Map<number, { username: string; score: number }>();
    if (windowId !== null && trackIds.length > 0) {
      const { data } = await db
        .from("cr_runs")
        .select("track_id,player_id,server_score,time_ms,flips,created_at,cr_players(username)")
        .eq("window_id", windowId)
        .eq("verify_status", "verified")
        .eq("finished", true)
        .not("server_score", "is", null)
        .in("track_id", trackIds)
        .order("server_score", { ascending: false })
        .limit(FETCH_LIMIT);
      const byTrack = new Map<number, RunRow[]>();
      for (const row of (data ?? []) as unknown as (RunRow & { track_id: number })[]) {
        const list = byTrack.get(row.track_id) ?? [];
        list.push(row);
        byTrack.set(row.track_id, list);
      }
      for (const [tid, rows] of byTrack) {
        const top = topPerPlayer(toLeaderboardRuns(rows), 1)[0];
        if (top) leaders.set(tid, { username: top.username, score: top.score });
      }
    }

    // Labels (coin/period/tier/mode).
    const metaRes = await db
      .from("cr_tracks")
      .select("id,tier,mode,cr_maps(symbol,period)")
      .in("id", trackIds.length ? trackIds : [-1]);
    const meta = new Map<number, { symbol: string; period: string; tier: string; mode: string }>();
    for (const m of (metaRes.data ?? []) as unknown as {
      id: number;
      tier: string;
      mode: string;
      cr_maps: { symbol: string; period: string } | null;
    }[]) {
      meta.set(m.id, {
        symbol: m.cr_maps?.symbol ?? "?",
        period: m.cr_maps?.period ?? "?",
        tier: m.tier,
        mode: m.mode,
      });
    }

    const tracks = pool.map((p) => {
      const m = meta.get(p.trackId);
      const label = m ? `${m.symbol} ${m.period} ${m.tier} · ${m.mode}` : `track ${p.trackId}`;
      return {
        rank: p.rank,
        trackId: p.trackId,
        prizeSol: p.prizeSol,
        symbol: m?.symbol ?? null,
        period: m?.period ?? null,
        tier: m?.tier ?? null,
        mode: m?.mode ?? null,
        label,
        leader: leaders.get(p.trackId) ?? null,
      };
    });

    return { endsAt, tracks };
  });

  // ── Global leaderboard for a track (window or all-time) ─────────────────
  app.get<{ Params: { trackId: string }; Querystring: { scope?: string } }>(
    "/:trackId/global",
    {
      schema: {
        params: {
          type: "object",
          required: ["trackId"],
          properties: { trackId: { type: "string", pattern: ID_PATTERN } },
        },
        querystring: { type: "object", properties: { scope: { enum: ["alltime", "window"] } } },
      },
    },
    async (req) => {
      const db = getDb();
      const trackId = Number(req.params.trackId);
      const windowId = req.query.scope === "window" ? await ensureOpenWindow(db) : null;
      if (req.query.scope === "window" && windowId === null) return [];
      const runs = await fetchTrackRuns(db, trackId, windowId);
      return topPerPlayer(runs, TOP_N);
    },
  );

  // ── The logged-in player's PBs on a track ───────────────────────────────
  app.get<{ Params: { trackId: string } }>(
    "/:trackId/me",
    {
      preHandler: requireAuth,
      schema: {
        params: {
          type: "object",
          required: ["trackId"],
          properties: { trackId: { type: "string", pattern: ID_PATTERN } },
        },
      },
    },
    async (req, reply) => {
      const player = req.player;
      if (!player) return reply.code(401).send({ error: "unauthorized" });
      const db = getDb();
      const trackId = Number(req.params.trackId);
      const runs = await fetchTrackRuns(db, trackId, null);

      const best = runs
        .filter((r) => r.playerId === player.playerId)
        .sort((a, b) => b.serverScore - a.serverScore || a.timeMs - b.timeMs)
        .slice(0, 5)
        .map((r, i) => ({
          rank: i + 1,
          score: r.serverScore,
          timeMs: r.timeMs,
          flips: r.flips,
          createdAt: r.createdAt,
        }));

      return { allTimeRank: rankOfPlayer(runs, player.playerId), best };
    },
  );
};
