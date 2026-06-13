import type { FastifyPluginAsync } from "fastify";
import { getDb } from "../db.js";
import { TIERS, difficultyFor, type Tier } from "../trackgen.js";

const ID_PATTERN = "^[0-9]+$";

/** The tier whose stats back the legacy `difficulty`/`tracks` fields. */
const LEGACY_TIER: Tier = "VOLATILE";

interface MapRow {
  id: number;
  slug: string;
  symbol: string;
  name: string;
  source: string;
  period: string;
}

interface TrackSummaryRow {
  id: number;
  map_id: number;
  tier: Tier;
  mode: "raw" | "smooth";
  version: number;
  point_count: number;
  world_length: number;
  max_slope_deg: number;
  volatility: number;
  par_time_ms: number | null;
}

function trackSummary(t: TrackSummaryRow) {
  return {
    trackId: t.id,
    version: t.version,
    parTimeMs: t.par_time_ms,
    stats: {
      worldLength: t.world_length,
      maxSlopeDeg: t.max_slope_deg,
      volatility: t.volatility,
      difficulty: difficultyFor(t.max_slope_deg),
      pointCount: t.point_count,
    },
  };
}

/**
 * GET /api/maps — active maps with all three difficulty tiers (each tier's
 * raw+smooth stats + prize). Also keeps legacy `difficulty`/`tracks` fields
 * (backed by the VOLATILE tier) so the pre-tier frontend keeps working until
 * the tier-selection UI lands.
 */
export const mapsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (_req, reply) => {
    const db = getDb();

    const mapsRes = await db
      .from("cr_maps")
      .select("id,slug,symbol,name,source,period")
      .eq("active", true)
      .order("created_at", { ascending: true });
    if (mapsRes.error) {
      app.log.error(mapsRes.error, "cr_maps query failed");
      return reply.code(500).send({ error: "database error" });
    }
    const maps = (mapsRes.data ?? []) as MapRow[];

    let tracks: TrackSummaryRow[] = [];
    if (maps.length > 0) {
      // points intentionally excluded — heavy; clients fetch /api/tracks/:id to play.
      const tracksRes = await db
        .from("cr_tracks")
        .select(
          "id,map_id,tier,mode,version,point_count,world_length,max_slope_deg,volatility,par_time_ms",
        )
        .eq("active", true)
        .in(
          "map_id",
          maps.map((m) => m.id),
        );
      if (tracksRes.error) {
        app.log.error(tracksRes.error, "cr_tracks query failed");
        return reply.code(500).send({ error: "database error" });
      }
      tracks = (tracksRes.data ?? []) as TrackSummaryRow[];
    }

    const cfgRes = await db.from("cr_config").select("value").eq("key", "prize_ladder").maybeSingle();
    if (cfgRes.error) {
      app.log.error(cfgRes.error, "cr_config query failed");
      return reply.code(500).send({ error: "database error" });
    }
    const prizeLadder = (cfgRes.data?.value ?? null) as Record<string, number[]> | null;

    return {
      maps: maps.map((m) => {
        const pick = (tier: Tier, mode: "raw" | "smooth") =>
          tracks.find((t) => t.map_id === m.id && t.tier === tier && t.mode === mode);

        const tiers: Record<string, unknown> = {};
        for (const tier of TIERS) {
          const raw = pick(tier, "raw");
          const smooth = pick(tier, "smooth");
          tiers[tier] = {
            prize: prizeLadder?.[tier] ?? null,
            raw: raw ? trackSummary(raw) : null,
            smooth: smooth ? trackSummary(smooth) : null,
          };
        }

        // Legacy fields (pre-tier UI): back them with the VOLATILE tier.
        const legacyRaw = pick(LEGACY_TIER, "raw");
        const legacySmooth = pick(LEGACY_TIER, "smooth");
        return {
          ...m,
          difficulty: legacyRaw ? difficultyFor(legacyRaw.max_slope_deg) : "insane",
          tracks: {
            raw: legacyRaw ? trackSummary(legacyRaw) : null,
            smooth: legacySmooth ? trackSummary(legacySmooth) : null,
          },
          tiers,
        };
      }),
      prizeLadder,
    };
  });
};

/** GET /api/tracks/:id — the frozen points for play (served even if inactive). */
export const tracksRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { id: string } }>(
    "/:id",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", pattern: ID_PATTERN } },
        },
      },
    },
    async (req, reply) => {
      const db = getDb();
      const res = await db
        .from("cr_tracks")
        .select(
          "id,map_id,tier,mode,version,points,point_count,world_length,max_slope_deg,volatility,par_time_ms,active,created_at,cr_maps(slug,name)",
        )
        .eq("id", req.params.id)
        .maybeSingle();
      if (res.error) {
        app.log.error(res.error, "cr_tracks fetch failed");
        return reply.code(500).send({ error: "database error" });
      }
      // Inactive (superseded) versions stay servable: old leaderboard runs
      // reference them and replays must load the exact frozen points.
      if (!res.data) return reply.code(404).send({ error: "track not found" });
      return res.data;
    },
  );
};
