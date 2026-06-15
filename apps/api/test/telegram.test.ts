import bs58 from "bs58";
import { describe, expect, it } from "vitest";
import { isValidSolanaSig, markPayoutPaid } from "../src/payoutOps.js";
import {
  buildPayoutNotification,
  buildPendingList,
  handlePaid,
  parsePaidCommands,
} from "../src/telegram.js";
import type { EnrichedPayout } from "../src/payoutOps.js";

const SAMPLE: EnrichedPayout[] = [
  { id: 1, windowId: 22, rank: 1, amountSol: 0.2, wallet: "DqW8mpYYp4h7UBqgeEETqgfKPWqGcTbkuHgUyCukL73d", username: "axle", label: "POPCAT 3M SAVAGE · raw" },
  { id: 2, windowId: 22, rank: 10, amountSol: 0.05, wallet: "5Xy9qZ2bN1Fde8tWcVuMabcdefghijkmnopqrstuvwx", username: "rider2", label: "SOL 3M DEGEN · raw" },
];

/** A valid 64-byte base58 signature, and a too-short 32-byte one. */
const GOOD_SIG = bs58.encode(new Uint8Array(64).fill(7));
const SHORT_SIG = bs58.encode(new Uint8Array(32).fill(7));

describe("buildPayoutNotification", () => {
  it("is null (silent) when there are no payouts", () => {
    expect(buildPayoutNotification(22, new Date().toISOString(), [])).toBeNull();
  });

  it("builds a copy-paste-ready message with window#, total, full wallets, ids, and the /paid instruction", () => {
    const msg = buildPayoutNotification(22, "2026-06-15T15:30:00.000Z", SAMPLE)!;
    expect(msg).toContain("window #22");
    // total = 0.2 + 0.05 = 0.25
    expect(msg).toContain("0.25 SOL total");
    // amount-first, FULL wallet on the line, label + @user, payout id reference
    expect(msg).toContain("#1  0.2 SOL → DqW8mpYYp4h7UBqgeEETqgfKPWqGcTbkuHgUyCukL73d  (POPCAT 3M SAVAGE · raw · @axle)");
    expect(msg).toContain("#2  0.05 SOL → 5Xy9qZ2bN1Fde8tWcVuMabcdefghijkmnopqrstuvwx  (SOL 3M DEGEN · raw · @rider2)");
    expect(msg).toContain("/paid <id> <txSig>");
    expect(msg).toContain("ids: 1, 2");
  });
});

describe("buildPendingList", () => {
  it("summarizes unpaid payouts", () => {
    const msg = buildPendingList(SAMPLE);
    expect(msg).toContain("Unpaid payouts (2) — 0.25 SOL total");
    expect(msg).toContain("DqW8mpYYp4h7UBqgeEETqgfKPWqGcTbkuHgUyCukL73d");
  });
  it("says so when there's nothing unpaid", () => {
    expect(buildPendingList([])).toContain("No unpaid payouts");
  });
});

describe("parsePaidCommands", () => {
  it("parses a single /paid command", () => {
    expect(parsePaidCommands(`/paid 5 ${GOOD_SIG}`)).toEqual([{ payoutId: 5, txSig: GOOD_SIG }]);
  });
  it("parses several /paid lines in one message", () => {
    const out = parsePaidCommands(`/paid 1 ${GOOD_SIG}\n/paid 2 ${SHORT_SIG}\nthanks`);
    expect(out).toEqual([
      { payoutId: 1, txSig: GOOD_SIG },
      { payoutId: 2, txSig: SHORT_SIG },
    ]);
  });
  it("ignores junk / non-commands", () => {
    expect(parsePaidCommands("hello there")).toEqual([]);
    expect(parsePaidCommands("/pending")).toEqual([]);
    expect(parsePaidCommands("/paid notanumber abc")).toEqual([]);
  });
});

describe("isValidSolanaSig", () => {
  it("accepts a 64-byte base58 signature", () => {
    expect(isValidSolanaSig(GOOD_SIG)).toBe(true);
  });
  it("rejects wrong length, non-base58, and non-strings", () => {
    expect(isValidSolanaSig(SHORT_SIG)).toBe(false); // 32 bytes, not 64
    expect(isValidSolanaSig("not base58 0OIl")).toBe(false);
    expect(isValidSolanaSig("")).toBe(false);
    expect(isValidSolanaSig(12345)).toBe(false);
  });
});

// ── markPayoutPaid against a minimal fake Supabase client ───────────────────
interface FakeOpts {
  payout: Record<string, unknown> | null;
  updateError?: { message: string } | null;
}
function fakeDb(opts: FakeOpts): any {
  return {
    from() {
      const chain: any = {
        select: () => chain,
        update: () => chain,
        eq: () => chain,
        maybeSingle: () => Promise.resolve({ data: opts.payout, error: null }),
        // update chain is awaited directly (thenable) → { error }
        then: (resolve: (v: { error: unknown }) => unknown) =>
          Promise.resolve({ error: opts.updateError ?? null }).then(resolve),
      };
      return chain;
    },
  };
}

const PENDING_ROW = {
  id: 1,
  window_id: 22,
  rank: 1,
  amount_sol: 0.05,
  status: "pending",
  cr_players: { username: "axle", wallet_address: "DqW8mpYY" },
  cr_tracks: { tier: "DEGEN", mode: "raw", cr_maps: { symbol: "SOL", period: "3M" } },
};

describe("markPayoutPaid", () => {
  it("marks a pending payout paid and returns its details", async () => {
    const r = await markPayoutPaid(fakeDb({ payout: PENDING_ROW }), 1, GOOD_SIG);
    expect(r.status).toBe("paid");
    if (r.status === "paid") {
      expect(r.amountSol).toBe(0.05);
      expect(r.username).toBe("axle");
      expect(r.label).toBe("SOL 3M DEGEN · raw");
      expect(r.txSig).toBe(GOOD_SIG);
    }
  });
  it("rejects a bad signature before touching the row", async () => {
    expect((await markPayoutPaid(fakeDb({ payout: PENDING_ROW }), 1, "nope")).status).toBe("bad_sig");
    expect((await markPayoutPaid(fakeDb({ payout: PENDING_ROW }), 1, SHORT_SIG)).status).toBe("bad_sig");
  });
  it("returns not_found when the payout doesn't exist", async () => {
    expect((await markPayoutPaid(fakeDb({ payout: null }), 99, GOOD_SIG)).status).toBe("not_found");
  });
  it("returns not_pending when already paid", async () => {
    const r = await markPayoutPaid(fakeDb({ payout: { ...PENDING_ROW, status: "paid" } }), 1, GOOD_SIG);
    expect(r.status).toBe("not_pending");
    if (r.status === "not_pending") expect(r.current).toBe("paid");
  });
});

describe("handlePaid (reply text)", () => {
  it("confirms with the solscan receipt link", async () => {
    const text = await handlePaid(fakeDb({ payout: PENDING_ROW }), 1, GOOD_SIG);
    expect(text).toContain("✓ Paid 0.05 SOL to @axle");
    expect(text).toContain(`https://solscan.io/tx/${GOOD_SIG}`);
  });
  it("explains a non-pending payout", async () => {
    const text = await handlePaid(fakeDb({ payout: { ...PENDING_ROW, status: "skipped" } }), 1, GOOD_SIG);
    expect(text).toContain("already skipped");
  });
});
