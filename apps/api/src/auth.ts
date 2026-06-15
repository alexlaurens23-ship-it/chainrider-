import { randomBytes } from "node:crypto";
import bs58 from "bs58";
import type { FastifyReply, FastifyRequest } from "fastify";
import jwt from "jsonwebtoken";
import nacl from "tweetnacl";

/**
 * Wallet-signature auth primitives. The wallet IS the account and the payout
 * address — no passwords, no email. Identity is proven by an ed25519 signature
 * over a one-time, human-readable message. No private key ever reaches the
 * server; we only ever see the public address + a detached signature.
 */

/** JWT lifetime. The wallet re-signs to refresh. */
const TOKEN_TTL = "7d";

/** Authed-request shape the routes read after `requireAuth`. */
export interface PlayerClaims {
  playerId: string;
  wallet: string;
}

declare module "fastify" {
  interface FastifyRequest {
    player: PlayerClaims | null;
  }
}

/**
 * The EXACT message the wallet signs. Built identically by `/nonce` (returned
 * to the client) and by `/verify`/`/register` (reconstructed from the stored
 * nonce) so the signed bytes always match.
 */
export function buildLoginMessage(walletAddress: string, nonce: string): string {
  return `CHAINRIDER login\nwallet: ${walletAddress}\nnonce: ${nonce}`;
}

/** Fresh single-use nonce (base58 of 16 random bytes). */
export function generateNonce(): string {
  return bs58.encode(randomBytes(16));
}

/**
 * Verify an ed25519 signature (base58) over `message` against the Solana
 * public key encoded in `walletAddress` (base58). Any malformed input → false.
 */
export function verifySignature(
  walletAddress: string,
  message: string,
  signatureB58: string,
): boolean {
  try {
    const pubKey = bs58.decode(walletAddress);
    const sig = bs58.decode(signatureB58);
    if (pubKey.length !== 32 || sig.length !== 64) return false;
    const msg = new TextEncoder().encode(message);
    return nacl.sign.detached.verify(msg, sig, pubKey);
  } catch {
    return false;
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
    typeof (decoded as Record<string, unknown>).wallet !== "string"
  ) {
    throw new Error("malformed token payload");
  }
  const { playerId, wallet } = decoded as Record<string, string>;
  return { playerId, wallet };
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
