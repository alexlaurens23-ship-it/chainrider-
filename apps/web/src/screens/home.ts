import {
  getDaily,
  getMapsCached,
  getPayoutBoard,
  getStats,
  getTrackCached,
  type DailyResponse,
  type MapEntry,
  type PayoutBoard,
  type StatsResponse,
} from "../net";
import type { Screen } from "../router";
import { formatCountdown, formatScore, formatSol, tierColor } from "../ui/format";
import { drawSparkline } from "../ui/sparkline";

/** Ms until the next 00:00 UTC (daily challenge reset). */
function msToNextUtcMidnight(): number {
  const now = new Date();
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0);
  return next - now.getTime();
}

export function createHomeScreen(): Screen {
  let countdownTimer = 0;
  let dailyTimer = 0;

  return {
    mount(root) {
      const page = document.createElement("div");
      page.className = "page";
      page.innerHTML = `
        <div class="topnav">
          <a href="#/">HOME</a>
          <a href="#/payouts">PAYOUTS</a>
          <a href="#/playground">PLAYGROUND</a>
        </div>
        <h1 class="hero-title">CHAINRIDER</h1>
        <p class="hero-tagline">Ride real crypto charts. Top the 30-minute window, get paid in SOL.</p>
        <div class="stat-strip" id="stat-strip">
          <div><div class="stat-num" id="rides">—</div><div class="stat-label">RIDES COMPLETED</div></div>
          <div><div class="stat-num" id="sol">—</div><div class="stat-label">TOTAL SOL PAID</div></div>
        </div>
        <div class="section-title">TRENDING TRACKS</div>
        <div class="card-grid" id="grid"><div class="empty-state">Loading tracks…</div></div>
        <div class="board-head">
          <div class="section-title">PAYOUT BOARD · 10 PAYING TRACKS</div>
          <div class="countdown"><span>WINDOW CLOSES IN</span> <span class="cd-time" id="cd">--:--</span></div>
        </div>
        <div id="payout-board"><div class="empty-state">Loading payout board…</div></div>
        <div class="board-foot"><a href="#/payouts">see who we've paid →</a></div>
        <div class="board-head">
          <div class="section-title">DAILY CHALLENGE</div>
          <div class="countdown"><span>RESETS IN</span> <span class="cd-time" id="daily-cd">--:--:--</span></div>
        </div>
        <div id="daily"><div class="empty-state">Loading today's challenge…</div></div>
      `;
      root.appendChild(page);

      const grid = page.querySelector<HTMLDivElement>("#grid")!;
      const ridesEl = page.querySelector<HTMLDivElement>("#rides")!;
      const solEl = page.querySelector<HTMLDivElement>("#sol")!;
      const cdEl = page.querySelector<HTMLSpanElement>("#cd")!;
      const boardEl = page.querySelector<HTMLDivElement>("#payout-board")!;
      const dailyEl = page.querySelector<HTMLDivElement>("#daily")!;
      const dailyCdEl = page.querySelector<HTMLSpanElement>("#daily-cd")!;

      // Countdown to the window's real ends_at (falls back to UTC-modulo).
      let endsAtMs = Math.ceil(Date.now() / 1_800_000) * 1_800_000;
      function tickCountdown(): void {
        cdEl.textContent = formatCountdown(endsAtMs - Date.now());
      }
      tickCountdown();
      countdownTimer = window.setInterval(tickCountdown, 1000);

      getStats()
        .then((stats: StatsResponse) => {
          ridesEl.textContent = stats.ridesCompleted.toLocaleString("en-US");
          solEl.textContent = formatSol(stats.totalSolPaid);
        })
        .catch(() => {
          ridesEl.textContent = "0";
          solEl.textContent = "0";
        });

      getPayoutBoard()
        .then((board) => {
          endsAtMs = new Date(board.endsAt).getTime();
          tickCountdown();
          renderPayoutBoard(boardEl, board);
        })
        .catch(() => {
          boardEl.innerHTML = `<div class="empty-state">Could not load the payout board.</div>`;
        });

      getMapsCached()
        .then((res) => renderCards(grid, res.maps))
        .catch(() => {
          grid.innerHTML = `<div class="empty-state">Could not load tracks. Is the API running?</div>`;
        });

      // Daily challenge countdown ticks to the next 00:00 UTC.
      function tickDaily(): void {
        dailyCdEl.textContent = formatCountdown(msToNextUtcMidnight());
      }
      tickDaily();
      dailyTimer = window.setInterval(tickDaily, 1000);

      getDaily()
        .then((daily) => renderDaily(dailyEl, daily))
        .catch(() => {
          dailyEl.innerHTML = `<div class="empty-state">Could not load today's challenge.</div>`;
        });
    },

    unmount() {
      window.clearInterval(countdownTimer);
      window.clearInterval(dailyTimer);
    },
  };
}

function renderPayoutBoard(el: HTMLElement, board: PayoutBoard): void {
  if (board.tracks.length === 0) {
    el.innerHTML = `<div class="empty-state">No paying tracks graded yet.</div>`;
    return;
  }
  const rows = board.tracks
    .map((t) => {
      const apex = t.rank === 1 ? " apex" : "";
      const tColor = t.tier ? tierColor(t.tier as never) : "#9fb4c8";
      const leader = t.leader
        ? `<span class="pb-leader">@${t.leader.username} · ${formatScore(t.leader.score)}</span>`
        : `<span class="pb-open">open — be first</span>`;
      return `<a class="pb-row${apex}" href="#/ride/${t.trackId}">
        <span class="pb-rank">#${t.rank}</span>
        <span class="pb-label"><span class="pb-dot" style="background:${tColor}"></span>${t.label}</span>
        <span class="pb-prize">${formatSol(t.prizeSol)} SOL</span>
        <span class="pb-leadwrap">${leader}</span>
      </a>`;
    })
    .join("");
  el.innerHTML = `<div class="payout-board">${rows}</div>`;
}

const DAILY_ACCENT = "#ffd34e"; // gold — the daily challenge

function renderDaily(el: HTMLElement, daily: DailyResponse): void {
  if (daily.trackId == null) {
    el.innerHTML = `<div class="empty-state">No challenge open yet — check back at 00:00 UTC.</div>`;
    return;
  }
  const top5 =
    daily.top5.length === 0
      ? `<div class="empty-state">Be the first to set a time on today's track.</div>`
      : `<div class="payout-board">${daily.top5
          .map(
            (e) => `<div class="pb-row">
              <span class="pb-rank">#${e.rank}</span>
              <span class="pb-label">@${e.username}</span>
              <span class="pb-leadwrap">${formatScore(e.score)}</span>
            </div>`,
          )
          .join("")}</div>`;
  el.innerHTML = `
    <div class="daily-card">
      <div class="daily-top">
        <div>
          <div class="daily-label">${daily.label ?? "today's track"}</div>
          <div class="daily-prize">${formatSol(daily.prizeSol)} SOL · winner takes all</div>
        </div>
        <canvas class="spark daily-spark"></canvas>
      </div>
      <a class="btn-primary daily-ride" href="#/ride/${daily.trackId}">RIDE TODAY'S CHALLENGE</a>
      <div class="daily-board-title">TOP 5 TODAY</div>
      ${top5}
    </div>`;
  const canvas = el.querySelector<HTMLCanvasElement>(".daily-spark");
  if (canvas && daily.points.length > 0) drawSparkline(canvas, daily.points, DAILY_ACCENT);
}

const SPARK_ACCENT = "#00e5ff"; // brand cyan

function renderCards(grid: HTMLElement, maps: MapEntry[]): void {
  if (maps.length === 0) {
    grid.innerHTML = `<div class="empty-state">No tracks yet. Seed some maps from the admin API.</div>`;
    return;
  }
  // One card per coin: pick the 1Y map as the representative (periods are chosen
  // inside MapDetail via its period tabs).
  const bySymbol = new Map<string, MapEntry>();
  for (const map of maps) {
    const existing = bySymbol.get(map.symbol);
    if (!existing || map.period === "1Y") bySymbol.set(map.symbol, map);
  }

  grid.replaceChildren();
  for (const map of bySymbol.values()) {
    const coinName = map.name.replace(/\s+(1Y|6M|3M)$/i, "");
    const card = document.createElement("a");
    card.className = "track-card";
    card.href = `#/map/${encodeURIComponent(map.slug)}/${encodeURIComponent(map.period)}`;
    card.innerHTML = `
      <div class="card-top">
        <div>
          <div class="symbol">${map.symbol}</div>
          <div class="name">${coinName}</div>
        </div>
      </div>
      <canvas class="spark"></canvas>
    `;
    grid.appendChild(card);

    const canvas = card.querySelector<HTMLCanvasElement>(".spark")!;
    const sparkTrackId = map.tiers.VOLATILE?.raw?.trackId;
    if (sparkTrackId != null) {
      getTrackCached(sparkTrackId)
        .then((t) => drawSparkline(canvas, t.points, SPARK_ACCENT))
        .catch(() => {
          /* sparkline is decorative; ignore fetch failures */
        });
    }
  }
}
