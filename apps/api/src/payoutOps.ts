import bs58 from "bs58";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Shared payout operations over Supabase — the SINGLE source of truth for
 * marking a payout paid and for reading unpaid payouts with the display fields
 * (wallet, username, track label). Used by BOTH the admin web route
 * (routes/adminPayouts.ts) and the Telegram bot (telegram.ts), so the two can
 * never drift. No private keys, no SOL movement — only reads payout rows and
 * writes status / tx_sig.
 */

/** A solana tx signature is 64 bytes, base58-encoded. */
export function isValidSolanaSig(sig: unknown): boolean {
  if (typeof sig !== "string") return false;
  try {
    return bs58.decode(sig.trim()).length === 64;
  } catch {
    return false;
  }
}

/** A pending payout with everything needed to send SOL + reference it back. */
export interface EnrichedPayout {
  id: number;
  windowId: number;
  rank: number;
  amountSol: number;
  wallet: string;
  username: string;
  /** "SOL 3M DEGEN · raw" */
  label: string;
}

interface PayoutJoinRow {
  id: number;
  window_id: number;
  rank: number;
  amount_sol: number;
  status?: string;
  cr_players: { username: string; wallet_address: string } | null;
  cr_tracks: { tier: string; mode: string; cr_maps: { symbol: string; period: string } | null } | null;
}

const PAYOUT_SELECT =
  "id,window_id,rank,amount_sol,status," +
  "cr_players(username,wallet_address)," +
  "cr_tracks(tier,mode,cr_maps(symbol,period))";

function labelOf(t: PayoutJoinRow["cr_tracks"]): string {
  return t ? `${t.cr_maps?.symbol ?? "?"} ${t.cr_maps?.period ?? "?"} ${t.tier} · ${t.mode}` : "track";
}

function toEnriched(r: PayoutJoinRow): EnrichedPayout {
  return {
    id: r.id,
    windowId: r.window_id,
    rank: r.rank,
    amountSol: Number(r.amount_sol),
    wallet: r.cr_players?.wallet_address ?? "—",
    username: r.cr_players?.username ?? "—",
    label: labelOf(r.cr_tracks),
  };
}

/**
 * All unpaid (pending) payouts, newest window first then by rank. Pass a
 * windowId to restrict to one window (used for the per-close notification).
 */
export async function fetchUnpaidPayouts(
  db: SupabaseClient,
  windowId?: number,
): Promise<EnrichedPayout[]> {
  let q = db
    .from("cr_payouts")
    .select(PAYOUT_SELECT)
    .eq("status", "pending")
    .order("window_id", { ascending: false })
    .order("rank", { ascending: true });
  if (windowId != null) q = q.eq("window_id", windowId);
  const { data, error } = await q;
  if (error) throw error;
  return ((data ?? []) as unknown as PayoutJoinRow[]).map(toEnriched);
}

export type MarkPaidResult =
  | { status: "paid"; amountSol: number; username: string; label: string; txSig: string }
  | { status: "not_found" }
  | { status: "not_pending"; current: string }
  | { status: "bad_sig" }
  | { status: "error"; message: string };

/**
 * Mark one payout paid: validate the sig, that the payout exists and is still
 * pending, then record status='paid' + tx_sig + paid_at. Idempotent-safe (a
 * second call on an already-paid row returns 'not_pending', never double-writes).
 * The public #/payouts receipt appears automatically once status flips to paid.
 */
export async function markPayoutPaid(
  db: SupabaseClient,
  payoutId: number,
  txSig: string,
): Promise<MarkPaidResult> {
  if (!isValidSolanaSig(txSig)) return { status: "bad_sig" };
  const sig = txSig.trim();

  const { data, error } = await db
    .from("cr_payouts")
    .select(PAYOUT_SELECT)
    .eq("id", payoutId)
    .maybeSingle();
  if (error) return { status: "error", message: error.message };
  if (!data) return { status: "not_found" };
  const row = data as unknown as PayoutJoinRow;
  if (row.status !== "pending") return { status: "not_pending", current: row.status ?? "unknown" };

  const upd = await db
    .from("cr_payouts")
    .update({ status: "paid", tx_sig: sig, paid_at: new Date().toISOString() })
    .eq("id", payoutId)
    .eq("status", "pending");
  if (upd.error) return { status: "error", message: upd.error.message };

  const e = toEnriched(row);
  return { status: "paid", amountSol: e.amountSol, username: e.username, label: e.label, txSig: sig };
}
