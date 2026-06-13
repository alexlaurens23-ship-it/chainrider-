import {
  getLeaderboard,
  getMapsCached,
  getTrackCached,
  type LeaderRow,
  type MapEntry,
  type PrizeLadder,
  type TrackSummary,
} from "../net";
import type { Screen } from "../router";
import { drawChartPreview } from "../ui/chartPreview";
import { difficultyColor, formatClock, formatScore, formatSol } from "../ui/format";

type Mode = "raw" | "smooth";

export function createMapDetailScreen(): Screen {
  let mode: Mode = "raw";

  return {
    mount(root, params) {
      const page = document.createElement("div");
      page.className = "page";
      page.innerHTML = `
        <div class="topnav">
          <a href="#/">← HOME</a>
          <a href="#/playground">PLAYGROUND</a>
        </div>
        <div id="detail"><div class="empty-state">Loading…</div></div>
      `;
      root.appendChild(page);
      const detail = page.querySelector<HTMLDivElement>("#detail")!;

      getMapsCached()
        .then((res) => {
          const map = res.maps.find((m) => m.slug === params.slug);
          if (!map) {
            detail.innerHTML = `<div class="empty-state">Map "${params.slug}" not found.</div>`;
            return;
          }
          const siblings = res.maps
            .filter((m) => m.symbol === map.symbol)
            .sort((a, b) => a.period.localeCompare(b.period));
          render(detail, map, siblings, res.prizeLadder);
        })
        .catch(() => {
          detail.innerHTML = `<div class="empty-state">Could not load map. Is the API running?</div>`;
        });
    },

    unmount() {
      /* no timers/listeners to clean up */
    },
  };

  function render(
    detail: HTMLElement,
    map: MapEntry,
    siblings: MapEntry[],
    ladder: PrizeLadder | null,
  ): void {
    const tabs = siblings
      .map((s) => {
        const active = s.slug === map.slug ? " active" : "";
        return `<button class="tab${active}" data-href="#/map/${encodeURIComponent(s.slug)}/${encodeURIComponent(s.period)}">${s.period}</button>`;
      })
      .join("");

    detail.innerHTML = `
      <h1 class="hero-title" style="font-size:38px">${map.symbol}</h1>
      <p class="hero-tagline">${map.name}</p>
      <div class="tabs">${tabs}</div>
      <div class="mode-toggle">
        <button class="mode-btn" data-mode="raw">RAW</button>
        <button class="mode-btn" data-mode="smooth">SMOOTH</button>
      </div>
      <canvas class="chart-preview" id="preview"></canvas>
      <div class="stats-row" id="stats"></div>
      <div class="section-title">TOP 10 — ALL TIME</div>
      <div id="board"></div>
      <div style="margin-top:24px">
        <button class="btn-primary" id="ride-btn">RIDE THIS CHART ▸</button>
      </div>
    `;

    for (const tab of detail.querySelectorAll<HTMLButtonElement>(".tab")) {
      tab.addEventListener("click", () => {
        const href = tab.dataset.href;
        if (href) location.hash = href;
      });
    }

    const preview = detail.querySelector<HTMLCanvasElement>("#preview")!;
    const statsEl = detail.querySelector<HTMLDivElement>("#stats")!;
    const boardEl = detail.querySelector<HTMLDivElement>("#board")!;
    const rideBtn = detail.querySelector<HTMLButtonElement>("#ride-btn")!;
    const modeBtns = detail.querySelectorAll<HTMLButtonElement>(".mode-btn");

    const applyMode = (): void => {
      for (const btn of modeBtns) btn.classList.toggle("active", btn.dataset.mode === mode);
      const summary = map.tracks[mode];
      renderPreview(preview, summary);
      renderStats(statsEl, map, summary, ladder);
      renderBoard(boardEl, summary);
      if (summary) {
        rideBtn.disabled = false;
        rideBtn.onclick = () => {
          location.hash = `#/ride/${summary.trackId}`;
        };
      } else {
        rideBtn.disabled = true;
        rideBtn.onclick = null;
      }
    };

    for (const btn of modeBtns) {
      btn.addEventListener("click", () => {
        const next = btn.dataset.mode as Mode;
        if (next && next !== mode) {
          mode = next;
          applyMode();
        }
      });
    }
    applyMode();
  }
}

function renderPreview(canvas: HTMLCanvasElement, summary: TrackSummary | null): void {
  if (!summary) return;
  getTrackCached(summary.trackId)
    .then((t) => drawChartPreview(canvas, t.points))
    .catch(() => {
      /* preview is decorative */
    });
}

function renderStats(
  el: HTMLElement,
  map: MapEntry,
  summary: TrackSummary | null,
  ladder: PrizeLadder | null,
): void {
  if (!summary) {
    el.innerHTML = `<div class="empty-state" style="margin:0">This mode isn't available for this map yet.</div>`;
    return;
  }
  const s = summary.stats;
  const prizes = ladder?.[map.difficulty];
  const ladderText = prizes
    ? prizes.map((p, i) => `${ordinal(i + 1)} ${formatSol(p)}`).join(" · ") + " SOL"
    : "—";
  el.innerHTML = `
    <div><div class="stat-num">${s.pointCount}</div><div class="stat-label">POINTS</div></div>
    <div><div class="stat-num">${s.volatility.toFixed(2)}</div><div class="stat-label">VOLATILITY</div></div>
    <div><div class="stat-num">${s.maxSlopeDeg.toFixed(1)}°</div><div class="stat-label">MAX SLOPE</div></div>
    <div><span class="badge" style="background:${difficultyColor(map.difficulty)}">${map.difficulty}</span></div>
    <div style="flex:1"><div class="ladder">${ladderText}</div><div class="stat-label">WINDOW PRIZE LADDER</div></div>
  `;
}

function renderBoard(el: HTMLElement, summary: TrackSummary | null): void {
  if (!summary) {
    el.innerHTML = "";
    return;
  }
  el.innerHTML = `<div class="empty-state">Loading…</div>`;
  getLeaderboard(summary.trackId)
    .then((rows: LeaderRow[]) => {
      if (rows.length === 0) {
        el.innerHTML = `<div class="empty-state">No runs yet — be the first to set a time.</div>`;
        return;
      }
      const body = rows
        .map(
          (r) =>
            `<tr><td>${r.rank}</td><td>${r.player}</td><td>${formatScore(r.score)}</td><td>${formatClock(r.timeMs)}</td></tr>`,
        )
        .join("");
      el.innerHTML = `<table class="leaderboard">
        <thead><tr><th>#</th><th>RIDER</th><th>SCORE</th><th>TIME</th></tr></thead>
        <tbody>${body}</tbody></table>`;
    })
    .catch(() => {
      el.innerHTML = `<div class="empty-state">Could not load leaderboard.</div>`;
    });
}

function ordinal(n: number): string {
  return n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`;
}
