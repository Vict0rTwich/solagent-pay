import { describeError } from "@/lib/live-data";
import { allow, clientIp, error, isAddress, json, readJson, tooManyRequests } from "@/server/http";
import { paymentRuntime } from "@/server/runtime";
import { isInvoiceNotFound } from "@/server/verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Checks the chain for this invoice's payment now and returns the server's verdict: VERIFIED_PAID,
 * TOKEN_MISMATCH, UNDERPAID, INVALID_RECIPIENT or PENDING. The checkout calls it right after a wallet
 * confirms, rather than waiting for the listener. Asking can't change the outcome, only its timing: the
 * server reads the chain itself and settles an invoice at most once.
 */
export async function POST(request: Request, { params }: { params: Promise<{ reference: string }> }): Promise<Response> {
  const { reference } = await params;
  if (!allow(`verify:${clientIp(request)}`, 30)) return tooManyRequests();
  if (!isAddress(reference)) return error(404, "No invoice with that reference.");

  const runtime = paymentRuntime();
  await runtime.start();
  const body = await readJson(request);
  const given = body && typeof body === "object" && "invoiceId" in body ? (body as { invoiceId: unknown }).invoiceId : undefined;
  const invoiceId = typeof given === "string" ? given : (await runtime.store.get(reference))?.id;
  if (!invoiceId) return error(404, "No invoice with that reference.");

  try {
    return json(await runtime.verifyInvoicePayment(invoiceId, reference));
  } catch (caught) {
    if (isInvoiceNotFound(caught)) return error(404, caught.message);
    // The chain couldn't be read (rate limit, outage): the listener keeps trying on its own.
    return error(503, `Couldn't check the chain: ${describeError(caught)}`, { "retry-after": "5" });
  }
}
