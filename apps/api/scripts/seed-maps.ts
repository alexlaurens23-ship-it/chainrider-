/**
 * Seeds the launch map set through the running API's admin endpoint
 * (single code path: fetch + generation + storage all happen server-side).
 *
 * Usage:  npm run seed -w @chainrider/api
 * Env:    ADMIN_KEY (required), API_URL (default http://localhost:8787)
 *
 * Idempotent: a 409 (slug exists) is treated as already-seeded and skipped.
 */
import "dotenv/config";

interface SeedMap {
  slug: string;
  symbol: string;
  name: string;
  source: "coingecko" | "geckoterminal";
  source_id: string;
  period: "90D" | "180D" | "1Y" | "ALL";
}

const SEED_MAPS: SeedMap[] = [
  { slug: "btc-1y", symbol: "BTC", name: "Bitcoin 1Y", source: "coingecko", source_id: "bitcoin", period: "1Y" },
  { slug: "btc-all", symbol: "BTC", name: "Bitcoin All-Time", source: "coingecko", source_id: "bitcoin", period: "ALL" },
  { slug: "eth-1y", symbol: "ETH", name: "Ethereum 1Y", source: "coingecko", source_id: "ethereum", period: "1Y" },
  { slug: "eth-all", symbol: "ETH", name: "Ethereum All-Time", source: "coingecko", source_id: "ethereum", period: "ALL" },
  { slug: "sol-1y", symbol: "SOL", name: "Solana 1Y", source: "coingecko", source_id: "solana", period: "1Y" },
  { slug: "sol-all", symbol: "SOL", name: "Solana All-Time", source: "coingecko", source_id: "solana", period: "ALL" },
  // ── Memecoin maps (GeckoTerminal pools) ─────────────────────────────────
  // TODO(owner): paste the pool address and uncomment. source_id format is
  // "{network}:{poolAddress}" — find the pool on geckoterminal.com.
  // NOTE: the live cr_maps period check only allows 1Y/ALL today; run the
  // period-widening statement in sql/001_track_pipeline.sql before seeding
  // 90D maps.
  // { slug: "meme1-90d", symbol: "MEME1", name: "Memecoin One 90D", source: "geckoterminal", source_id: "solana:<POOL_ADDRESS>", period: "90D" },
  // { slug: "meme2-90d", symbol: "MEME2", name: "Memecoin Two 90D", source: "geckoterminal", source_id: "solana:<POOL_ADDRESS>", period: "90D" },
];

/** CoinGecko free tier is ~5-15 req/min; each map costs one upstream call. */
const DELAY_BETWEEN_MAPS_MS = 15_000;

const API_URL = process.env.API_URL ?? "http://localhost:8787";
const ADMIN_KEY = process.env.ADMIN_KEY;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  if (!ADMIN_KEY) {
    console.error("ADMIN_KEY is not set (apps/api/.env). Aborting.");
    process.exit(1);
  }

  let failures = 0;
  for (let i = 0; i < SEED_MAPS.length; i++) {
    const map = SEED_MAPS[i];
    if (i > 0) await sleep(DELAY_BETWEEN_MAPS_MS);

    console.log(`[${i + 1}/${SEED_MAPS.length}] creating ${map.slug} ...`);
    try {
      const res = await fetch(`${API_URL}/api/admin/maps`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-key": ADMIN_KEY },
        body: JSON.stringify(map),
      });
      if (res.status === 409) {
        console.log(`  ${map.slug}: already seeded, skipping`);
        continue;
      }
      const body = (await res.json()) as {
        error?: string;
        candleCount?: number;
        map?: { difficulty?: string };
        tracks?: { raw?: { stats?: { worldLength?: number; maxSlopeDeg?: number } } };
      };
      if (!res.ok) {
        failures++;
        console.error(`  ${map.slug}: HTTP ${res.status} — ${body.error ?? "unknown error"}`);
        continue;
      }
      const s = body.tracks?.raw?.stats;
      console.log(
        `  ${map.slug}: ok — ${body.candleCount} candles, ${s?.worldLength}m, ` +
          `maxSlope ${s?.maxSlopeDeg}°, difficulty ${body.map?.difficulty}`,
      );
    } catch (err) {
      failures++;
      console.error(`  ${map.slug}: request failed — ${String(err)}`);
    }
  }

  if (failures > 0) {
    console.error(`Done with ${failures} failure(s).`);
    process.exit(1);
  }
  console.log("Done. All maps seeded.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
