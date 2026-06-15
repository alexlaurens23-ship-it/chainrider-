import type { FastifyPluginAsync } from "fastify";
import { getDb } from "../db.js";

/**
 * Owner payout admin (X-Admin-Key gated, separate from player JWT). Lists
 * pending payouts with wallet + amount for manual SOL sends, records tx sigs /
 * skips, surfaces flagged runs for review, and shows window history. Private
 * keys never touch the server — the owner sends from their own wallet and pastes
 * back only the public tx signature.
 */
export const adminPayoutsRoutes: FastifyPluginAsync = async (app) => {
  // Same fail-closed gate as routes/admin.ts; an unset ADMIN_KEY rejects all.
  app.addHook("onRequest", async (req, reply) => {
    const key = process.env.ADMIN_KEY;
    if (!key || req.headers["x-admin-key"] !== key) {
      return reply.code(401).send({ error: "unauthorized" });
    }
  });

  const labelOf = (t: {
    tier: string;
    mode: string;
    cr_maps: { symbol: string; period: string } | null;
  } | null): string =>
    t ? `${t.cr_maps?.symbol ?? "?"} ${t.cr_maps?.period ?? "?"} ${t.tier} · ${t.mode}` : "track";

  // ── Pending payouts (grouped client-side by window → track) ─────────────
  app.get("/payouts/pending", async (_req, reply) => {
    const db = getDb();
    const { data, error } = await db
      .from("cr_payouts")
      .select(
        "id,window_id,track_id,run_id,rank,amount_sol,created_at," +
          "cr_players(username,wallet_address)," +
          "cr_tracks(tier,mode,cr_maps(symbol,period))," +
          "cr_payout_windows(starts_at,ends_at)",
      )
      .eq("status", "pending")
      .order("window_id", { ascending: false })
      .order("rank", { ascending: true });
    if (error) {
      app.log.error(error, "admin pending payouts query failed");
      return reply.code(500).send({ error: "database error" });
    }
    const rows = (data ?? []) as unknown as {
      id: number;
      window_id: number;
      track_id: number;
      run_id: number;
      rank: number;
      amount_sol: number;
      created_at: string;
      cr_players: { username: string; wallet_address: string } | null;
      cr_tracks: { tier: string; mode: string; cr_maps: { symbol: string; period: string } | null } | null;
      cr_payout_windows: { starts_at: string; ends_at: string } | null;
    }[];
    const payouts = rows.map((r) => ({
      id: r.id,
      windowId: r.window_id,
      windowStartsAt: r.cr_payout_windows?.starts_at ?? null,
      trackId: r.track_id,
      runId: r.run_id,
      rank: r.rank,
      amountSol: Number(r.amount_sol),
      username: r.cr_players?.username ?? "—",
      wallet: r.cr_players?.wallet_address ?? "—",
      label: labelOf(r.cr_tracks),
    }));
    const totalSol = payouts.reduce((s, p) => s + p.amountSol, 0);
    return { totalSol: Number(totalSol.toFixed(6)), payouts };
  });

  // ── Mark a payout paid (record the on-chain tx signature) ───────────────
  app.post<{ Params: { id: string }; Body: { txSig: string } }>(
    "/payouts/:id/paid",
    {
      schema: {
        params: { type: "object", required: ["id"], properties: { id: { type: "string", pattern: "^[0-9]+$" } } },
        body: { type: "object", required: ["txSig"], properties: { txSig: { type: "string", minLength: 32, maxLength: 128 } } },
      },
    },
    async (req, reply) => {
      const db = getDb();
      const { error } = await db
        .from("cr_payouts")
        .update({ status: "paid", tx_sig: req.body.txSig, paid_at: new Date().toISOString() })
        .eq("id", Number(req.params.id))
        .eq("status", "pending");
      if (error) return reply.code(500).send({ error: "could not record payment" });
      return { ok: true };
    },
  );

  // ── Skip a payout (suspected cheat, dust, etc.) ─────────────────────────
  app.post<{ Params: { id: string }; Body: { reason: string } }>(
    "/payouts/:id/skip",
    {
      schema: {
        params: { type: "object", required: ["id"], properties: { id: { type: "string", pattern: "^[0-9]+$" } } },
        body: { type: "object", required: ["reason"], properties: { reason: { type: "string", minLength: 1, maxLength: 280 } } },
      },
    },
    async (req, reply) => {
      const db = getDb();
      const { error } = await db
        .from("cr_payouts")
        .update({ status: "skipped", skip_reason: req.body.reason })
        .eq("id", Number(req.params.id))
        .eq("status", "pending");
      if (error) return reply.code(500).send({ error: "could not skip payout" });
      return { ok: true };
    },
  );

  // ── Flagged runs for review (held; never auto-paid) ─────────────────────
  app.get("/runs/flagged", async (_req, reply) => {
    const db = getDb();
    const { data, error } = await db
      .from("cr_runs")
      .select(
        "id,client_score,server_score,time_ms,created_at,window_id," +
          "cr_players(username),cr_tracks(tier,mode,cr_maps(symbol,period))",
      )
      .eq("verify_status", "flagged")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) {
      app.log.error(error, "admin flagged runs query failed");
      return reply.code(500).send({ error: "database error" });
    }
    return ((data ?? []) as unknown as {
      id: number;
      client_score: number;
      server_score: number | null;
      time_ms: number;
      created_at: string;
      window_id: number | null;
      cr_players: { username: string } | null;
      cr_tracks: { tier: string; mode: string; cr_maps: { symbol: string; period: string } | null } | null;
    }[]).map((r) => ({
      runId: r.id,
      username: r.cr_players?.username ?? "—",
      clientScore: r.client_score,
      serverScore: r.server_score,
      timeMs: r.time_ms,
      createdAt: r.created_at,
      windowId: r.window_id,
      label: labelOf(r.cr_tracks),
    }));
  });

  // ── Clear a flag: approve (→verified, eligible) or reject (→failed) ──────
  const idParam = {
    params: { type: "object", required: ["id"], properties: { id: { type: "string", pattern: "^[0-9]+$" } } },
  } as const;

  async function clearFlag(id: number, status: "verified" | "failed"): Promise<boolean> {
    const db = getDb();
    const { error } = await db
      .from("cr_runs")
      .update({ verify_status: status })
      .eq("id", id)
      .eq("verify_status", "flagged");
    return !error;
  }

  app.post<{ Params: { id: string } }>("/runs/:id/approve", { schema: idParam }, async (req, reply) => {
    if (!(await clearFlag(Number(req.params.id), "verified"))) {
      return reply.code(500).send({ error: "could not update run" });
    }
    return { ok: true };
  });
  app.post<{ Params: { id: string } }>("/runs/:id/reject", { schema: idParam }, async (req, reply) => {
    if (!(await clearFlag(Number(req.params.id), "failed"))) {
      return reply.code(500).send({ error: "could not update run" });
    }
    return { ok: true };
  });

  // ── Window history (totals + unpaid counts) ─────────────────────────────
  app.get("/windows", async (_req, reply) => {
    const db = getDb();
    const { data: windows, error } = await db
      .from("cr_payout_windows")
      .select("id,starts_at,ends_at,status")
      .order("starts_at", { ascending: false })
      .limit(48);
    if (error) {
      app.log.error(error, "admin windows query failed");
      return reply.code(500).send({ error: "database error" });
    }
    const ids = (windows ?? []).map((w) => w.id as number);
    const { data: payouts } = await db
      .from("cr_payouts")
      .select("window_id,amount_sol,status")
      .in("window_id", ids.length ? ids : [-1]);
    const agg = new Map<number, { total: number; pending: number; paid: number }>();
    for (const p of (payouts ?? []) as { window_id: number; amount_sol: number; status: string }[]) {
      const a = agg.get(p.window_id) ?? { total: 0, pending: 0, paid: 0 };
      a.total += Number(p.amount_sol);
      if (p.status === "pending") a.pending += 1;
      if (p.status === "paid") a.paid += 1;
      agg.set(p.window_id, a);
    }
    return (windows ?? []).map((w) => {
      const a = agg.get(w.id as number) ?? { total: 0, pending: 0, paid: 0 };
      return {
        id: w.id,
        startsAt: w.starts_at,
        endsAt: w.ends_at,
        status: w.status,
        totalSol: Number(a.total.toFixed(6)),
        pendingCount: a.pending,
        paidCount: a.paid,
      };
    });
  });
};
