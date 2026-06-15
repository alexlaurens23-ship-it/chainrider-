import {
  ADMIN_KEY_STORAGE,
  approveRun,
  getFlaggedRuns,
  getPendingPayouts,
  getWindowHistory,
  markPaid,
  rejectRun,
  skipPayout,
  type FlaggedRun,
  type PendingPayout,
  type WindowHistoryRow,
} from "../net";
import type { Screen } from "../router";
import { formatScore, formatSol } from "../ui/format";

/**
 * Owner payout admin (#/admin) — key-gated, mobile-first dense. The ADMIN_KEY is
 * held in sessionStorage and sent as X-Admin-Key on every admin call; a 401
 * clears it and re-locks. Separate from the player JWT. No private keys here —
 * the owner sends SOL from their own wallet and pastes back only the tx sig.
 */
type Tab = "pending" | "flagged" | "windows";

export function createAdminScreen(): Screen {
  let root: HTMLElement;

  function render(): void {
    if (sessionStorage.getItem(ADMIN_KEY_STORAGE)) renderPanel("pending");
    else renderUnlock();
  }

  function renderUnlock(): void {
    root.innerHTML = `
      <div class="page admin">
        <div class="topnav"><a href="#/">← HOME</a></div>
        <h1 class="hero-title">ADMIN</h1>
        <div class="admin-unlock">
          <input class="modal-input" id="ak" type="password" autocomplete="off" placeholder="admin key" />
          <button class="btn-primary" id="ak-go">Unlock</button>
          <div class="modal-error" id="ak-err"></div>
        </div>
      </div>`;
    const input = root.querySelector<HTMLInputElement>("#ak")!;
    const err = root.querySelector<HTMLDivElement>("#ak-err")!;
    const go = async (): Promise<void> => {
      const key = input.value.trim();
      if (!key) return;
      sessionStorage.setItem(ADMIN_KEY_STORAGE, key);
      try {
        await getPendingPayouts(); // probe the key
        render();
      } catch {
        sessionStorage.removeItem(ADMIN_KEY_STORAGE);
        err.textContent = "Wrong key.";
      }
    };
    root.querySelector<HTMLButtonElement>("#ak-go")!.addEventListener("click", () => void go());
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") void go();
    });
    input.focus();
  }

  function lockOut(): void {
    sessionStorage.removeItem(ADMIN_KEY_STORAGE);
    render();
  }

  function renderPanel(tab: Tab): void {
    root.innerHTML = `
      <div class="page admin">
        <div class="topnav"><a href="#/">← HOME</a><a id="lock">LOCK</a></div>
        <div class="tabs admin-tabs">
          <button class="tab ${tab === "pending" ? "active" : ""}" data-tab="pending">PENDING</button>
          <button class="tab ${tab === "flagged" ? "active" : ""}" data-tab="flagged">FLAGGED</button>
          <button class="tab ${tab === "windows" ? "active" : ""}" data-tab="windows">WINDOWS</button>
        </div>
        <div id="admin-body"><div class="empty-state">Loading…</div></div>
      </div>`;
    root.querySelector<HTMLAnchorElement>("#lock")!.addEventListener("click", lockOut);
    for (const btn of root.querySelectorAll<HTMLButtonElement>(".admin-tabs .tab")) {
      btn.addEventListener("click", () => renderPanel(btn.dataset.tab as Tab));
    }
    const body = root.querySelector<HTMLDivElement>("#admin-body")!;
    if (tab === "pending") loadPending(body);
    else if (tab === "flagged") loadFlagged(body);
    else loadWindows(body);
  }

  // ── PENDING ─────────────────────────────────────────────────────────────
  function loadPending(body: HTMLElement): void {
    getPendingPayouts()
      .then(({ totalSol, payouts }) => {
        if (payouts.length === 0) {
          body.innerHTML = `<div class="empty-state">No pending payouts. Window winners appear here at :00/:30.</div>`;
          return;
        }
        const groups = new Map<number, PendingPayout[]>();
        for (const p of payouts) {
          const list = groups.get(p.windowId) ?? [];
          list.push(p);
          groups.set(p.windowId, list);
        }
        let html = `<div class="admin-total">TOTAL PENDING <b>${formatSol(totalSol)} SOL</b></div>`;
        for (const [windowId, rows] of groups) {
          html += `<div class="admin-group">window #${windowId} · ${rows.length} payout(s)</div>`;
          html += rows.map(pendingRow).join("");
        }
        body.innerHTML = html;
        for (const p of payouts) wirePendingRow(body, p);
      })
      .catch(handleErr(body));
  }

  function pendingRow(p: PendingPayout): string {
    return `<div class="pay-row" id="pay-${p.id}">
      <div class="pay-head">#${p.rank} · ${p.label} · <b>${formatSol(p.amountSol)} SOL</b></div>
      <div class="pay-line">@${p.username} · <a href="#/replay/${p.runId}">replay ▸</a></div>
      <div class="pay-copy"><code>${p.wallet}</code><button class="copy" data-copy="${p.wallet}">copy addr</button></div>
      <div class="pay-copy"><code>${formatSol(p.amountSol)}</code><button class="copy" data-copy="${p.amountSol}">copy amt</button></div>
      <div class="pay-act">
        <input class="modal-input sig" placeholder="tx signature" />
        <button class="btn-primary mk-paid">MARK PAID</button>
        <button class="btn-secondary mk-skip">SKIP</button>
      </div>
      <div class="pay-status" id="pay-status-${p.id}"></div>
    </div>`;
  }

  function wirePendingRow(body: HTMLElement, p: PendingPayout): void {
    const row = body.querySelector<HTMLDivElement>(`#pay-${p.id}`);
    if (!row) return;
    const status = body.querySelector<HTMLDivElement>(`#pay-status-${p.id}`)!;
    for (const btn of row.querySelectorAll<HTMLButtonElement>(".copy")) {
      btn.addEventListener("click", () => {
        void navigator.clipboard?.writeText(btn.dataset.copy ?? "");
        const t = btn.textContent;
        btn.textContent = "copied!";
        window.setTimeout(() => (btn.textContent = t), 1000);
      });
    }
    row.querySelector<HTMLButtonElement>(".mk-paid")!.addEventListener("click", async () => {
      const sig = row.querySelector<HTMLInputElement>(".sig")!.value.trim();
      if (sig.length < 32) {
        status.textContent = "Paste the tx signature first.";
        return;
      }
      try {
        await markPaid(p.id, sig);
        row.classList.add("paid");
        status.textContent = "PAID ✓";
      } catch {
        status.textContent = "Failed — check the key/sig.";
      }
    });
    row.querySelector<HTMLButtonElement>(".mk-skip")!.addEventListener("click", async () => {
      const reason = window.prompt("Skip reason (cheat, dust, etc.)?");
      if (!reason) return;
      try {
        await skipPayout(p.id, reason);
        row.classList.add("skipped");
        status.textContent = `SKIPPED — ${reason}`;
      } catch {
        status.textContent = "Failed to skip.";
      }
    });
  }

  // ── FLAGGED ─────────────────────────────────────────────────────────────
  function loadFlagged(body: HTMLElement): void {
    getFlaggedRuns()
      .then((runs) => {
        if (runs.length === 0) {
          body.innerHTML = `<div class="empty-state">No flagged runs. Anything within ±5% of the server score is held here.</div>`;
          return;
        }
        body.innerHTML = runs.map(flaggedRow).join("");
        for (const r of runs) wireFlaggedRow(body, r);
      })
      .catch(handleErr(body));
  }

  function flaggedRow(r: FlaggedRun): string {
    return `<div class="pay-row" id="flag-${r.runId}">
      <div class="pay-head">${r.label}</div>
      <div class="pay-line">@${r.username} · client ${formatScore(r.clientScore)} vs server ${
        r.serverScore != null ? formatScore(r.serverScore) : "—"
      }</div>
      <div class="pay-act">
        <a class="btn-secondary" href="#/replay/${r.runId}">WATCH REPLAY</a>
        <button class="btn-primary approve">APPROVE</button>
        <button class="btn-secondary reject">REJECT</button>
      </div>
      <div class="pay-status" id="flag-status-${r.runId}"></div>
    </div>`;
  }

  function wireFlaggedRow(body: HTMLElement, r: FlaggedRun): void {
    const row = body.querySelector<HTMLDivElement>(`#flag-${r.runId}`)!;
    const status = body.querySelector<HTMLDivElement>(`#flag-status-${r.runId}`)!;
    row.querySelector<HTMLButtonElement>(".approve")!.addEventListener("click", async () => {
      try {
        await approveRun(r.runId);
        row.classList.add("paid");
        status.textContent = "APPROVED → verified (eligible next close)";
      } catch {
        status.textContent = "Failed.";
      }
    });
    row.querySelector<HTMLButtonElement>(".reject")!.addEventListener("click", async () => {
      try {
        await rejectRun(r.runId);
        row.classList.add("skipped");
        status.textContent = "REJECTED → failed";
      } catch {
        status.textContent = "Failed.";
      }
    });
  }

  // ── WINDOWS ─────────────────────────────────────────────────────────────
  function loadWindows(body: HTMLElement): void {
    getWindowHistory()
      .then((rows) => {
        if (rows.length === 0) {
          body.innerHTML = `<div class="empty-state">No windows yet.</div>`;
          return;
        }
        body.innerHTML = `<table class="leaderboard"><thead><tr>
          <th>#</th><th>START (UTC)</th><th>STATUS</th><th>SOL</th><th>PENDING</th><th>PAID</th>
        </tr></thead><tbody>${rows.map(windowRow).join("")}</tbody></table>`;
      })
      .catch(handleErr(body));
  }

  function windowRow(w: WindowHistoryRow): string {
    return `<tr>
      <td>${w.id}</td>
      <td>${new Date(w.startsAt).toISOString().slice(5, 16).replace("T", " ")}</td>
      <td>${w.status}</td>
      <td>${formatSol(w.totalSol)}</td>
      <td>${w.pendingCount}</td>
      <td>${w.paidCount}</td>
    </tr>`;
  }

  function handleErr(body: HTMLElement) {
    return (): void => {
      // A 401 means the stored key is wrong/expired — re-lock.
      sessionStorage.removeItem(ADMIN_KEY_STORAGE);
      body.innerHTML = `<div class="empty-state">Session expired — <a href="#/admin">unlock again</a>.</div>`;
    };
  }

  return {
    mount(r) {
      root = r;
      render();
    },
    unmount() {
      /* nothing persistent (key stays in sessionStorage until LOCK) */
    },
  };
}
