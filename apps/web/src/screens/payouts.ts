import { getPaidReceipts, type ReceiptRow } from "../net";
import type { Screen } from "../router";
import { formatSol } from "../ui/format";

/** Public receipts feed (#/payouts) — proof the prize pool actually pays. */
export function createPayoutsScreen(): Screen {
  return {
    mount(root) {
      root.innerHTML = `
        <div class="page">
          <div class="topnav"><a href="#/">← HOME</a></div>
          <h1 class="hero-title">PAYOUTS</h1>
          <p class="hero-tagline">Every SOL prize we've sent, on-chain. Click a signature to verify on Solscan.</p>
          <div class="section-title">RECEIPTS</div>
          <div id="receipts"><div class="empty-state">Loading…</div></div>
        </div>`;
      const el = root.querySelector<HTMLDivElement>("#receipts")!;

      getPaidReceipts()
        .then((rows) => renderReceipts(el, rows))
        .catch(() => {
          el.innerHTML = `<div class="empty-state">Could not load receipts.</div>`;
        });
    },
    unmount() {
      /* nothing persistent */
    },
  };
}

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

function shortSig(sig: string): string {
  return sig.length > 12 ? `${sig.slice(0, 6)}…${sig.slice(-6)}` : sig;
}

function renderReceipts(el: HTMLElement, rows: ReceiptRow[]): void {
  if (rows.length === 0) {
    el.innerHTML = `<div class="empty-state">No payouts yet — the first window winners will show here.</div>`;
    return;
  }
  const body = rows
    .map((r) => {
      const sig = r.txSig
        ? `<a href="https://solscan.io/tx/${encodeURIComponent(r.txSig)}" target="_blank" rel="noopener">${shortSig(r.txSig)}</a>`
        : "—";
      return `<tr>
        <td>${fmtTime(r.paidAt)}</td>
        <td>${r.label}</td>
        <td>@${r.username}</td>
        <td class="amt">${formatSol(r.amountSol)} SOL</td>
        <td>${sig}</td>
      </tr>`;
    })
    .join("");
  el.innerHTML = `<table class="leaderboard receipts">
    <thead><tr><th>TIME</th><th>TRACK</th><th>RIDER</th><th>AMOUNT</th><th>TX</th></tr></thead>
    <tbody>${body}</tbody></table>`;
}
