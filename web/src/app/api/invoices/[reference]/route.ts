import { allow, clientIp, error, isAddress, json, tooManyRequests } from "@/server/http";
import { paymentRuntime } from "@/server/runtime";
import { toPublicInvoice } from "@/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One invoice's status. Public: it holds nothing the payment link doesn't already show, plus how it settled. */
export async function GET(request: Request, { params }: { params: Promise<{ reference: string }> }): Promise<Response> {
  if (!allow(`get:${clientIp(request)}`, 600)) return tooManyRequests();
  const { reference } = await params;
  if (!isAddress(reference)) return error(404, "No invoice with that reference.");
  const invoice = await paymentRuntime().store.get(reference);
  return invoice ? json(toPublicInvoice(invoice)) : error(404, "No invoice with that reference.");
}
