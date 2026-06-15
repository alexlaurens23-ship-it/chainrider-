import type { FastifyPluginAsync } from "fastify";
import {
  createSupabaseAccountRepo,
  performLogin,
  performSignup,
  type LoginInput,
  type SignupInput,
} from "../accounts.js";
import { signToken } from "../auth.js";
import { getDb } from "../db.js";

/** Per-IP login throttle so one host can't spray PINs across many usernames. */
const IP_MAX_ATTEMPTS = 20;
const IP_WINDOW_MS = 15 * 60 * 1000;
const ipAttempts = new Map<string, { count: number; resetAt: number }>();

function ipThrottled(ip: string, now: number): boolean {
  const entry = ipAttempts.get(ip);
  if (!entry || entry.resetAt <= now) {
    ipAttempts.set(ip, { count: 1, resetAt: now + IP_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > IP_MAX_ATTEMPTS;
}

const signupSchema = {
  type: "object",
  required: ["username", "pin", "walletAddress", "walletAddressConfirm"],
  properties: {
    username: { type: "string", minLength: 3, maxLength: 16 },
    pin: { type: "string", pattern: "^\\d{4}$" },
    walletAddress: { type: "string", minLength: 32, maxLength: 44 },
    walletAddressConfirm: { type: "string", minLength: 32, maxLength: 44 },
  },
} as const;

const loginSchema = {
  type: "object",
  required: ["username", "pin"],
  properties: {
    username: { type: "string", minLength: 3, maxLength: 16 },
    pin: { type: "string", pattern: "^\\d{4}$" },
  },
} as const;

/**
 * Username + 4-digit PIN + Solana payout address accounts. No wallet signing,
 * no email. The wallet is claimed once and permanently immutable; the PIN is
 * bcrypt-hashed and brute-force-locked (see accounts.ts).
 */
export const authRoutes: FastifyPluginAsync = async (app) => {
  // 1. Create an account (binds username + PIN + wallet) and issue a JWT.
  app.post<{ Body: SignupInput }>(
    "/signup",
    { schema: { body: signupSchema } },
    async (req, reply) => {
      const repo = createSupabaseAccountRepo(getDb());
      const result = await performSignup(repo, req.body);
      if (!result.ok) return reply.code(result.status).send({ error: result.error });
      return {
        token: signToken({ playerId: result.playerId, username: result.username }),
        username: result.username,
      };
    },
  );

  // 2. Log in with username + PIN. Per-IP throttle + per-account lockout.
  app.post<{ Body: LoginInput }>("/login", { schema: { body: loginSchema } }, async (req, reply) => {
    if (ipThrottled(req.ip, Date.now())) {
      return reply.code(429).send({ error: "too many login attempts — try again later" });
    }
    const repo = createSupabaseAccountRepo(getDb());
    const result = await performLogin(repo, req.body);
    if (!result.ok) return reply.code(result.status).send({ error: result.error });
    return {
      token: signToken({ playerId: result.playerId, username: result.username }),
      username: result.username,
    };
  });
};
