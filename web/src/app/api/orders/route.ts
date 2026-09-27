import { isNetworkId } from "@/lib/network";
import { requireMerchant } from "@/server/auth/session";
import { allow, clientIp, error, guarded, json, tooManyRequests } from "@/server/http";
import { paymentRuntime } from "@/server/runtime";
import { toPublicInvoice } from "@/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Enough for the dashboard's recent activity; older orders are in the store (and on-chain) all the same. */
const LIMIT = 50;

/**
 * The signed-in merchant's latest product orders on ?network=, newest first. Blink purchases are created by the
 * buyer's wallet, not in the merchant's browser, so this is how the dashboard learns about them.
 */
async function handleGet(request: Request): Promise<Response> {
  if (!allow(`orders:${clientIp(request)}`, 120)) return tooManyRequests();
  const runtime = paymentRuntime();
  const session = await requireMerchant(request, runtime.store);
  if (session instanceof Response) return session;
  const network = new URL(request.url).searchParams.get("network");
  if (!isNetworkId(network)) return error(400, "Pass ?network=devnet, localnet or mainnet-beta.");
  const orders = await runtime.store.listOrders(session.address, network, LIMIT);
  return json({ invoices: orders.map(toPublicInvoice) });
}

export const GET = guarded(handleGet);
