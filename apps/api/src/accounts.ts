import bcrypt from "bcryptjs";
import bs58 from "bs58";
import type { SupabaseClient } from "@supabase/supabase-js";
import { validateUsername } from "./auth.js";

/**
 * Account domain: username + 4-digit PIN + a pasted Solana payout address,
 * bound at signup. Pure validation + the brute-force lockout state machine live
 * here (no Fastify, repo injected) so they're unit-tested directly — mirroring
 * the runVerify.ts / payouts.ts pattern. The PIN is ONLY ever stored as a bcrypt
 * hash; plaintext never touches the DB or the logs. The wallet is validated as a
 * real 32-byte base58 pubkey, claimed once (DB unique index), and immutable.
 */

const BCRYPT_ROUNDS = 10;
/** Consecutive wrong PINs before an account locks. */
export const LOCK_MAX_FAILS = 5;
/** Base lockout duration; doubles per consecutive lockout (see evaluateLogin). */
export const LOCK_MS = 15 * 60 * 1000;
/** Cap the escalation exponent so the lock can't grow unbounded (64× ≈ 16h). */
export const LOCK_ESCALATION_CAP = 6;

// ── Validation ───────────────────────────────────────────────────────────────

/** Exactly 4 digits. */
export function validatePin(pin: unknown): boolean {
  return typeof pin === "string" && /^\d{4}$/.test(pin);
}

/** A syntactically valid Solana address: base58 that decodes to exactly 32 bytes. */
export function validateWalletAddress(addr: unknown): boolean {
  if (typeof addr !== "string" || addr.length < 32 || addr.length > 44) return false;
  try {
    return bs58.decode(addr).length === 32;
  } catch {
    return false;
  }
}

export async function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, BCRYPT_ROUNDS);
}

export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(pin, hash);
  } catch {
    return false;
  }
}

// ── Lockout state machine (pure) ─────────────────────────────────────────────

export interface LockState {
  failedAttempts: number;
  /** Epoch ms the lock lifts, or null if not locked. */
  lockedUntil: number | null;
  /** Consecutive lockouts (drives escalating backoff); resets on success. */
  lockoutCount?: number;
}

export type LoginDecision =
  | { kind: "locked"; retryMs: number }
  | { kind: "success" }
  | {
      kind: "wrong";
      failedAttempts: number;
      lockedUntil: number | null;
      lockoutCount: number;
      attemptsLeft: number;
    };

/**
 * Reference implementation of the lockout state machine — the SQL function
 * `cr_register_login_failure` (sql/006) MUST mirror this math. Given the stored
 * state, whether the PIN matched, and `now`, decide the outcome and the new
 * counters. An EXPIRED lock clears the in-window counter before judging; an
 * ACTIVE lock rejects even a correct PIN. Each consecutive lockout DOUBLES the
 * duration (15m → 30m → 60m …, capped) instead of resetting flat, to blunt the
 * 4-digit-PIN guess rate. Injecting `now` makes escalation/unlock testable.
 */
export function evaluateLogin(state: LockState, pinOk: boolean, now: number): LoginDecision {
  let failed = state.failedAttempts;
  let lockedUntil = state.lockedUntil;
  let lockoutCount = state.lockoutCount ?? 0;

  if (lockedUntil !== null && lockedUntil <= now) {
    lockedUntil = null;
    failed = 0;
  }
  if (lockedUntil !== null && lockedUntil > now) {
    return { kind: "locked", retryMs: lockedUntil - now };
  }
  if (pinOk) return { kind: "success" };

  failed += 1;
  if (failed >= LOCK_MAX_FAILS) {
    lockoutCount += 1;
    const duration = LOCK_MS * 2 ** Math.min(lockoutCount - 1, LOCK_ESCALATION_CAP);
    return { kind: "wrong", failedAttempts: 0, lockedUntil: now + duration, lockoutCount, attemptsLeft: 0 };
  }
  return {
    kind: "wrong",
    failedAttempts: failed,
    lockedUntil: null,
    lockoutCount,
    attemptsLeft: LOCK_MAX_FAILS - failed,
  };
}

// ── Repo (DB boundary; injected so the logic is testable with fakes) ─────────

export interface PlayerRow {
  id: string;
  username: string;
  pin_hash: string | null;
  banned: boolean;
  failed_attempts: number;
  locked_until: string | null;
  lockout_count?: number;
}

/** The post-increment lock state returned by the atomic failure registration. */
export interface FailureState {
  failedAttempts: number;
  /** Epoch ms the lock lifts, or null. */
  lockedUntil: number | null;
  lockoutCount: number;
}

export interface AccountRepo {
  findByUsername(username: string): Promise<PlayerRow | null>;
  usernameTaken(username: string): Promise<boolean>;
  walletClaimed(walletAddress: string): Promise<boolean>;
  createPlayer(p: {
    username: string;
    pinHash: string;
    walletAddress: string;
  }): Promise<{ id: string; username: string }>;
  /**
   * Atomically register one wrong-PIN attempt and return the new lock state.
   * MUST be a single indivisible read-increment-write (H1) so concurrent
   * failures can't lose updates and bypass the lockout. `now` is honored by the
   * test fake; the Supabase impl uses DB `now()`.
   */
  registerLoginFailure(playerId: string, now: number): Promise<FailureState>;
  /** Reset all lock counters on a successful login. */
  recordLoginSuccess(playerId: string): Promise<void>;
}

// ── Signup ───────────────────────────────────────────────────────────────────

export interface SignupInput {
  username: string;
  pin: string;
  walletAddress: string;
  walletAddressConfirm: string;
}
export type SignupResult =
  | { ok: true; playerId: string; username: string }
  | { ok: false; status: number; error: string };

export async function performSignup(repo: AccountRepo, input: SignupInput): Promise<SignupResult> {
  const username = typeof input.username === "string" ? input.username.toLowerCase() : input.username;
  const nameValid = validateUsername(username);
  if (!nameValid.ok) return { ok: false, status: 400, error: nameValid.reason };
  if (!validatePin(input.pin)) {
    return { ok: false, status: 400, error: "PIN must be exactly 4 digits" };
  }
  if (input.walletAddress !== input.walletAddressConfirm) {
    return { ok: false, status: 400, error: "wallet addresses do not match" };
  }
  if (!validateWalletAddress(input.walletAddress)) {
    return { ok: false, status: 400, error: "not a valid Solana wallet address" };
  }

  if (await repo.usernameTaken(username)) {
    return { ok: false, status: 409, error: "username taken" };
  }
  if (await repo.walletClaimed(input.walletAddress)) {
    return { ok: false, status: 409, error: "wallet already claimed by another account" };
  }

  const pinHash = await hashPin(input.pin);
  try {
    const created = await repo.createPlayer({
      username,
      pinHash,
      walletAddress: input.walletAddress,
    });
    return { ok: true, playerId: created.id, username: created.username };
  } catch {
    // Lost a uniqueness race (username or wallet claimed concurrently).
    return { ok: false, status: 409, error: "username or wallet already taken" };
  }
}

// ── Login ────────────────────────────────────────────────────────────────────

export interface LoginInput {
  username: string;
  pin: string;
}
export type LoginResult =
  | { ok: true; playerId: string; username: string }
  | { ok: false; status: number; error: string };

function lockMessage(retryMs: number): string {
  const minutes = Math.max(1, Math.ceil(retryMs / 60000));
  return `account locked — try again in ${minutes} min`;
}

export async function performLogin(
  repo: AccountRepo,
  input: LoginInput,
  now: number = Date.now(),
): Promise<LoginResult> {
  const username = typeof input.username === "string" ? input.username.toLowerCase() : input.username;
  const player = await repo.findByUsername(username);
  // Generic message — don't reveal whether the username exists.
  if (!player || !player.pin_hash) {
    return { ok: false, status: 401, error: "invalid username or PIN" };
  }
  if (player.banned) return { ok: false, status: 403, error: "account banned" };

  const lockedUntil = player.locked_until ? new Date(player.locked_until).getTime() : null;
  // Short-circuit an active lock without spending a bcrypt compare. (Advisory:
  // the atomic failure registration below is the authoritative gate.)
  if (lockedUntil !== null && lockedUntil > now) {
    return { ok: false, status: 423, error: lockMessage(lockedUntil - now) };
  }

  const pinOk = await verifyPin(input.pin, player.pin_hash);
  if (pinOk) {
    await repo.recordLoginSuccess(player.id);
    return { ok: true, playerId: player.id, username: player.username };
  }

  // Wrong PIN: hand the increment to an ATOMIC repo op (H1). We never compute the
  // new counter from the stale read above — concurrent failures must not be lost.
  const state = await repo.registerLoginFailure(player.id, now);
  if (state.lockedUntil !== null && state.lockedUntil > now) {
    return { ok: false, status: 423, error: lockMessage(state.lockedUntil - now) };
  }
  const attemptsLeft = Math.max(0, LOCK_MAX_FAILS - state.failedAttempts);
  return {
    ok: false,
    status: 401,
    error: `wrong PIN — ${attemptsLeft} attempt(s) left before lockout`,
  };
}

// ── Supabase-backed repo ─────────────────────────────────────────────────────

export function createSupabaseAccountRepo(db: SupabaseClient): AccountRepo {
  return {
    async findByUsername(username) {
      // Exact match on the stored (lowercased) username — NOT ilike, whose `_`
      // wildcard would let underscores over-match other accounts (M5).
      const { data } = await db
        .from("cr_players")
        .select("id, username, pin_hash, banned, failed_attempts, locked_until, lockout_count")
        .eq("username", username.toLowerCase())
        .maybeSingle();
      return (data as PlayerRow | null) ?? null;
    },
    async usernameTaken(username) {
      const { data } = await db
        .from("cr_players")
        .select("id")
        .eq("username", username.toLowerCase())
        .maybeSingle();
      return Boolean(data);
    },
    async walletClaimed(walletAddress) {
      const { data } = await db
        .from("cr_players")
        .select("id")
        .eq("wallet_address", walletAddress)
        .maybeSingle();
      return Boolean(data);
    },
    async createPlayer({ username, pinHash, walletAddress }) {
      const { data, error } = await db
        .from("cr_players")
        .insert({
          username,
          pin_hash: pinHash,
          wallet_address: walletAddress,
          banned: false,
          failed_attempts: 0,
          last_login_at: new Date().toISOString(),
        })
        .select("id, username")
        .single();
      if (error || !data) throw error ?? new Error("insert failed");
      return { id: data.id as string, username: data.username as string };
    },
    async registerLoginFailure(playerId) {
      // Atomic, row-locked increment+escalation in Postgres (sql/006). `now` is
      // the DB's; the param is honored only by the test fake.
      const { data, error } = await db.rpc("cr_register_login_failure", { p_id: playerId });
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as
        | { failed_attempts: number; locked_until: string | null; lockout_count: number }
        | undefined;
      if (!row) throw new Error("login-failure registration returned no row");
      return {
        failedAttempts: row.failed_attempts,
        lockedUntil: row.locked_until ? new Date(row.locked_until).getTime() : null,
        lockoutCount: row.lockout_count,
      };
    },
    async recordLoginSuccess(playerId) {
      await db
        .from("cr_players")
        .update({
          failed_attempts: 0,
          locked_until: null,
          lockout_count: 0,
          last_login_at: new Date().toISOString(),
        })
        .eq("id", playerId);
    },
  };
}
