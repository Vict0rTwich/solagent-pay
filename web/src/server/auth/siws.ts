import { createPublicKey, verify } from "node:crypto";

import { PublicKey } from "@solana/web3.js";

import type { SignInInput } from "@/lib/auth-api";

// Sign-In with Solana: the message format and the checks on what a wallet sends back.

/**
 * The sign-in message for `input`, in the Wallet Standard's SIWS format: the same text, byte for byte, that a
 * `solana:signIn` wallet builds from the same input (the reference createSignInMessageText, for the fields
 * this server issues).
 */
export function signInMessage(input: SignInInput): string {
  return [
    `${input.domain} wants you to sign in with your Solana account:`,
    input.address,
    "",
    input.statement,
    "",
    `URI: ${input.uri}`,
    `Version: ${input.version}`,
    `Nonce: ${input.nonce}`,
    `Issued At: ${input.issuedAt}`,
    `Expiration Time: ${input.expirationTime}`,
  ].join("\n");
}

/** Whether `signature` is the Ed25519 signature of `message` by the key behind `address`. */
export function verifySolanaSignature(address: string, message: Uint8Array, signature: Uint8Array): boolean {
  if (signature.length !== 64) return false;
  try {
    const x = Buffer.from(new PublicKey(address).toBytes()).toString("base64url");
    const key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x }, format: "jwk" });
    return verify(null, message, key, signature);
  } catch {
    // Not a valid Ed25519 point (e.g. an off-curve PDA): nothing it could have signed.
    return false;
  }
}

/**
 * Checks a wallet's answer to the sign-in request `expected`: the signed bytes must be exactly that request's
 * message (so the domain, address, nonce and times are the ones this server issued), and the signature must be
 * the address's own. Null when it holds, else why not, for the merchant.
 */
export function checkSignIn(expected: SignInInput, signedMessage: Uint8Array, signature: Uint8Array, now = Date.now()): string | null {
  if (Date.parse(expected.expirationTime) <= now) return "This sign-in request expired. Try again.";
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(signedMessage);
  } catch {
    return "The wallet signed something other than the sign-in message.";
  }
  if (text !== signInMessage(expected)) return "The wallet signed a different message than this sign-in request.";
  if (!verifySolanaSignature(expected.address, signedMessage, signature)) return "The signature doesn't match the wallet.";
  return null;
}
