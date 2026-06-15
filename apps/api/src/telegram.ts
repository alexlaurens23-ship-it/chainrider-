import net from "node:net";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FastifyInstance } from "fastify";
import { getDb } from "./db.js";
import { fetchUnpaidPayouts, markPayoutPaid, type EnrichedPayout } from "./payoutOps.js";

/**
 * Telegram payout control channel (Option B: notify-and-reply-to-pay).
 *
 * SAFETY: this bot NEVER holds a private key, NEVER sends SOL, NEVER auto-pays.
 * It only (1) DMs the owner what to send when a window closes, and (2) marks a
 * payout paid when the owner replies `/paid <id> <txSig>` with the on-chain sig
 * they got from sending SOL themselves. It obeys ONLY TELEGRAM_ADMIN_USER_ID;
 * every other sender is ignored silently. Unconfigured env → fully disabled.
 *
 * Zero new deps: the Telegram Bot API is reached with the built-in fetch
 * (sendMessage to notify, getUpdates long-polling to receive). In-process and
 * single-instance, like the window cron.
 */

// Re-export so callers/tests can import the sig validator from here too.
export { isValidSolanaSig } from "./payoutOps.js";

const API = "https://api.telegram.org";

function token(): string | undefined {
  return process.env.TELEGRAM_BOT_TOKEN?.trim() || undefined;
}
function adminId(): number | undefined {
  const raw = process.env.TELEGRAM_ADMIN_USER_ID?.trim();
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isInteger(n) ? n : undefined;
}
export function tgConfigured(): boolean {
  return token() !== undefined && adminId() !== undefined;
}

// ── Pure message builders ──────────────────────────────────────────────────

function fmtSol(n: number): string {
  // Trim trailing zeros but keep it readable (0.2, 0.05, 1.25).
  return Number(n.toFixed(6)).toString();
}

/** One copy-paste line: amount first, FULL wallet, then context + payout id. */
function payoutLine(p: EnrichedPayout): string {
  return `#${p.id}  ${fmtSol(p.amountSol)} SOL → ${p.wallet}  (${p.label} · @${p.username})`;
}

/**
 * The per-window notification, copy-paste ready. Returns null when there are no
 * payouts → the caller sends NOTHING (silent on empty/zero-finisher windows).
 */
export function buildPayoutNotification(
  windowId: number,
  startsAt: string | null,
  payouts: readonly EnrichedPayout[],
): string | null {
  if (payouts.length === 0) return null;
  const total = payouts.reduce((s, p) => s + p.amountSol, 0);
  const when = startsAt ? new Date(startsAt).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "";
  const ids = payouts.map((p) => p.id).join(", ");
  return [
    `🏁 CHAINRIDER payouts — window #${windowId}`,
    `${when}  ·  send ${fmtSol(total)} SOL total`,
    "",
    ...payouts.map(payoutLine),
    "",
    `Reply: /paid <id> <txSig> for each once sent.`,
    `ids: ${ids}`,
  ].join("\n");
}

/** The /pending catch-up list (all unpaid payouts), same line format. */
export function buildPendingList(payouts: readonly EnrichedPayout[]): string {
  if (payouts.length === 0) return "No unpaid payouts. 🎉";
  const total = payouts.reduce((s, p) => s + p.amountSol, 0);
  return [
    `Unpaid payouts (${payouts.length}) — ${fmtSol(total)} SOL total`,
    "",
    ...payouts.map(payoutLine),
    "",
    `Reply: /paid <id> <txSig> for each once sent.`,
  ].join("\n");
}

export interface DailyWinnerInfo {
  payoutId: number;
  amountSol: number;
  wallet: string;
  label: string;
  username: string;
  score: number;
}

/** The daily-challenge winner announcement, copy-paste ready (same /paid flow). */
export function buildDailyWinnerNotification(w: DailyWinnerInfo): string {
  return [
    `🏆 DAILY CHALLENGE WINNER`,
    `${fmtSol(w.amountSol)} SOL → ${w.wallet}`,
    `(${w.label} · @${w.username} · score ${w.score})`,
    "",
    `Reply: /paid ${w.payoutId} <txSig> once sent.`,
  ].join("\n");
}

export interface PaidCommand {
  payoutId: number;
  txSig: string;
}

/**
 * Parse one or more `/paid <id> <txSig>` commands out of a message (one per
 * line). Ignores non-/paid lines and malformed entries; returns [] if none.
 */
export function parsePaidCommands(text: string): PaidCommand[] {
  const out: PaidCommand[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.trim().match(/^\/paid(?:@\w+)?\s+(\d+)\s+(\S+)\s*$/i);
    if (!m) continue;
    const payoutId = Number(m[1]);
    if (Number.isInteger(payoutId) && payoutId > 0) out.push({ payoutId, txSig: m[2] });
  }
  return out;
}

// ── Telegram I/O (built-in fetch) ───────────────────────────────────────────

/** POST sendMessage to the admin chat. No-op if unconfigured; never throws. */
export async function sendTelegramMessage(
  text: string,
  log?: FastifyInstance["log"],
): Promise<void> {
  const t = token();
  const chatId = adminId();
  if (!t || chatId === undefined) return;
  try {
    const res = await fetch(`${API}/bot${t}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
    if (!res.ok) log?.error({ status: res.status }, "telegram: sendMessage failed");
  } catch (err) {
    log?.error({ err }, "telegram: sendMessage threw");
  }
}

/** Enrich + build + send the per-window notification. Silent when no payouts. */
export async function notifyWindowClose(
  db: SupabaseClient,
  windowId: number,
  startsAt: string | null,
  log?: FastifyInstance["log"],
): Promise<void> {
  if (!tgConfigured()) return;
  let payouts: EnrichedPayout[];
  try {
    payouts = await fetchUnpaidPayouts(db, windowId);
  } catch (err) {
    log?.error({ err, windowId }, "telegram: failed to load window payouts");
    return;
  }
  const msg = buildPayoutNotification(windowId, startsAt, payouts);
  if (!msg) return; // zero payouts → silent
  await sendTelegramMessage(msg, log);
}

/** Announce a settled daily challenge's winner (the pending daily cr_payouts row). */
export async function notifyDailyWinner(
  db: SupabaseClient,
  dailyChallengeId: number,
  log?: FastifyInstance["log"],
): Promise<void> {
  if (!tgConfigured()) return;
  const { data: payout } = await db
    .from("cr_payouts")
    .select("id,amount_sol,cr_players(username,wallet_address),cr_tracks(tier,mode,cr_maps(symbol,period))")
    .eq("daily_challenge_id", dailyChallengeId)
    .eq("status", "pending")
    .maybeSingle();
  if (!payout) return;
  const { data: daily } = await db
    .from("cr_daily_challenges")
    .select("winner_score")
    .eq("id", dailyChallengeId)
    .maybeSingle();
  const row = payout as unknown as {
    id: number;
    amount_sol: number;
    cr_players: { username: string; wallet_address: string } | null;
    cr_tracks: { tier: string; mode: string; cr_maps: { symbol: string; period: string } | null } | null;
  };
  const t = row.cr_tracks;
  const label = t ? `${t.cr_maps?.symbol ?? "?"} ${t.cr_maps?.period ?? "?"} ${t.tier} · ${t.mode}` : "track";
  const msg = buildDailyWinnerNotification({
    payoutId: row.id,
    amountSol: Number(row.amount_sol),
    wallet: row.cr_players?.wallet_address ?? "—",
    username: row.cr_players?.username ?? "—",
    label,
    score: Number((daily?.winner_score as number | null) ?? 0),
  });
  await sendTelegramMessage(msg, log);
}

const SOLSCAN = "https://solscan.io/tx/";

/** Mark a payout paid from a /paid command; returns the reply text. */
export async function handlePaid(
  db: SupabaseClient,
  payoutId: number,
  txSig: string,
): Promise<string> {
  const r = await markPayoutPaid(db, payoutId, txSig);
  switch (r.status) {
    case "paid":
      return `✓ Paid ${fmtSol(r.amountSol)} SOL to @${r.username} — receipt posted\n${SOLSCAN}${r.txSig}`;
    case "bad_sig":
      return `✗ #${payoutId}: that doesn't look like a Solana tx signature (base58, 64 bytes).`;
    case "not_found":
      return `✗ #${payoutId}: no such payout.`;
    case "not_pending":
      return `✗ #${payoutId}: already ${r.current} (not pending) — nothing to do.`;
    case "error":
      return `✗ #${payoutId}: error — ${r.message}`;
  }
}

/** The /pending catch-up list. */
export async function handlePending(db: SupabaseClient): Promise<string> {
  const payouts = await fetchUnpaidPayouts(db);
  return buildPendingList(payouts);
}

// ── Long-poll loop (getUpdates) ─────────────────────────────────────────────

interface TgUpdate {
  update_id: number;
  message?: { from?: { id?: number }; text?: string };
}

async function dispatch(db: SupabaseClient, text: string, log: FastifyInstance["log"]): Promise<void> {
  const trimmed = text.trim();
  if (/^\/pending(?:@\w+)?\b/i.test(trimmed)) {
    await sendTelegramMessage(await handlePending(db), log);
    return;
  }
  const cmds = parsePaidCommands(trimmed);
  if (cmds.length > 0) {
    const replies: string[] = [];
    for (const c of cmds) replies.push(await handlePaid(db, c.payoutId, c.txSig));
    await sendTelegramMessage(replies.join("\n"), log);
    return;
  }
  if (/^\/start\b|^\/help\b/i.test(trimmed)) {
    await sendTelegramMessage(
      "CHAINRIDER payout bot.\n/pending — list unpaid payouts\n/paid <id> <txSig> — mark paid after you send SOL",
      log,
    );
  }
}

async function pollLoop(app: FastifyInstance): Promise<void> {
  const t = token()!;
  const admin = adminId()!;
  let offset = 0;

  // Skip any backlog accumulated while the bot was down: take the latest update
  // id and start after it (avoids replaying old commands / re-confirming).
  try {
    const res = await fetch(`${API}/bot${t}/getUpdates?offset=-1`);
    const json = (await res.json()) as { ok: boolean; result: TgUpdate[] };
    if (json.ok && json.result.length > 0) offset = json.result[json.result.length - 1].update_id + 1;
  } catch {
    /* ignore — start from 0 */
  }

  for (;;) {
    try {
      const res = await fetch(`${API}/bot${t}/getUpdates?timeout=30&offset=${offset}`);
      const json = (await res.json()) as { ok: boolean; result: TgUpdate[] };
      if (!json.ok) {
        await sleep(3000);
        continue;
      }
      for (const u of json.result) {
        offset = u.update_id + 1;
        const from = u.message?.from?.id;
        const text = u.message?.text;
        if (from !== admin || typeof text !== "string") continue; // ignore everyone else, silently
        try {
          await dispatch(getDb(), text, app.log);
        } catch (err) {
          app.log.error({ err }, "telegram: dispatch failed");
        }
      }
    } catch (err) {
      app.log.error({ err }, "telegram: getUpdates failed — backing off");
      await sleep(5000);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Start the bot if configured. Fire-and-forget (does not block listen). Like the
 * window engine: SINGLE INSTANCE ONLY (run one API process).
 */
export function startTelegramBot(app: FastifyInstance): void {
  if (!tgConfigured()) {
    app.log.info("telegram: disabled (TELEGRAM_BOT_TOKEN / TELEGRAM_ADMIN_USER_ID not set)");
    return;
  }
  // undici's happy-eyeballs aborts each connect attempt at 250ms by default,
  // which is shorter than the TCP handshake to api.telegram.org on some routes
  // (curl connects ~300ms; fetch then fails ETIMEDOUT). Raise it so getUpdates /
  // sendMessage can connect. Global, but only widening the tolerance.
  net.setDefaultAutoSelectFamilyAttemptTimeout(5000);
  app.log.info("telegram: payout bot started (single-instance only)");
  void pollLoop(app).catch((err) => app.log.error({ err }, "telegram: poll loop crashed"));
}
