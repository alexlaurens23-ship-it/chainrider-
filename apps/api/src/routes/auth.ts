import type { SupabaseClient } from "@supabase/supabase-js";
import type { FastifyPluginAsync } from "fastify";
import {
  buildLoginMessage,
  generateNonce,
  signToken,
  validateUsername,
  verifySignature,
} from "../auth.js";
import { getDb } from "../db.js";

/** Nonce lifetime: short window between request and signature. */
const NONCE_TTL_MS = 5 * 60 * 1000;

interface NonceBody {
  walletAddress: string;
}
interface VerifyBody {
  walletAddress: string;
  signature: string;
}
interface RegisterBody {
  walletAddress: string;
  signature: string;
  username: string;
}

const walletSchema = {
  type: "object",
  required: ["walletAddress"],
  properties: { walletAddress: { type: "string", minLength: 32, maxLength: 64 } },
} as const;

const verifySchema = {
  type: "object",
  required: ["walletAddress", "signature"],
  properties: {
    walletAddress: { type: "string", minLength: 32, maxLength: 64 },
    signature: { type: "string", minLength: 64, maxLength: 128 },
  },
} as const;

const registerSchema = {
  type: "object",
  required: ["walletAddress", "signature", "username"],
  properties: {
    walletAddress: { type: "string", minLength: 32, maxLength: 64 },
    signature: { type: "string", minLength: 64, maxLength: 128 },
    username: { type: "string", minLength: 3, maxLength: 16 },
  },
} as const;

/**
 * Consume a single-use login nonce: look it up, reject if missing/expired,
 * reconstruct the exact signed message, verify the signature, and DELETE the
 * nonce. Returns true only on a fully valid signature.
 */
async function consumeNonce(
  db: SupabaseClient,
  walletAddress: string,
  signature: string,
): Promise<boolean> {
  const { data: row } = await db
    .from("cr_auth_nonces")
    .select("nonce, expires_at")
    .eq("wallet_address", walletAddress)
    .maybeSingle();
  if (!row) return false;
  if (new Date(row.expires_at as string).getTime() < Date.now()) {
    await db.from("cr_auth_nonces").delete().eq("wallet_address", walletAddress);
    return false;
  }
  const message = buildLoginMessage(walletAddress, row.nonce as string);
  const ok = verifySignature(walletAddress, message, signature);
  if (ok) {
    // Single-use: a valid signature burns the nonce.
    await db.from("cr_auth_nonces").delete().eq("wallet_address", walletAddress);
  }
  return ok;
}

/** Wallet-signature auth (tweetnacl verify → JWT). The wallet is the account. */
export const authRoutes: FastifyPluginAsync = async (app) => {
  // 1. Issue a one-time nonce + the human-readable message to sign.
  app.post<{ Body: NonceBody }>("/nonce", { schema: { body: walletSchema } }, async (req) => {
    const db = getDb();
    const { walletAddress } = req.body;
    const nonce = generateNonce();
    const expiresAt = new Date(Date.now() + NONCE_TTL_MS).toISOString();
    await db
      .from("cr_auth_nonces")
      .upsert(
        { wallet_address: walletAddress, nonce, expires_at: expiresAt },
        { onConflict: "wallet_address" },
      );
    return { message: buildLoginMessage(walletAddress, nonce) };
  });

  // 2. Verify the signature. Existing player → JWT; new wallet → needsUsername.
  app.post<{ Body: VerifyBody }>(
    "/verify",
    { schema: { body: verifySchema } },
    async (req, reply) => {
      const db = getDb();
      const { walletAddress, signature } = req.body;
      if (!(await consumeNonce(db, walletAddress, signature))) {
        return reply.code(401).send({ error: "invalid or expired signature" });
      }
      const { data: player } = await db
        .from("cr_players")
        .select("id, username")
        .eq("wallet_address", walletAddress)
        .maybeSingle();
      if (!player) {
        // Signature is good but there's no account yet — gather a username next.
        return { needsUsername: true };
      }
      await db
        .from("cr_players")
        .update({ last_login_at: new Date().toISOString() })
        .eq("id", player.id);
      return {
        token: signToken({ playerId: player.id as string, wallet: walletAddress }),
        username: player.username as string,
      };
    },
  );

  // 3. Register a new account (fresh signature required) and issue a JWT.
  app.post<{ Body: RegisterBody }>(
    "/register",
    { schema: { body: registerSchema } },
    async (req, reply) => {
      const db = getDb();
      const { walletAddress, signature, username } = req.body;
      const valid = validateUsername(username);
      if (!valid.ok) return reply.code(400).send({ error: valid.reason });
      if (!(await consumeNonce(db, walletAddress, signature))) {
        return reply.code(401).send({ error: "invalid or expired signature" });
      }
      // Guard against an existing account for this wallet (re-register attempt).
      const { data: existing } = await db
        .from("cr_players")
        .select("id, username")
        .eq("wallet_address", walletAddress)
        .maybeSingle();
      if (existing) {
        return {
          token: signToken({ playerId: existing.id as string, wallet: walletAddress }),
          username: existing.username as string,
        };
      }
      // Case-insensitive uniqueness.
      const { data: taken } = await db
        .from("cr_players")
        .select("id")
        .ilike("username", username)
        .maybeSingle();
      if (taken) return reply.code(409).send({ error: "username taken" });

      const { data: created, error } = await db
        .from("cr_players")
        .insert({
          wallet_address: walletAddress,
          username,
          last_login_at: new Date().toISOString(),
        })
        .select("id, username")
        .single();
      if (error || !created) {
        // Unique-violation race or other failure.
        return reply.code(409).send({ error: "username taken" });
      }
      return {
        token: signToken({ playerId: created.id as string, wallet: walletAddress }),
        username: created.username as string,
      };
    },
  );
};
