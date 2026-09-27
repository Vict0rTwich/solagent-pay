import { requireMerchant } from "@/server/auth/session";
import { allow, clientIp, error, guarded, json, tooManyRequests } from "@/server/http";
import { paymentRuntime } from "@/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Takes a product off sale: its Blink shows it as unavailable and takes no new orders. Orders already open stay
 * payable until they expire. Only the merchant whose product it is, signed in, can.
 */
async function handlePost(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!allow(`product-archive:${clientIp(request)}`, 30)) return tooManyRequests();
  const { id } = await params;
  const runtime = paymentRuntime();
  const session = await requireMerchant(request, runtime.store);
  if (session instanceof Response) return session;
  const product = await runtime.store.archiveProduct(id, session.address);
  if (!product) return error(404, "You have no product with that id.");
  return json({ product });
}

export const POST = guarded(handlePost);
