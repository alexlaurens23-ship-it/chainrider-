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
/** Lockout duration once tripped. */
export const LOCK_MS = 15 * 60 * 1000;

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
}

export type LoginDecision =
  | { kind: "locked"; retryMs: number }
  | { kind: "success" }
  | { kind: "wrong"; failedAttempts: number; lockedUntil: number | null; attemptsLeft: number };

/**
 * Given the stored lock state, whether the PIN matched, and `now`, decide the
 * outcome and the new counters. An EXPIRED lock clears to zero before judging,
 * so a correct PIN after the window succeeds; an ACTIVE lock rejects even a
 * correct PIN (locked means locked). Injecting `now` makes unlock testable
 * without waiting 15 minutes.
 */
export function evaluateLogin(state: LockState, pinOk: boolean, now: number): LoginDecision {
  let failed = state.failedAttempts;
  let lockedUntil = state.lockedUntil;

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
    return { kind: "wrong", failedAttempts: failed, lockedUntil: now + LOCK_MS, attemptsLeft: 0 };
  }
  return { kind: "wrong", failedAttempts: failed, lockedUntil: null, attemptsLeft: LOCK_MAX_FAILS - failed };
}

// ── Repo (DB boundary; injected so the logic is testable with fakes) ─────────

export interface PlayerRow {
  id: string;
  username: string;
  pin_hash: string | null;
  banned: boolean;
  failed_attempts: number;
  locked_until: string | null;
}

export interface LoginResultUpdate {
  failedAttempts: number;
  /** ISO string or null. */
  lockedUntil: string | null;
  /** Stamp last_login_at on success. */
  success: boolean;
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
  recordLoginResult(playerId: string, update: LoginResultUpdate): Promise<void>;
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
  // Short-circuit an active lock without spending a bcrypt compare.
  if (lockedUntil !== null && lockedUntil > now) {
    return { ok: false, status: 423, error: lockMessage(lockedUntil - now) };
  }

  const pinOk = await verifyPin(input.pin, player.pin_hash);
  const decision = evaluateLogin(
    { failedAttempts: player.failed_attempts ?? 0, lockedUntil },
    pinOk,
    now,
  );

  if (decision.kind === "success") {
    await repo.recordLoginResult(player.id, { failedAttempts: 0, lockedUntil: null, success: true });
    return { ok: true, playerId: player.id, username: player.username };
  }
  if (decision.kind === "locked") {
    return { ok: false, status: 423, error: lockMessage(decision.retryMs) };
  }
  // wrong
  await repo.recordLoginResult(player.id, {
    failedAttempts: decision.failedAttempts,
    lockedUntil: decision.lockedUntil ? new Date(decision.lockedUntil).toISOString() : null,
    success: false,
  });
  if (decision.lockedUntil !== null) {
    return { ok: false, status: 423, error: lockMessage(decision.lockedUntil - now) };
  }
  return {
    ok: false,
    status: 401,
    error: `wrong PIN — ${decision.attemptsLeft} attempt(s) left before lockout`,
  };
}

// ── Supabase-backed repo ─────────────────────────────────────────────────────

export function createSupabaseAccountRepo(db: SupabaseClient): AccountRepo {
  return {
    async findByUsername(username) {
      const { data } = await db
        .from("cr_players")
        .select("id, username, pin_hash, banned, failed_attempts, locked_until")
        .ilike("username", username)
        .maybeSingle();
      return (data as PlayerRow | null) ?? null;
    },
    async usernameTaken(username) {
      const { data } = await db
        .from("cr_players")
        .select("id")
        .ilike("username", username)
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
    async recordLoginResult(playerId, update) {
      const patch: Record<string, unknown> = {
        failed_attempts: update.failedAttempts,
        locked_until: update.lockedUntil,
      };
      if (update.success) patch.last_login_at = new Date().toISOString();
      await db.from("cr_players").update(patch).eq("id", playerId);
    },
  };
}
