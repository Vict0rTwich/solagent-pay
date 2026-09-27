import { createChallenge, isAllowedMerchant, rejectCrossSite } from "@/server/auth/session";
import { allow, clientIp, error, guarded, isAddress, json, readJson, tooManyRequests } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Starts a Sign-In with Solana for `{ address }`: returns the request for the wallet to sign (domain, address,
 * statement, nonce, issued-at, expiration) and pins it to this browser in an HTTP-only cookie for 10 minutes.
 */
async function handlePost(request: Request): Promise<Response> {
  if (!allow(`nonce:${clientIp(request)}`, 30)) return tooManyRequests();
  const crossSite = rejectCrossSite(request);
  if (crossSite) return crossSite;

  const body = await readJson(request);
  const address = body && typeof body === "object" && "address" in body ? (body as { address: unknown }).address : undefined;
  if (!isAddress(address)) return error(400, "address must be a Solana address.");
  // Said now rather than after the wallet has asked the merchant to sign.
  if (!isAllowedMerchant(address)) return error(403, "This server only signs in its own merchant wallets.");

  const { challenge, cookie } = createChallenge(request, address);
  return json(challenge, 200, { "set-cookie": cookie });
}

export const POST = guarded(handlePost);
