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

/** Minimum JWT secret length (chars) — a weak secret means forgeable tokens. */
export const MIN_JWT_SECRET_LEN = 32;

function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < MIN_JWT_SECRET_LEN) {
    throw new Error(`JWT_SECRET must be set and at least ${MIN_JWT_SECRET_LEN} chars`);
  }
  return secret;
}

/**
 * Fail-fast guard called at boot: refuse to start with a blank/weak JWT secret
 * (a weak HS256 secret is brute-forceable → token forgery → full impersonation).
 */
export function assertJwtSecretStrength(): void {
  jwtSecret();
}

export function signToken(claims: PlayerClaims): string {
  return jwt.sign(claims, jwtSecret(), { algorithm: "HS256", expiresIn: TOKEN_TTL });
}

export function verifyToken(token: string): PlayerClaims {
  // Pin the algorithm: never let a token's own header pick the verifier (H2).
  const decoded = jwt.verify(token, jwtSecret(), { algorithms: ["HS256"] });
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
