import { randomBytes } from "node:crypto";
import bs58 from "bs58";
import { describe, expect, it } from "vitest";
import {
  LOCK_MAX_FAILS,
  LOCK_MS,
  evaluateLogin,
  hashPin,
  performLogin,
  performSignup,
  validatePin,
  validateWalletAddress,
  verifyPin,
  type AccountRepo,
  type PlayerRow,
} from "../src/accounts.js";

/** A syntactically valid Solana address (32 bytes base58). */
const VALID_WALLET = bs58.encode(randomBytes(32));
const OTHER_WALLET = bs58.encode(randomBytes(32));

/** A configurable in-memory AccountRepo for the logic tests. */
function fakeRepo(opts: {
  usernames?: Set<string>;
  wallets?: Set<string>;
  player?: PlayerRow;
  createThrows?: boolean;
}): AccountRepo & { created: { username: string; pinHash: string; walletAddress: string }[]; player?: PlayerRow } {
  const created: { username: string; pinHash: string; walletAddress: string }[] = [];
  const state = { player: opts.player };
  return {
    created,
    get player() {
      return state.player;
    },
    async usernameTaken(u) {
      return opts.usernames?.has(u.toLowerCase()) ?? false;
    },
    async walletClaimed(w) {
      return opts.wallets?.has(w) ?? false;
    },
    async findByUsername(u) {
      return state.player && state.player.username.toLowerCase() === u.toLowerCase()
        ? state.player
        : null;
    },
    async createPlayer(p) {
      if (opts.createThrows) throw new Error("unique violation");
      created.push(p);
      return { id: "new-id", username: p.username };
    },
    async recordLoginResult(_id, update) {
      if (state.player) {
        state.player.failed_attempts = update.failedAttempts;
        state.player.locked_until = update.lockedUntil;
      }
    },
  };
}

describe("validatePin", () => {
  it("accepts exactly 4 digits, rejects everything else", () => {
    expect(validatePin("1234")).toBe(true);
    expect(validatePin("0000")).toBe(true);
    expect(validatePin("123")).toBe(false);
    expect(validatePin("12345")).toBe(false);
    expect(validatePin("12a4")).toBe(false);
    expect(validatePin("")).toBe(false);
    expect(validatePin(1234 as unknown)).toBe(false);
  });
});

describe("validateWalletAddress", () => {
  it("accepts a real 32-byte base58 pubkey", () => {
    expect(validateWalletAddress(VALID_WALLET)).toBe(true);
  });
  it("rejects too short, non-base58, and wrong byte-length", () => {
    expect(validateWalletAddress("abc")).toBe(false);
    // 40 chars but '0','O','I','l' are not in the base58 alphabet → decode throws.
    expect(validateWalletAddress("0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl")).toBe(false);
    // Valid base58, in the length window, but decodes to 31 bytes (not 32).
    expect(validateWalletAddress(bs58.encode(randomBytes(31)))).toBe(false);
    expect(validateWalletAddress(123 as unknown)).toBe(false);
  });
});

describe("performSignup", () => {
  const base = {
    username: "rider_1",
    pin: "1234",
    walletAddress: VALID_WALLET,
    walletAddressConfirm: VALID_WALLET,
  };

  it("rejects a taken username", async () => {
    const repo = fakeRepo({ usernames: new Set(["rider_1"]) });
    const res = await performSignup(repo, base);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(409);
  });

  it("rejects a re-used wallet", async () => {
    const repo = fakeRepo({ wallets: new Set([VALID_WALLET]) });
    const res = await performSignup(repo, base);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/wallet/i);
  });

  it("rejects a malformed wallet", async () => {
    const repo = fakeRepo({});
    const res = await performSignup(repo, {
      ...base,
      walletAddress: "not-a-wallet",
      walletAddressConfirm: "not-a-wallet",
    });
    expect(res.ok).toBe(false);
  });

  it("rejects a mismatched wallet confirm", async () => {
    const repo = fakeRepo({});
    const res = await performSignup(repo, { ...base, walletAddressConfirm: OTHER_WALLET });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/match/i);
  });

  it("rejects a non-4-digit PIN", async () => {
    const repo = fakeRepo({});
    const res = await performSignup(repo, { ...base, pin: "12" });
    expect(res.ok).toBe(false);
  });

  it("happy path stores a bcrypt hash, never the plaintext PIN", async () => {
    const repo = fakeRepo({});
    const res = await performSignup(repo, base);
    expect(res.ok).toBe(true);
    expect(repo.created).toHaveLength(1);
    const stored = repo.created[0].pinHash;
    // Never the plaintext, and a real bcrypt hash that verifies.
    expect(stored).not.toBe("1234");
    expect(stored).toMatch(/^\$2[aby]\$/);
    expect(await verifyPin("1234", stored)).toBe(true);
    expect(await verifyPin("0000", stored)).toBe(false);
  });

  it("maps a create-time uniqueness race to 409", async () => {
    const repo = fakeRepo({ createThrows: true });
    const res = await performSignup(repo, base);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(409);
  });
});

describe("evaluateLogin (pure lockout state machine)", () => {
  const t0 = 1_000_000;

  it("locks on the 5th consecutive wrong PIN", () => {
    let state = { failedAttempts: 0, lockedUntil: null as number | null };
    for (let i = 1; i < LOCK_MAX_FAILS; i++) {
      const d = evaluateLogin(state, false, t0);
      expect(d.kind).toBe("wrong");
      if (d.kind === "wrong") {
        expect(d.lockedUntil).toBeNull();
        state = { failedAttempts: d.failedAttempts, lockedUntil: d.lockedUntil };
      }
    }
    const fifth = evaluateLogin(state, false, t0);
    expect(fifth.kind).toBe("wrong");
    if (fifth.kind === "wrong") {
      expect(fifth.attemptsLeft).toBe(0);
      expect(fifth.lockedUntil).toBe(t0 + LOCK_MS);
    }
  });

  it("rejects even a correct PIN while the lock is active", () => {
    const locked = { failedAttempts: 5, lockedUntil: t0 + LOCK_MS };
    expect(evaluateLogin(locked, true, t0 + 60_000).kind).toBe("locked");
  });

  it("unlocks after the window — a correct PIN then succeeds", () => {
    const locked = { failedAttempts: 5, lockedUntil: t0 + LOCK_MS };
    expect(evaluateLogin(locked, true, t0 + LOCK_MS + 1).kind).toBe("success");
  });

  it("success resets (no lock, clean state)", () => {
    expect(evaluateLogin({ failedAttempts: 3, lockedUntil: null }, true, t0).kind).toBe("success");
  });
});

describe("performLogin (end-to-end with a fake repo + injected time)", () => {
  async function makePlayer(): Promise<PlayerRow> {
    return {
      id: "p1",
      username: "rider_1",
      pin_hash: await hashPin("1234"),
      banned: false,
      failed_attempts: 0,
      locked_until: null,
    };
  }

  it("locks after 5 wrong PINs, then unlocks after the window", async () => {
    const repo = fakeRepo({ player: await makePlayer() });
    const t0 = 5_000_000;

    for (let i = 0; i < LOCK_MAX_FAILS; i++) {
      const res = await performLogin(repo, { username: "rider_1", pin: "9999" }, t0);
      expect(res.ok).toBe(false);
    }
    // Now locked: even the correct PIN is rejected within the window.
    const duringLock = await performLogin(repo, { username: "rider_1", pin: "1234" }, t0 + 60_000);
    expect(duringLock.ok).toBe(false);
    if (!duringLock.ok) expect(duringLock.status).toBe(423);

    // After the window, the correct PIN succeeds and counters reset.
    const afterLock = await performLogin(repo, { username: "rider_1", pin: "1234" }, t0 + LOCK_MS + 1);
    expect(afterLock.ok).toBe(true);
    expect(repo.player?.failed_attempts).toBe(0);
    expect(repo.player?.locked_until).toBeNull();
  });

  it("a correct PIN on a fresh account succeeds", async () => {
    const repo = fakeRepo({ player: await makePlayer() });
    const res = await performLogin(repo, { username: "rider_1", pin: "1234" }, 1);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.username).toBe("rider_1");
  });

  it("an unknown username gives a generic 401 (no enumeration)", async () => {
    const repo = fakeRepo({});
    const res = await performLogin(repo, { username: "ghost", pin: "1234" }, 1);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(401);
      expect(res.error).toMatch(/invalid username or PIN/i);
    }
  });

  it("a banned account is rejected", async () => {
    const player = await makePlayer();
    player.banned = true;
    const repo = fakeRepo({ player });
    const res = await performLogin(repo, { username: "rider_1", pin: "1234" }, 1);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(403);
  });
});
