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

// Launch set: 4 coins at 1Y. Each map generates 3 tiers × 2 modes = 6 frozen
// tracks server-side (→ 24 tracks total). DOGE is intentionally included as an
// idiosyncratic, BTC-uncorrelated coin → genuinely different terrain shape.
const SEED_MAPS: SeedMap[] = [
  { slug: "btc-1y", symbol: "BTC", name: "Bitcoin 1Y", source: "coingecko", source_id: "bitcoin", period: "1Y" },
  { slug: "eth-1y", symbol: "ETH", name: "Ethereum 1Y", source: "coingecko", source_id: "ethereum", period: "1Y" },
  { slug: "sol-1y", symbol: "SOL", name: "Solana 1Y", source: "coingecko", source_id: "solana", period: "1Y" },
  { slug: "doge-1y", symbol: "DOGE", name: "Dogecoin 1Y", source: "coingecko", source_id: "dogecoin", period: "1Y" },
  // ── Memecoin maps (GeckoTerminal pools) ─────────────────────────────────
  // TODO(owner): paste the pool address and uncomment. source_id format is
  // "{network}:{poolAddress}". Requires widening the cr_maps period check to 90D.
  // { slug: "meme1-90d", symbol: "MEME1", name: "Memecoin One 90D", source: "geckoterminal", source_id: "solana:<POOL_ADDRESS>", period: "90D" },
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
      type TierStats = { raw?: { stats?: { maxSlopeDeg?: number }; parTimeMs?: number } };
      const body = (await res.json()) as {
        error?: string;
        candleCount?: number;
        trackCount?: number;
        tiers?: Record<string, TierStats>;
      };
      if (!res.ok) {
        failures++;
        console.error(`  ${map.slug}: HTTP ${res.status} — ${body.error ?? "unknown error"}`);
        continue;
      }
      const slope = (t: string) => body.tiers?.[t]?.raw?.stats?.maxSlopeDeg;
      console.log(
        `  ${map.slug}: ok — ${body.candleCount} candles, ${body.trackCount} tracks; ` +
          `maxSlope CHILL ${slope("CHILL")}° / VOLATILE ${slope("VOLATILE")}° / DEGEN ${slope("DEGEN")}°`,
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
