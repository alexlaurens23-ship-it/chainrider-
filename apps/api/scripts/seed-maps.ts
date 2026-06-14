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

type Period = "1Y" | "6M" | "3M";

interface SeedMap {
  slug: string;
  symbol: string;
  name: string;
  source: "coingecko" | "geckoterminal";
  source_id: string;
  period: Period;
}

// Launch set: 6 coins (4 majors + POPCAT/BONK, both data-validated for sustained
// rolling volatility across all 3 windows) × 3 periods (1Y/6M/3M). Each map
// generates 3 tiers × 2 modes = 6 frozen tracks → 6×3×6 = 108 tracks total.
const COINS: { symbol: string; name: string; id: string }[] = [
  { symbol: "BTC", name: "Bitcoin", id: "bitcoin" },
  { symbol: "ETH", name: "Ethereum", id: "ethereum" },
  { symbol: "SOL", name: "Solana", id: "solana" },
  { symbol: "DOGE", name: "Dogecoin", id: "dogecoin" },
  { symbol: "POPCAT", name: "Popcat", id: "popcat" },
  { symbol: "BONK", name: "Bonk", id: "bonk" },
];
const PERIODS: Period[] = ["1Y", "6M", "3M"];

const SEED_MAPS: SeedMap[] = COINS.flatMap((c) =>
  PERIODS.map((period) => ({
    slug: `${c.symbol.toLowerCase()}-${period.toLowerCase()}`,
    symbol: c.symbol,
    name: `${c.name} ${period}`,
    source: "coingecko" as const,
    source_id: c.id,
    period,
  })),
);

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
