import { requireApiKey } from "@/server/auth/api-keys";
import { allow, clientIp, error, isAddress, json, tooManyRequests } from "@/server/http";
import { paymentRuntime } from "@/server/runtime";
import { toPublicInvoice } from "@/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Redeems a paid invoice for the request it paid for, once: what an HTTP 402 paywall calls before serving the
 * resource. Needs an API key of the wallet the invoice pays. An invoice still pending gets one on-demand check of
 * the chain first, so a payment the listener hasn't seen yet (or a serverless host with no listener) still counts.
 *
 * 200: redeemed now, serve the request. 402: not paid (yet). 409: already redeemed, by this or another request.
 */
export async function POST(request: Request, { params }: { params: Promise<{ reference: string }> }): Promise<Response> {
  if (!allow(`redeem:${clientIp(request)}`, 240)) return tooManyRequests();
  const payments = paymentRuntime();
  const key = await requireApiKey(request, payments.store);
  if (key instanceof Response) return key;
  if (!allow(`redeem-key:${key.id}`, 240)) return tooManyRequests();

  const { reference } = await params;
  if (!isAddress(reference)) return error(404, "No invoice with that reference.");
  let invoice = await payments.store.get(reference);
  if (!invoice) return error(404, "No invoice with that reference.");
  if (invoice.recipient !== key.merchant) return error(403, "That invoice doesn't pay this key's wallet.");

  if (invoice.status === "pending") {
    await payments.start().catch(() => {});
    await payments.verifyInvoicePayment(invoice.id, reference).catch(() => null);
    invoice = (await payments.store.get(reference)) ?? invoice;
  }
  if (invoice.status !== "paid") {
    return json({ error: `Not paid: the invoice is ${invoice.status}.`, invoice: toPublicInvoice(invoice) }, 402);
  }
  if (!(await payments.store.redeemInvoice(reference, key.id))) {
    return json({ error: "This payment was already redeemed. Each payment unlocks one request.", invoice: toPublicInvoice(invoice) }, 409);
  }
  return json({ invoice: toPublicInvoice(invoice), redeemedAt: Date.now() });
}
