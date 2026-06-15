import {
  getGlobalLeaderboard,
  getMapsCached,
  getMyLeaderboard,
  getTrackCached,
  TIERS,
  type GlobalEntry,
  type LeaderboardScope,
  type MapEntry,
  type MyBoard,
  type Tier,
  type TrackSummary,
} from "../net";
import { isLoggedIn, requireLogin } from "../auth";
import type { Screen } from "../router";
import { drawChartPreview } from "../ui/chartPreview";
import { formatClock, formatScore, formatSol, tierColor } from "../ui/format";

type Mode = "raw" | "smooth";
const DEFAULT_TIER: Tier = "VOLATILE";

function asTier(v: string | undefined): Tier | null {
  return v && (TIERS as string[]).includes(v) ? (v as Tier) : null;
}

/** Danger glow class for the hotter tiers (CSS adds the colored shadow). */
function glowClass(tier: Tier): string {
  return tier === "SAVAGE" ? " savage" : tier === "DEGEN" ? " degen" : "";
}

export function createMapDetailScreen(): Screen {
  let tier: Tier = DEFAULT_TIER;
  let mode: Mode = "raw";

  return {
    mount(root, params) {
      tier = asTier(params.tier) ?? DEFAULT_TIER;
      mode = "raw";

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
          render(detail, map, siblings);
        })
        .catch(() => {
          detail.innerHTML = `<div class="empty-state">Could not load map. Is the API running?</div>`;
        });
    },

    unmount() {
      /* no timers/listeners to clean up */
    },
  };

  function render(detail: HTMLElement, map: MapEntry, siblings: MapEntry[]): void {
    const periodTabs = siblings
      .map((s) => {
        const active = s.slug === map.slug ? " active" : "";
        return `<button class="tab${active}" data-href="#/map/${encodeURIComponent(s.slug)}/${encodeURIComponent(s.period)}">${s.period}</button>`;
      })
      .join("");

    const tierBtns = TIERS.map(
      (t) => `<button class="tier-btn${glowClass(t)}" data-tier="${t}">${t}</button>`,
    ).join("");

    detail.innerHTML = `
      <h1 class="hero-title" style="font-size:38px">${map.symbol}</h1>
      <p class="hero-tagline">${map.name}</p>
      <div class="tabs">${periodTabs}</div>
      <div class="control-label">DIFFICULTY TIER</div>
      <div class="tier-toggle">${tierBtns}</div>
      <div class="control-label">TERRAIN MODE</div>
      <div class="mode-toggle">
        <button class="mode-btn" data-mode="raw">RAW</button>
        <button class="mode-btn" data-mode="smooth">SMOOTH</button>
      </div>
      <canvas class="chart-preview" id="preview"></canvas>
      <div class="stats-row" id="stats"></div>
      <div class="section-title">GLOBAL</div>
      <div class="tabs lb-tabs">
        <button class="tab active" data-scope="window">THIS WINDOW</button>
        <button class="tab" data-scope="alltime">ALL-TIME</button>
      </div>
      <div id="board"></div>
      <div class="section-title">YOUR PBs</div>
      <div id="myboard"></div>
      <div style="margin-top:24px">
        <button class="btn-primary" id="ride-btn">RIDE THIS CHART ▸</button>
        <div class="ride-hint" id="ride-hint">${isLoggedIn() ? "" : "Log in to ride & win SOL"}</div>
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
    const myEl = detail.querySelector<HTMLDivElement>("#myboard")!;
    const rideBtn = detail.querySelector<HTMLButtonElement>("#ride-btn")!;
    const tierBtnEls = detail.querySelectorAll<HTMLButtonElement>(".tier-btn");
    const modeBtns = detail.querySelectorAll<HTMLButtonElement>(".mode-btn");

    let scope: LeaderboardScope = "window";
    let currentSummary: TrackSummary | null = null;

    // Scope tabs (This Window / All-Time) re-query the global board only.
    for (const btn of detail.querySelectorAll<HTMLButtonElement>(".lb-tabs .tab")) {
      btn.addEventListener("click", () => {
        scope = btn.dataset.scope as LeaderboardScope;
        for (const b of detail.querySelectorAll<HTMLButtonElement>(".lb-tabs .tab")) {
          b.classList.toggle("active", b === btn);
        }
        renderGlobal(boardEl, currentSummary, scope);
      });
    }

    const applySelection = (): void => {
      for (const btn of tierBtnEls) {
        const t = btn.dataset.tier as Tier;
        const on = t === tier;
        btn.classList.toggle("active", on);
        btn.style.background = on ? tierColor(t) : "";
        btn.style.color = on ? "#05060a" : "";
      }
      for (const btn of modeBtns) btn.classList.toggle("active", btn.dataset.mode === mode);

      const summary = map.tiers[tier]?.[mode] ?? null;
      const prize = map.tiers[tier]?.prize ?? null;
      currentSummary = summary;
      renderPreview(preview, summary);
      renderStats(statsEl, tier, summary, prize);
      // Per-track: both boards refetch when tier/mode/period selection changes.
      renderGlobal(boardEl, summary, scope);
      renderMyBoard(myEl, summary);
      if (summary) {
        rideBtn.disabled = false;
        rideBtn.onclick = () => {
          // Browsing is free; riding needs an account. If logged out, the modal
          // opens and we continue into the ride on successful login.
          const target = `#/ride/${summary.trackId}`;
          requireLogin(() => {
            location.hash = target;
          });
        };
      } else {
        rideBtn.disabled = true;
        rideBtn.onclick = null;
      }
    };

    for (const btn of tierBtnEls) {
      btn.addEventListener("click", () => {
        const next = asTier(btn.dataset.tier);
        if (next && next !== tier) {
          tier = next;
          applySelection();
        }
      });
    }
    for (const btn of modeBtns) {
      btn.addEventListener("click", () => {
        const next = btn.dataset.mode as Mode;
        if (next && next !== mode) {
          mode = next;
          applySelection();
        }
      });
    }
    applySelection();
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
  tier: Tier,
  summary: TrackSummary | null,
  prize: number[] | null,
): void {
  if (!summary) {
    el.innerHTML = `<div class="empty-state" style="margin:0">This tier/mode isn't available for this map yet.</div>`;
    return;
  }
  const s = summary.stats;
  const ladderText = prize
    ? prize.map((p, i) => `${ordinal(i + 1)} ${formatSol(p)}`).join(" · ") + " SOL"
    : "—";
  el.innerHTML = `
    <div><span class="badge${glowClass(tier)}" style="background:${tierColor(tier)}">${tier}</span></div>
    <div><div class="stat-num">${s.pointCount}</div><div class="stat-label">POINTS</div></div>
    <div><div class="stat-num">${s.volatility.toFixed(2)}</div><div class="stat-label">VOLATILITY</div></div>
    <div><div class="stat-num">${s.maxSlopeDeg.toFixed(1)}°</div><div class="stat-label">MAX SLOPE</div></div>
    <div style="flex:1"><div class="ladder">${ladderText}</div><div class="stat-label">WINDOW PRIZE LADDER</div></div>
  `;
}

/** Per-track global board (one row per player), This-Window or All-Time. */
function renderGlobal(el: HTMLElement, summary: TrackSummary | null, scope: LeaderboardScope): void {
  if (!summary) {
    el.innerHTML = "";
    return;
  }
  const trackId = summary.trackId;
  el.innerHTML = `<div class="empty-state">Loading…</div>`;
  getGlobalLeaderboard(trackId, scope)
    .then((rows: GlobalEntry[]) => {
      // A late response for a track we've since switched away from is ignored.
      if (summary.trackId !== trackId) return;
      if (rows.length === 0) {
        const msg =
          scope === "window"
            ? "No verified runs this window yet — be first."
            : "No runs yet — be the first to set a time.";
        el.innerHTML = `<div class="empty-state">${msg}</div>`;
        return;
      }
      const body = rows
        .map(
          (r) =>
            `<tr><td>${r.rank}</td><td>@${r.username}</td><td>${formatScore(r.score)}</td><td>${formatClock(r.timeMs)}</td></tr>`,
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

/** The logged-in player's top-5 PBs on this track + their all-time rank. */
function renderMyBoard(el: HTMLElement, summary: TrackSummary | null): void {
  if (!summary) {
    el.innerHTML = "";
    return;
  }
  if (!isLoggedIn()) {
    el.innerHTML = `<div class="empty-state">Log in to track your bests.</div>`;
    return;
  }
  const trackId = summary.trackId;
  el.innerHTML = `<div class="empty-state">Loading…</div>`;
  getMyLeaderboard(trackId)
    .then((mine: MyBoard) => {
      if (summary.trackId !== trackId) return;
      if (mine.best.length === 0) {
        el.innerHTML = `<div class="empty-state">No verified runs yet on this track.</div>`;
        return;
      }
      const rankLine =
        mine.allTimeRank != null
          ? `<div class="my-rank">All-time rank: <b>${ordinal(mine.allTimeRank)}</b></div>`
          : "";
      const body = mine.best
        .map(
          (r) =>
            `<tr><td>${r.rank}</td><td>${formatScore(r.score)}</td><td>${formatClock(r.timeMs)}</td><td>${r.flips}</td></tr>`,
        )
        .join("");
      el.innerHTML = `${rankLine}<table class="leaderboard">
        <thead><tr><th>#</th><th>SCORE</th><th>TIME</th><th>FLIPS</th></tr></thead>
        <tbody>${body}</tbody></table>`;
    })
    .catch(() => {
      el.innerHTML = `<div class="empty-state">Could not load your bests.</div>`;
    });
}

function ordinal(n: number): string {
  return n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`;
}
