import { getToken } from "../auth";
import type { SubmitRunResult } from "../net";
import { formatClock, formatScore } from "../ui/format";

/** Score as a fraction of the track's max earns stars at these cutoffs. */
const STAR_FRACTIONS = [0.12, 0.28, 0.46, 0.66, 0.9];

export interface RunSummary {
  score: number;
  /** Speed component (0 on DNF). */
  speedScore: number;
  /** Weighted trick component. */
  trickBonus: number;
  /** Finish time + crash penalties, ms. */
  effectiveTimeMs: number;
  finished: boolean;
  flips: number;
  backflips: number;
  frontflips: number;
  crashes: number;
  maxCombo: number;
  timeMs: number;
  maxScore: number;
}

export interface RunCompleteHandlers {
  /** Fired automatically when the card mounts (finish OR quit). */
  autoSubmit(): Promise<SubmitRunResult>;
  onRetry(): void;
  onNewTrack(): void;
}

function starCount(score: number, maxScore: number): number {
  const frac = maxScore > 0 ? score / maxScore : 0;
  return STAR_FRACTIONS.filter((f) => frac >= f).length;
}

/** Builds the run-complete overlay into root. Returns a remove() to dismiss it. */
export function showRunComplete(
  root: HTMLElement,
  summary: RunSummary,
  handlers: RunCompleteHandlers,
): () => void {
  const stars = starCount(summary.score, summary.maxScore);
  const starHtml = Array.from({ length: 5 }, (_, i) =>
    i < stars ? `<span class="on">★</span>` : `<span class="off">★</span>`,
  ).join("");

  // Score is time-primary: a speed component (from par/effective-time) plus a
  // small trick garnish. Effective time = ride time + 3 s per crash.
  const penaltyMs = summary.effectiveTimeMs - summary.timeMs;
  const timeLine =
    penaltyMs > 0
      ? `${formatClock(summary.timeMs)} (+${formatClock(penaltyMs)} crash = ${formatClock(summary.effectiveTimeMs)})`
      : formatClock(summary.timeMs);

  const overlay = document.createElement("div");
  overlay.className = "run-complete";
  overlay.innerHTML = `
    <div class="run-card">
      <div class="rc-head">${summary.finished ? "FINISH" : "RUN ENDED — no finish, tricks only"}</div>
      <div class="rc-score">${formatScore(summary.score)}</div>
      <div class="stars">${starHtml}</div>
      <div class="rc-breakdown">Speed ${formatScore(summary.speedScore)} + Tricks ${formatScore(summary.trickBonus)}</div>
      <div class="rc-grid">
        <div class="cell"><span class="k">Time</span><span class="v">${timeLine}</span></div>
        <div class="cell"><span class="k">Crashes</span><span class="v">${summary.crashes}</span></div>
        <div class="cell"><span class="k">Flips</span><span class="v">${summary.flips}</span></div>
        <div class="cell"><span class="k">Back / Front</span><span class="v">${summary.backflips} / ${summary.frontflips}</span></div>
        <div class="cell"><span class="k">Max combo</span><span class="v">x${summary.maxCombo}</span></div>
        <div class="cell"><span class="k">Status</span><span class="v">${summary.finished ? "FINISHED" : "QUIT"}</span></div>
      </div>
      <div class="rc-status" id="rc-status">Saving run…</div>
      <div class="rc-buttons">
        <button class="btn-secondary" id="rc-retry">Retry</button>
        <button class="btn-secondary" id="rc-new">New Track</button>
      </div>
    </div>
  `;
  root.appendChild(overlay);

  overlay.querySelector<HTMLButtonElement>("#rc-retry")!.addEventListener("click", handlers.onRetry);
  overlay.querySelector<HTMLButtonElement>("#rc-new")!.addEventListener("click", handlers.onNewTrack);

  // Auto-submit the run in the background; reflect status on the card.
  const statusEl = overlay.querySelector<HTMLDivElement>("#rc-status")!;
  if (!getToken()) {
    // Submission requires an account — the wallet is the identity.
    statusEl.textContent = "Connect your wallet to save this run";
  } else {
    statusEl.textContent = "Saving run…";
    handlers
      .autoSubmit()
      .then((res) => {
        // The displayed score IS the official score now — the client score is
        // what counts and never changes after submit.
        if (res.verifyStatus === "verified" && res.rankThisWindow && res.rankAllTime) {
          statusEl.textContent = `VERIFIED ✓ · #${res.rankThisWindow} this window · #${res.rankAllTime} all-time`;
          statusEl.classList.add("ok");
        } else if (res.verifyStatus === "verified" && summary.finished) {
          statusEl.textContent = "VERIFIED ✓";
          statusEl.classList.add("ok");
        } else if (res.verifyStatus === "verified") {
          // Well-formed + plausible, but no finish — saved, just doesn't rank.
          statusEl.textContent = "VERIFIED ✓ — reach the flag to rank";
          statusEl.classList.add("ok");
        } else if (res.verifyStatus === "flagged") {
          statusEl.textContent = "Under review";
        } else {
          statusEl.textContent = "Couldn't verify — invalid run";
        }
      })
      .catch(() => {
        statusEl.textContent = "Save failed — retry to try again";
        statusEl.classList.add("fail");
      });
  }

  return () => overlay.remove();
}

export function showToast(root: HTMLElement, message: string): void {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  root.appendChild(toast);
  window.setTimeout(() => toast.remove(), 2600);
}
