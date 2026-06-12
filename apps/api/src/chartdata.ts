/**
 * External chart-data fetchers. This is the ONLY module that calls external
 * APIs — trackgen.ts must stay pure.
 */

export type ChartSource = "coingecko" | "geckoterminal";
/** Uppercase to match the live cr_maps period check constraint. */
export type Period = "90D" | "180D" | "1Y" | "ALL";

/** One daily candle close; t is the sample timestamp in ms UTC. */
export interface Candle {
  t: number;
  close: number;
}

export class ChartFetchError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ChartFetchError";
  }
}

const MAX_RETRIES = 3;
const ATTEMPT_TIMEOUT_MS = 15_000;
const MS_PER_DAY = 86_400_000;

const PERIOD_TO_COINGECKO_DAYS: Record<Period, string> = {
  "90D": "90",
  "180D": "180",
  "1Y": "365",
  ALL: "max",
};

const PERIOD_TO_CANDLE_LIMIT: Record<Period, number> = {
  "90D": 90,
  "180D": 180,
  "1Y": 365,
  ALL: 1000, // GeckoTerminal API max
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * GET + JSON with up to 3 retries on 429/5xx/network errors, exponential
 * backoff 1s -> 2s -> 4s (a 429 Retry-After header overrides, capped at 30s).
 */
async function fetchJsonWithRetry(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  let lastError: ChartFetchError | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await sleep(lastError?.status === 429 ? retryAfterMs(lastError) : 1000 * 2 ** (attempt - 1));
    }
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { accept: "application/json", ...headers },
        signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
      });
    } catch (err) {
      lastError = new ChartFetchError(`network error fetching ${url}: ${String(err)}`);
      continue;
    }
    if (response.ok) {
      return response.json();
    }
    const error = new ChartFetchError(`${url} responded ${response.status}`, response.status);
    if (response.status === 429 || response.status >= 500) {
      const retryAfter = response.headers.get("retry-after");
      if (retryAfter) (error as { retryAfterSec?: number }).retryAfterSec = Number(retryAfter);
      lastError = error;
      continue;
    }
    throw error; // 4xx other than 429: not retryable
  }
  throw lastError ?? new ChartFetchError(`failed to fetch ${url}`);
}

function retryAfterMs(error: ChartFetchError): number {
  const sec = (error as { retryAfterSec?: number }).retryAfterSec;
  if (typeof sec === "number" && Number.isFinite(sec) && sec > 0) {
    return Math.min(sec, 30) * 1000;
  }
  return 2000;
}

/** Daily closes for a map source. Throws ChartFetchError on failure. */
export async function fetchCloses(
  source: ChartSource,
  sourceId: string,
  period: Period,
): Promise<Candle[]> {
  return source === "coingecko"
    ? fetchCoinGecko(sourceId, period)
    : fetchGeckoTerminal(sourceId, period);
}

/**
 * CoinGecko free API. `interval=daily` is paid-gated and granularity varies
 * by `days`, so the payload is always reduced to one close per UTC day (last
 * sample of each day).
 *
 * Keyless access is limited to the past 365 days — `days=max` (ALL-period
 * maps) returns 401 without a free demo API key in COINGECKO_API_KEY.
 */
async function fetchCoinGecko(coinId: string, period: Period): Promise<Candle[]> {
  const days = PERIOD_TO_COINGECKO_DAYS[period];
  const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(coinId)}/market_chart?vs_currency=usd&days=${days}`;
  const apiKey = process.env.COINGECKO_API_KEY;
  const payload = await fetchJsonWithRetry(url, apiKey ? { "x-cg-demo-api-key": apiKey } : {});

  const prices = (payload as { prices?: unknown }).prices;
  if (!Array.isArray(prices)) {
    throw new ChartFetchError(`coingecko ${coinId}: malformed payload (no prices array)`);
  }

  const byDay = new Map<number, Candle>();
  for (const entry of prices) {
    if (!Array.isArray(entry) || typeof entry[0] !== "number" || typeof entry[1] !== "number") {
      throw new ChartFetchError(`coingecko ${coinId}: malformed price entry`);
    }
    byDay.set(Math.floor(entry[0] / MS_PER_DAY), { t: entry[0], close: entry[1] });
  }
  return [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([, candle]) => candle);
}

/**
 * GeckoTerminal pool OHLCV. `sourceId` convention: "{network}:{poolAddress}",
 * e.g. "solana:8sLbNZ...". Returns daily closes oldest-first.
 */
async function fetchGeckoTerminal(sourceId: string, period: Period): Promise<Candle[]> {
  const sep = sourceId.indexOf(":");
  if (sep <= 0 || sep === sourceId.length - 1) {
    throw new ChartFetchError(
      `geckoterminal source_id must be "{network}:{poolAddress}", got "${sourceId}"`,
    );
  }
  const network = sourceId.slice(0, sep);
  const pool = sourceId.slice(sep + 1);
  const limit = PERIOD_TO_CANDLE_LIMIT[period];
  const url = `https://api.geckoterminal.com/api/v2/networks/${encodeURIComponent(network)}/pools/${encodeURIComponent(pool)}/ohlcv/day?aggregate=1&limit=${limit}`;
  const payload = await fetchJsonWithRetry(url);

  const list = (payload as { data?: { attributes?: { ohlcv_list?: unknown } } }).data?.attributes
    ?.ohlcv_list;
  if (!Array.isArray(list)) {
    throw new ChartFetchError(`geckoterminal ${sourceId}: malformed payload (no ohlcv_list)`);
  }

  const candles: Candle[] = [];
  for (const row of list) {
    if (!Array.isArray(row) || typeof row[0] !== "number" || typeof row[4] !== "number") {
      throw new ChartFetchError(`geckoterminal ${sourceId}: malformed ohlcv row`);
    }
    candles.push({ t: row[0] * 1000, close: row[4] });
  }
  return candles.sort((a, b) => a.t - b.t);
}
