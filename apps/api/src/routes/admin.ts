import { SCORING_CONFIG } from "@chainrider/physics";
import type { FastifyPluginAsync } from "fastify";
import { ChartFetchError, fetchCloses, type ChartSource, type Period } from "../chartdata.js";
import { getDb } from "../db.js";
import {
  PERIOD_AMPLITUDE,
  TIERS,
  generateTier,
  rawTrack,
  smoothTrack,
  stats,
  type Tier,
  type TrackPoint,
  type TrackStats,
} from "../trackgen.js";

const ID_PATTERN = "^[0-9]+$";

interface CreateMapBody {
  slug: string;
  symbol: string;
  name: string;
  source: ChartSource;
  source_id: string;
  period: Period;
}

interface GeneratedTrack {
  tier: Tier;
  mode: "raw" | "smooth";
  points: TrackPoint[];
  stats: TrackStats;
  parTimeMs: number;
}

interface Generated {
  tracks: GeneratedTrack[];
  candleCount: number;
}

/**
 * Fetches fresh closes and generates all 3 tiers × 2 modes (6 frozen tracks).
 * Each tier has a more amplified/rougher terrain and a slower assumed fair
 * pace → par. Throws ChartFetchError (fetch) / Error (bad data → 422).
 */
async function generateAllTiers(
  source: ChartSource,
  sourceId: string,
  period: Period,
): Promise<Generated> {
  const candles = await fetchCloses(source, sourceId, period);
  const closes = candles.map((c) => c.close);
  // Shorter periods get an extra amplitude bump → more dramatic terrain.
  const periodAmp = PERIOD_AMPLITUDE[period] ?? 1;

  const tracks: GeneratedTrack[] = [];
  for (const tier of TIERS) {
    const tierRaw = generateTier(closes, tier, periodAmp); // throws on <10 / invalid closes -> 422
    const pace = SCORING_CONFIG.parPaceMps[tier];
    for (const mode of ["raw", "smooth"] as const) {
      const points = mode === "raw" ? rawTrack(tierRaw) : smoothTrack(tierRaw);
      const s = stats(points);
      tracks.push({ tier, mode, points, stats: s, parTimeMs: Math.round((s.worldLength / pace) * 1000) });
    }
  }
  return { tracks, candleCount: candles.length };
}

/** cr_tracks row (flat stats columns + tier + par on the live schema). */
function trackInsertRow(mapId: number, version: number, gt: GeneratedTrack) {
  return {
    map_id: mapId,
    tier: gt.tier,
    mode: gt.mode,
    version,
    points: gt.points,
    point_count: gt.stats.pointCount,
    world_length: gt.stats.worldLength,
    max_slope_deg: gt.stats.maxSlopeDeg,
    volatility: gt.stats.volatility,
    difficulty_score: gt.stats.difficultyScore,
    par_time_ms: gt.parTimeMs,
  };
}

/** Summarize generated tiers for the API response (no heavy points). */
function summarize(tracks: GeneratedTrack[]) {
  const out: Record<string, unknown> = {};
  for (const tier of TIERS) {
    const raw = tracks.find((t) => t.tier === tier && t.mode === "raw");
    const smooth = tracks.find((t) => t.tier === tier && t.mode === "smooth");
    out[tier] = {
      raw: raw ? { stats: raw.stats, parTimeMs: raw.parTimeMs } : null,
      smooth: smooth ? { stats: smooth.stats, parTimeMs: smooth.parTimeMs } : null,
    };
  }
  return out;
}

/** Owner admin panel (X-Admin-Key gated): map creation + track regeneration. */
export const adminRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("onRequest", async (req, reply) => {
    const key = process.env.ADMIN_KEY;
    // Fail closed: an unset ADMIN_KEY rejects everything.
    if (!key || req.headers["x-admin-key"] !== key) {
      return reply.code(401).send({ error: "unauthorized" });
    }
  });

  app.post<{ Body: CreateMapBody }>(
    "/maps",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["slug", "symbol", "name", "source", "source_id", "period"],
          properties: {
            slug: { type: "string", pattern: "^[a-z0-9][a-z0-9-]*$", maxLength: 64 },
            symbol: { type: "string", minLength: 1, maxLength: 16 },
            name: { type: "string", minLength: 1, maxLength: 80 },
            source: { enum: ["coingecko", "geckoterminal"] },
            source_id: { type: "string", minLength: 1, maxLength: 128 },
            period: { enum: ["1Y", "6M", "3M"] },
          },
        },
      },
    },
    async (req, reply) => {
      const body = req.body;

      let generated: Generated;
      try {
        generated = await generateAllTiers(body.source, body.source_id, body.period);
      } catch (err) {
        if (err instanceof ChartFetchError) {
          return reply.code(502).send({ error: err.message, status: err.status ?? null });
        }
        return reply.code(422).send({ error: (err as Error).message });
      }

      const db = getDb();
      const mapRes = await db
        .from("cr_maps")
        .insert({
          slug: body.slug,
          symbol: body.symbol,
          name: body.name,
          source: body.source,
          source_id: body.source_id,
          period: body.period,
        })
        .select()
        .single();
      if (mapRes.error) {
        if (mapRes.error.code === "23505") {
          return reply.code(409).send({ error: `slug "${body.slug}" already exists` });
        }
        app.log.error(mapRes.error, "cr_maps insert failed");
        return reply.code(500).send({ error: "database error" });
      }
      const map = mapRes.data;

      const tracksRes = await db
        .from("cr_tracks")
        .insert(generated.tracks.map((gt) => trackInsertRow(map.id, 1, gt)))
        .select("id,tier,mode,version");
      if (tracksRes.error) {
        // supabase-js has no transactions: compensating delete keeps cr_maps
        // consistent (the new map has no other references yet).
        await db.from("cr_maps").delete().eq("id", map.id);
        app.log.error(tracksRes.error, "cr_tracks insert failed");
        return reply.code(500).send({ error: "database error" });
      }

      return reply.code(201).send({
        map,
        candleCount: generated.candleCount,
        trackCount: tracksRes.data.length,
        tiers: summarize(generated.tracks),
      });
    },
  );

  app.post<{ Params: { id: string } }>(
    "/maps/:id/regenerate",
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
      const mapRes = await db.from("cr_maps").select().eq("id", req.params.id).maybeSingle();
      if (mapRes.error) {
        app.log.error(mapRes.error, "cr_maps fetch failed");
        return reply.code(500).send({ error: "database error" });
      }
      if (!mapRes.data) return reply.code(404).send({ error: "map not found" });
      const map = mapRes.data;

      let generated: Generated;
      try {
        generated = await generateAllTiers(
          map.source as ChartSource,
          map.source_id as string,
          map.period as Period,
        );
      } catch (err) {
        if (err instanceof ChartFetchError) {
          return reply.code(502).send({ error: err.message, status: err.status ?? null });
        }
        return reply.code(422).send({ error: (err as Error).message });
      }

      const versionRes = await db
        .from("cr_tracks")
        .select("version")
        .eq("map_id", map.id)
        .order("version", { ascending: false })
        .limit(1);
      if (versionRes.error) {
        app.log.error(versionRes.error, "cr_tracks version query failed");
        return reply.code(500).send({ error: "database error" });
      }
      const nextVersion = (versionRes.data[0]?.version ?? 0) + 1;

      // Old versions are NEVER mutated beyond this flag flip and never deleted:
      // existing leaderboards reference them.
      const deactivateRes = await db
        .from("cr_tracks")
        .update({ active: false })
        .eq("map_id", map.id)
        .eq("active", true);
      if (deactivateRes.error) {
        app.log.error(deactivateRes.error, "cr_tracks deactivate failed");
        return reply.code(500).send({ error: "database error" });
      }

      const insertRes = await db
        .from("cr_tracks")
        .insert(generated.tracks.map((gt) => trackInsertRow(map.id, nextVersion, gt)))
        .select("id,tier,mode,version");
      if (insertRes.error) {
        app.log.error(insertRes.error, "cr_tracks insert failed");
        return reply.code(500).send({ error: "database error" });
      }

      return {
        mapId: map.id,
        version: nextVersion,
        candleCount: generated.candleCount,
        trackCount: insertRes.data.length,
        tiers: summarize(generated.tracks),
      };
    },
  );
};
