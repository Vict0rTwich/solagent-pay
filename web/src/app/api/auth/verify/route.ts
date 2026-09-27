import type { SignInProof } from "@/lib/auth-api";
import { checkSignIn } from "@/server/auth/siws";
import { isAllowedMerchant, readChallenge, rejectCrossSite, spendNonce, startSession } from "@/server/auth/session";
import { allow, clientIp, error, guarded, json, readJson, tooManyRequests } from "@/server/http";
import { paymentRuntime } from "@/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A SIWS message is a few hundred bytes; anything much bigger isn't one. */
const MAX_MESSAGE_BYTES = 2048;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

function decode(value: unknown, maxBytes: number): Uint8Array | null {
  if (typeof value !== "string" || value.length === 0 || value.length > Math.ceil(maxBytes / 3) * 4 || !BASE64.test(value)) return null;
  return new Uint8Array(Buffer.from(value, "base64"));
}

function parseProof(body: unknown): { signedMessage: Uint8Array; signature: Uint8Array } | string {
  if (!body || typeof body !== "object") return "Send a JSON body.";
  const proof = body as Partial<Record<keyof SignInProof, unknown>>;
  const signedMessage = decode(proof.signedMessage, MAX_MESSAGE_BYTES);
  if (!signedMessage) return "signedMessage must be the signed message, base64.";
  const signature = decode(proof.signature, 64);
  if (!signature || signature.length !== 64) return "signature must be a 64-byte Ed25519 signature, base64.";
  return { signedMessage, signature };
}

/**
 * Completes a Sign-In with Solana: checks the wallet's Ed25519 signature of exactly the request this browser was
 * issued, spends its nonce, and sets the session cookie.
 */
async function handlePost(request: Request): Promise<Response> {
  if (!allow(`signin:${clientIp(request)}`, 30)) return tooManyRequests();
  const crossSite = rejectCrossSite(request);
  if (crossSite) return crossSite;

  const input = readChallenge(request);
  if (!input) return error(401, "This sign-in request expired or was started in another browser. Try again.");
  const proof = parseProof(await readJson(request));
  if (typeof proof === "string") return error(400, proof);

  const failure = checkSignIn(input, proof.signedMessage, proof.signature);
  if (failure) return error(401, failure);
  if (!isAllowedMerchant(input.address)) return error(403, "This server only signs in its own merchant wallets.");
  if (!(await spendNonce(paymentRuntime().store, input))) return error(401, "This sign-in request was already used. Try again.");

  const { session, cookies } = startSession(request, input.address);
  const response = json({ session });
  for (const cookie of cookies) response.headers.append("set-cookie", cookie);
  return response;
}

export const POST = guarded(handlePost);
