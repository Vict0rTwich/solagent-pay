import { requireMerchant } from "@/server/auth/session";
import { allow, clientIp, error, guarded, isAddress, json, readJson, tooManyRequests } from "@/server/http";
import { paymentRuntime } from "@/server/runtime";
import { receiptQueueable, toPublicInvoice } from "@/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mints the buyer's cNFT receipt for a paid order: POST { reference }. Receipts are queued automatically when an
 * order settles; this is for the merchant to mint one again (after a failure, or for real once an Underdog key is
 * set where it was only simulated) or to issue one for an invoice that didn't get one. Only the wallet the invoice
 * pays, signed in, can. Answers with the invoice; its `receipt` shows how the mint goes.
 */
async function handlePost(request: Request): Promise<Response> {
  if (!allow(`receipt-mint:${clientIp(request)}`, 20)) return tooManyRequests();
  const runtime = paymentRuntime();
  const session = await requireMerchant(request, runtime.store);
  if (session instanceof Response) return session;

  const body = await readJson(request);
  const reference = body && typeof body === "object" && "reference" in body ? (body as { reference: unknown }).reference : undefined;
  if (!isAddress(reference)) return error(400, "reference must be the invoice's reference key.");
  const invoice = await runtime.store.get(reference);
  if (!invoice || invoice.recipient !== session.address) return error(404, "You have no invoice with that reference.");
  if (invoice.status !== "paid") return error(409, "It isn't paid yet: a receipt is minted once the payment settles.");
  const owner = invoice.receipt?.owner ?? invoice.payer;
  if (!owner) return error(409, "This payment settled before payers were recorded, so there's no wallet to send a receipt to.");
  // Pending or minted already: nothing to do, and a second request mustn't mint a second receipt.
  if (!receiptQueueable(invoice.receipt ?? null)) return json(toPublicInvoice(invoice));

  const queued = await runtime.store.queueReceipt(reference, owner);
  await runtime.start();
  runtime.receipts.kick();
  return json(toPublicInvoice(queued ?? invoice), 202);
}

export const POST = guarded(handlePost);
