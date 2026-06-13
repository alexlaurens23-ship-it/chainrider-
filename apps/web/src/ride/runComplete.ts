import { formatClock, formatScore } from "../ui/format";

/** Score as a fraction of the track's max earns stars at these cutoffs. */
const STAR_FRACTIONS = [0.12, 0.28, 0.46, 0.66, 0.9];

export interface RunSummary {
  score: number;
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
  onSubmit(): void;
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

  const overlay = document.createElement("div");
  overlay.className = "run-complete";
  overlay.innerHTML = `
    <div class="run-card">
      <div class="rc-head">${summary.finished ? "FINISH" : "RUN ENDED"}</div>
      <div class="rc-score">${formatScore(summary.score)}</div>
      <div class="stars">${starHtml}</div>
      <div class="rc-grid">
        <div class="cell"><span class="k">Flips</span><span class="v">${summary.flips}</span></div>
        <div class="cell"><span class="k">Back / Front</span><span class="v">${summary.backflips} / ${summary.frontflips}</span></div>
        <div class="cell"><span class="k">Max combo</span><span class="v">x${summary.maxCombo}</span></div>
        <div class="cell"><span class="k">Crashes</span><span class="v">${summary.crashes}</span></div>
        <div class="cell"><span class="k">Time</span><span class="v">${formatClock(summary.timeMs)}</span></div>
        <div class="cell"><span class="k">Status</span><span class="v">${summary.finished ? "FINISHED" : "QUIT"}</span></div>
      </div>
      <div class="rc-buttons">
        <button class="btn-primary" id="rc-submit">Submit Score</button>
        <button class="btn-secondary" id="rc-retry">Retry</button>
        <button class="btn-secondary" id="rc-new">New Track</button>
      </div>
    </div>
  `;
  root.appendChild(overlay);

  overlay.querySelector<HTMLButtonElement>("#rc-submit")!.addEventListener("click", handlers.onSubmit);
  overlay.querySelector<HTMLButtonElement>("#rc-retry")!.addEventListener("click", handlers.onRetry);
  overlay.querySelector<HTMLButtonElement>("#rc-new")!.addEventListener("click", handlers.onNewTrack);

  return () => overlay.remove();
}

export function showToast(root: HTMLElement, message: string): void {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  root.appendChild(toast);
  window.setTimeout(() => toast.remove(), 2600);
}
