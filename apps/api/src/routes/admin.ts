import type { FastifyPluginAsync } from "fastify";
import { ChartFetchError, fetchCloses, type ChartSource, type Period } from "../chartdata.js";
import { getDb } from "../db.js";
import {
  downsample,
  normalize,
  rawTrack,
  smoothTrack,
  stats,
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

interface GeneratedMode {
  points: TrackPoint[];
  stats: TrackStats;
}

interface Generated {
  raw: GeneratedMode;
  smooth: GeneratedMode;
  candleCount: number;
}

/** Fetches fresh closes and generates both modes. Throws ChartFetchError / Error. */
async function generateTracks(
  source: ChartSource,
  sourceId: string,
  period: Period,
): Promise<Generated> {
  const candles = await fetchCloses(source, sourceId, period);
  let closes = candles.map((c) => c.close);
  // ALL-period history is stride-capped so tracks stay a playable length;
  // shorter periods ride every daily candle.
  if (period === "ALL") closes = downsample(closes);
  const points = normalize(closes); // throws on <10 or invalid closes -> 422
  const raw = rawTrack(points);
  const smooth = smoothTrack(points);
  return {
    raw: { points: raw, stats: stats(raw) },
    smooth: { points: smooth, stats: stats(smooth) },
    candleCount: candles.length,
  };
}

/** cr_tracks stores stats as flat columns (live Supabase schema). */
function trackInsertRow(mapId: number, mode: "raw" | "smooth", version: number, gen: GeneratedMode) {
  return {
    map_id: mapId,
    mode,
    version,
    points: gen.points,
    point_count: gen.stats.pointCount,
    world_length: gen.stats.worldLength,
    max_slope_deg: gen.stats.maxSlopeDeg,
    volatility: gen.stats.volatility,
  };
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
            period: { enum: ["90D", "180D", "1Y", "ALL"] },
          },
        },
      },
    },
    async (req, reply) => {
      const body = req.body;

      let generated: Generated;
      try {
        generated = await generateTracks(body.source, body.source_id, body.period);
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
          difficulty: generated.raw.stats.difficulty, // difficulty comes from the raw track
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
        .insert([
          trackInsertRow(map.id, "raw", 1, generated.raw),
          trackInsertRow(map.id, "smooth", 1, generated.smooth),
        ])
        .select("id,mode,version");
      if (tracksRes.error) {
        // supabase-js has no transactions: compensating delete keeps cr_maps
        // consistent (the new map has no other references yet).
        await db.from("cr_maps").delete().eq("id", map.id);
        app.log.error(tracksRes.error, "cr_tracks insert failed");
        return reply.code(500).send({ error: "database error" });
      }

      const byMode = (mode: "raw" | "smooth") => {
        const t = tracksRes.data.find((row) => row.mode === mode);
        return t ? { id: t.id, version: t.version, stats: generated[mode].stats } : null;
      };
      return reply.code(201).send({
        map,
        candleCount: generated.candleCount,
        tracks: { raw: byMode("raw"), smooth: byMode("smooth") },
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
        generated = await generateTracks(
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
        .insert([
          trackInsertRow(map.id, "raw", nextVersion, generated.raw),
          trackInsertRow(map.id, "smooth", nextVersion, generated.smooth),
        ])
        .select("id,mode,version");
      if (insertRes.error) {
        app.log.error(insertRes.error, "cr_tracks insert failed");
        return reply.code(500).send({ error: "database error" });
      }

      const updateMapRes = await db
        .from("cr_maps")
        .update({ difficulty: generated.raw.stats.difficulty })
        .eq("id", map.id);
      if (updateMapRes.error) {
        app.log.error(updateMapRes.error, "cr_maps difficulty update failed");
        return reply.code(500).send({ error: "database error" });
      }

      const byMode = (mode: "raw" | "smooth") => {
        const t = insertRes.data.find((row) => row.mode === mode);
        return t ? { id: t.id, version: t.version, stats: generated[mode].stats } : null;
      };
      return {
        mapId: map.id,
        version: nextVersion,
        difficulty: generated.raw.stats.difficulty,
        candleCount: generated.candleCount,
        tracks: { raw: byMode("raw"), smooth: byMode("smooth") },
      };
    },
  );
};
