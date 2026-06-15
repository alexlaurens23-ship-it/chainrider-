import bs58 from "bs58";
import nacl from "tweetnacl";
import { describe, expect, it } from "vitest";
import { buildLoginMessage, validateUsername, verifySignature } from "../src/auth.js";

describe("buildLoginMessage", () => {
  it("is the exact CHAINRIDER login template", () => {
    expect(buildLoginMessage("WALLET", "NONCE")).toBe(
      "CHAINRIDER login\nwallet: WALLET\nnonce: NONCE",
    );
  });
});

describe("validateUsername", () => {
  it("accepts 3–16 lowercase / digit / underscore", () => {
    expect(validateUsername("rider_99").ok).toBe(true);
    expect(validateUsername("abc").ok).toBe(true);
  });
  it("rejects too short, too long, uppercase, symbols, non-strings", () => {
    expect(validateUsername("ab").ok).toBe(false);
    expect(validateUsername("x".repeat(17)).ok).toBe(false);
    expect(validateUsername("BigRig").ok).toBe(false);
    expect(validateUsername("has space").ok).toBe(false);
    expect(validateUsername("dash-no").ok).toBe(false);
    expect(validateUsername(42).ok).toBe(false);
  });
});

describe("verifySignature", () => {
  // A real ed25519 keypair; the Solana address is the base58 public key.
  const kp = nacl.sign.keyPair();
  const wallet = bs58.encode(kp.publicKey);
  const nonce = "test-nonce-123";
  const message = buildLoginMessage(wallet, nonce);
  const sig = bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey));

  it("accepts a genuine signature over the exact message", () => {
    expect(verifySignature(wallet, message, sig)).toBe(true);
  });

  it("rejects a signature over a different message (replay/forgery)", () => {
    expect(verifySignature(wallet, buildLoginMessage(wallet, "other"), sig)).toBe(false);
  });

  it("rejects a signature from a different wallet", () => {
    const other = bs58.encode(nacl.sign.keyPair().publicKey);
    expect(verifySignature(other, message, sig)).toBe(false);
  });

  it("rejects malformed base58 input without throwing", () => {
    expect(verifySignature("not-base58!!", message, sig)).toBe(false);
    expect(verifySignature(wallet, message, "garbage")).toBe(false);
  });
});
