import type { MerchantSession } from "@/lib/auth-api";
import { endSessionCookies, readSession, rejectCrossSite } from "@/server/auth/session";
import { allow, clientIp, guarded, json, tooManyRequests } from "@/server/http";
import { paymentRuntime } from "@/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The signed-in merchant wallet and when its session ends, or null. Only what the browser needs: never the token. */
async function handleGet(request: Request): Promise<Response> {
  if (!allow(`session:${clientIp(request)}`, 300)) return tooManyRequests();
  const verified = await readSession(request, paymentRuntime().store);
  const session: MerchantSession | null = verified ? { address: verified.address, expiresAt: verified.expiresAt } : null;
  return json({ session });
}

/** Signs out: revokes the session (so a copied token stops working too) and clears the cookie. */
async function handleDelete(request: Request): Promise<Response> {
  if (!allow(`session:${clientIp(request)}`, 300)) return tooManyRequests();
  const crossSite = rejectCrossSite(request);
  if (crossSite) return crossSite;

  const { store } = paymentRuntime();
  const verified = await readSession(request, store);
  if (verified) await store.revokeSession(verified.sessionId, verified.expiresAt);
  const response = json({ session: null });
  for (const cookie of endSessionCookies(request)) response.headers.append("set-cookie", cookie);
  return response;
}

export const GET = guarded(handleGet);

export const DELETE = guarded(handleDelete);
