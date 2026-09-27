import { requireMerchant } from "@/server/auth/session";
import { allow, clientIp, error, guarded, isAddress, json, tooManyRequests } from "@/server/http";
import { paymentRuntime } from "@/server/runtime";
import { isStoreError, toPublicInvoice } from "@/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Cancels an open invoice and stops watching for its payment. Only the wallet it pays, signed in (SIWS), can. */
async function handlePost(request: Request, { params }: { params: Promise<{ reference: string }> }): Promise<Response> {
  if (!allow(`cancel:${clientIp(request)}`, 30)) return tooManyRequests();
  const { reference } = await params;
  const runtime = paymentRuntime();
  const merchant = await requireMerchant(request, runtime.store);
  if (merchant instanceof Response) return merchant;
  if (!isAddress(reference)) return error(404, "No invoice with that reference.");

  try {
    const { result, invoice } = await runtime.store.cancel(reference, merchant.address);
    if (result === "forbidden") return error(403, "Only the wallet this invoice pays can cancel it.");
    if (result === "not_pending") return error(409, `The invoice is already ${invoice.status}.`);
    runtime.listener.unwatch(reference);
    runtime.events.emit({
      type: "STATUS_UPDATED",
      network: invoice.network,
      merchant: invoice.recipient,
      reference,
      data: { invoiceId: invoice.id, from: "PENDING", to: "CANCELED", canceledAt: invoice.canceledAt },
    });
    return json(toPublicInvoice(invoice));
  } catch (caught) {
    if (isStoreError(caught, "not_found")) return error(404, caught.message);
    throw caught;
  }
}

export const POST = guarded(handlePost);
