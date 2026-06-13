import {
  getMapsCached,
  getStats,
  getTrackCached,
  type MapEntry,
  type PrizeLadder,
  type StatsResponse,
} from "../net";
import type { Screen } from "../router";
import { difficultyColor, formatCountdown, formatSol } from "../ui/format";
import { drawSparkline } from "../ui/sparkline";

export function createHomeScreen(): Screen {
  let countdownTimer = 0;

  return {
    mount(root) {
      const page = document.createElement("div");
      page.className = "page";
      page.innerHTML = `
        <div class="topnav">
          <a href="#/">HOME</a>
          <a href="#/playground">PLAYGROUND</a>
        </div>
        <h1 class="hero-title">CHAINRIDER</h1>
        <p class="hero-tagline">Ride real crypto charts. Top the 30-minute window, get paid in SOL.</p>
        <div class="stat-strip" id="stat-strip">
          <div><div class="stat-num" id="rides">—</div><div class="stat-label">RIDES COMPLETED</div></div>
          <div><div class="stat-num" id="sol">—</div><div class="stat-label">TOTAL SOL PAID</div></div>
        </div>
        <div class="countdown">
          <span>NEXT PAYOUT IN</span>
          <span class="cd-time" id="cd">--:--</span>
        </div>
        <div class="section-title">TRENDING TRACKS</div>
        <div class="card-grid" id="grid"><div class="empty-state">Loading tracks…</div></div>
      `;
      root.appendChild(page);

      const grid = page.querySelector<HTMLDivElement>("#grid")!;
      const ridesEl = page.querySelector<HTMLDivElement>("#rides")!;
      const solEl = page.querySelector<HTMLDivElement>("#sol")!;
      const cdEl = page.querySelector<HTMLSpanElement>("#cd")!;

      let windowMinutes = 30;

      getStats()
        .then((stats: StatsResponse) => {
          ridesEl.textContent = stats.ridesCompleted.toLocaleString("en-US");
          solEl.textContent = formatSol(stats.totalSolPaid);
          windowMinutes = stats.config.windowMinutes || 30;
          tickCountdown();
        })
        .catch(() => {
          ridesEl.textContent = "0";
          solEl.textContent = "0";
        });

      function tickCountdown(): void {
        const windowMs = windowMinutes * 60_000;
        cdEl.textContent = formatCountdown(windowMs - (Date.now() % windowMs));
      }
      tickCountdown();
      countdownTimer = window.setInterval(tickCountdown, 1000);

      getMapsCached()
        .then((res) => renderCards(grid, res.maps, res.prizeLadder))
        .catch(() => {
          grid.innerHTML = `<div class="empty-state">Could not load tracks. Is the API running?</div>`;
        });
    },

    unmount() {
      window.clearInterval(countdownTimer);
    },
  };
}

function renderCards(grid: HTMLElement, maps: MapEntry[], ladder: PrizeLadder | null): void {
  if (maps.length === 0) {
    grid.innerHTML = `<div class="empty-state">No tracks yet. Seed some maps from the admin API.</div>`;
    return;
  }
  grid.replaceChildren();
  for (const map of maps) {
    const rankPrize = ladder?.[map.difficulty]?.[0];
    const card = document.createElement("a");
    card.className = "track-card";
    card.href = `#/map/${encodeURIComponent(map.slug)}/${encodeURIComponent(map.period)}`;
    card.innerHTML = `
      <div class="card-top">
        <div>
          <div class="symbol">${map.symbol}</div>
          <div class="name">${map.name}</div>
        </div>
        <span class="badge" style="background:${difficultyColor(map.difficulty)}">${map.difficulty}</span>
      </div>
      <canvas class="spark"></canvas>
      <div class="card-bottom">
        <span class="period-pill">${map.period}</span>
        <span class="prize">${rankPrize != null ? `🏆 ${formatSol(rankPrize)} SOL` : ""}</span>
      </div>
    `;
    grid.appendChild(card);

    const canvas = card.querySelector<HTMLCanvasElement>(".spark")!;
    const rawTrackId = map.tracks.raw?.trackId;
    const accent = difficultyColor(map.difficulty);
    if (rawTrackId != null) {
      getTrackCached(rawTrackId)
        .then((t) => drawSparkline(canvas, t.points, accent))
        .catch(() => {
          /* sparkline is decorative; ignore fetch failures */
        });
    }
  }
}
