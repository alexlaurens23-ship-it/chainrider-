import type { FastifyReply, FastifyRequest } from "fastify";
import jwt from "jsonwebtoken";

/**
 * Player-JWT primitives. Identity is a username + 4-digit PIN + a pasted Solana
 * payout address (see accounts.ts) — no passwords-over-email, no wallet signing.
 * The token simply carries who the authenticated player is. No private key ever
 * reaches the server; users only ever paste a public wallet address.
 */

/** JWT lifetime. The player re-logs in with their PIN to refresh. */
const TOKEN_TTL = "7d";

/** Authed-request shape the routes read after `requireAuth`. */
export interface PlayerClaims {
  playerId: string;
  username: string;
}

declare module "fastify" {
  interface FastifyRequest {
    player: PlayerClaims | null;
  }
}

function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET must be set");
  return secret;
}

export function signToken(claims: PlayerClaims): string {
  return jwt.sign(claims, jwtSecret(), { expiresIn: TOKEN_TTL });
}

export function verifyToken(token: string): PlayerClaims {
  const decoded = jwt.verify(token, jwtSecret());
  if (
    typeof decoded !== "object" ||
    decoded === null ||
    typeof (decoded as Record<string, unknown>).playerId !== "string" ||
    typeof (decoded as Record<string, unknown>).username !== "string"
  ) {
    throw new Error("malformed token payload");
  }
  const { playerId, username } = decoded as Record<string, string>;
  return { playerId, username };
}

/**
 * Fastify preHandler for player-JWT routes. Reads `Authorization: Bearer`,
 * verifies it, and attaches `req.player`. 401 on missing/invalid. Entirely
 * separate from the admin `X-Admin-Key` hook — the two never collide.
 */
export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return reply.code(401).send({ error: "missing bearer token" });
  }
  try {
    req.player = verifyToken(header.slice("Bearer ".length).trim());
  } catch {
    return reply.code(401).send({ error: "invalid token" });
  }
}

const USERNAME_RE = /^[a-z0-9_]{3,16}$/;

/** Usernames: 3–16 chars of lowercase letters, digits, underscore. */
export function validateUsername(username: unknown): { ok: true } | { ok: false; reason: string } {
  if (typeof username !== "string") return { ok: false, reason: "username required" };
  if (!USERNAME_RE.test(username)) {
    return { ok: false, reason: "username must be 3–16 chars of a–z, 0–9, _" };
  }
  return { ok: true };
}
