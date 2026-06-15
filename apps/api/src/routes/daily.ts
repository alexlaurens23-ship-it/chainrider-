import type { TrackPoint } from "@chainrider/physics";
import type { FastifyPluginAsync } from "fastify";
import { dailyPrizeSol } from "../daily.js";
import { getDb } from "../db.js";
import { topPerPlayer, type LeaderboardRun } from "../leaderboards.js";

/**
 * Public daily-challenge endpoint (no auth). Returns today's open challenge: its
 * track (label + points for the Home sparkline), the prize, the day's end, and
 * the current top-5 verified+finished scores within the day's window.
 */
export const dailyRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (_req, reply) => {
    const db = getDb();

    const { data: daily, error: dErr } = await db
      .from("cr_daily_challenges")
      .select("id,track_id,challenge_date,starts_at,ends_at,status")
      .eq("status", "open")
      .order("challenge_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (dErr) {
      app.log.error(dErr, "daily: challenge query failed");
      return reply.code(500).send({ error: "database error" });
    }
    const prizeSol = await dailyPrizeSol(db);
    if (!daily) {
      // None open yet (engine hasn't run) — render a graceful empty state.
      return { date: null, trackId: null, label: null, points: [], prizeSol, endsAt: null, top5: [] };
    }

    const { data: track } = await db
      .from("cr_tracks")
      .select("points,tier,mode,cr_maps(symbol,period)")
      .eq("id", daily.track_id)
      .maybeSingle();
    const t = track as unknown as {
      points: TrackPoint[];
      tier: string;
      mode: string;
      cr_maps: { symbol: string; period: string } | null;
    } | null;
    const label = t
      ? `${t.cr_maps?.symbol ?? "?"} ${t.cr_maps?.period ?? "?"} ${t.tier} · ${t.mode}`
      : "track";

    // Today's verified + finished runs on the track, within the day's window.
    const { data: runRows } = await db
      .from("cr_runs")
      .select("player_id,server_score,time_ms,flips,created_at,cr_players(username)")
      .eq("track_id", daily.track_id)
      .eq("verify_status", "verified")
      .eq("finished", true)
      .not("server_score", "is", null)
      .gte("created_at", daily.starts_at)
      .lt("created_at", daily.ends_at)
      .order("server_score", { ascending: false })
      .limit(400);
    const runs: LeaderboardRun[] = ((runRows ?? []) as unknown as {
      player_id: string;
      server_score: number | null;
      time_ms: number;
      flips: number;
      created_at: string;
      cr_players: { username: string } | null;
    }[])
      .filter((r) => r.server_score != null && r.cr_players)
      .map((r) => ({
        playerId: r.player_id,
        username: r.cr_players!.username,
        serverScore: Number(r.server_score),
        timeMs: r.time_ms,
        flips: r.flips,
        createdAt: r.created_at,
      }));

    return {
      date: daily.challenge_date,
      trackId: daily.track_id,
      label,
      points: t?.points ?? [],
      prizeSol,
      endsAt: daily.ends_at,
      top5: topPerPlayer(runs, 5),
    };
  });
};
