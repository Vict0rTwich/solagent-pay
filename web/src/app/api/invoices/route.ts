import { networkAllowed } from "@/lib/api-keys";
import { isCurrency, parseAmount } from "@/lib/currency";
import type { CreateInvoiceRequest, CreateInvoiceResponse } from "@/lib/invoice-api";
import { isNetworkId } from "@/lib/network";
import { amountToBaseUnits } from "@/lib/solana-pay";
import { bearerKey, requireApiKey, utcDay } from "@/server/auth/api-keys";
import { requireMerchant } from "@/server/auth/session";
import { serverConfig } from "@/server/config";
import { allow, clientIp, error, guarded, isAddress, json, readJson, tooManyRequests } from "@/server/http";
import { openInvoice, orderOf, type OpenInvoiceInput } from "@/server/invoices";
import { paymentRuntime } from "@/server/runtime";
import { isStoreError, toPublicInvoice, type ApiKeyRecord } from "@/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MEMO_MAX = 80;
const MAX_REFERENCES = 100;

function parseCreate(body: unknown): CreateInvoiceRequest | string {
  if (!body || typeof body !== "object") return "Send a JSON body.";
  const input = body as Record<string, unknown>;
  if (!isNetworkId(input.network)) return "network must be devnet, localnet or mainnet-beta.";
  if (!isAddress(input.recipient)) return "recipient must be a Solana address.";
  // An order of a product: its price, currency and title come from the product, never from the caller.
  if (input.productId !== undefined) {
    if (typeof input.productId !== "string" || !input.productId) return "productId must be one of your product ids.";
    return { network: input.network, recipient: input.recipient, productId: input.productId };
  }
  if (!isCurrency(input.currency)) return 'currency must be "USDC" or "SOL".';
  // A string, not a number: SOL goes to 9 decimals, past what a float carries exactly.
  if (typeof input.amount !== "string") return `amount must be a decimal string in ${input.currency}, like "1.5".`;
  const amount = parseAmount(input.amount, input.currency);
  if (!amount.ok) return amount.error;
  if (input.memo !== undefined && (typeof input.memo !== "string" || input.memo.trim().length > MEMO_MAX)) {
    return `memo must be text of at most ${MEMO_MAX} characters.`;
  }
  if (input.kind !== "invoice" && input.kind !== "link") return 'kind must be "invoice" or "link".';
  return {
    network: input.network,
    recipient: input.recipient,
    currency: input.currency,
    amount: amount.amount,
    memo: typeof input.memo === "string" ? input.memo.trim() : "",
    kind: input.kind,
  };
}

/** USD cents an invoice counts against a key's daily cap: its USDC amount, rounded up to the cent. */
function capCents(amount: string): number {
  return Number((amountToBaseUnits(amount, 6) + 9_999n) / 10_000n);
}

/**
 * Creates an invoice the server watches and settles. Merchants only, two ways in:
 * - signed in (SIWS) as the wallet the invoice pays: the dashboard and the PoS. Either an amount, or `productId` for
 *   an order of one of their products (a sale at the counter). These issue the buyer a cNFT receipt once paid;
 * - `Authorization: Bearer sp_…`: a server with one of the merchant's API keys (an HTTP 402 paywall). Key-made
 *   invoices pay the key's wallet, are in USDC, stay on the key's networks, and count against its daily cap.
 * The caller picks the currency; the server picks the reference key, the mint (the network's USDC, never one the
 * caller names) and the expiry.
 */
async function handlePost(request: Request): Promise<Response> {
  if (!allow(`create:${clientIp(request)}`, 30)) return tooManyRequests();
  const runtime = paymentRuntime();

  let merchant: string;
  let apiKey: ApiKeyRecord | null = null;
  if (bearerKey(request) !== null) {
    const key = await requireApiKey(request, runtime.store);
    if (key instanceof Response) return key;
    if (!allow(`create-key:${key.id}`, 120)) return tooManyRequests();
    apiKey = key;
    merchant = key.merchant;
  } else {
    const session = await requireMerchant(request, runtime.store);
    if (session instanceof Response) return session;
    merchant = session.address;
  }

  const input = parseCreate(await readJson(request));
  if (typeof input === "string") return error(400, input);
  if (input.recipient !== merchant) {
    return error(403, apiKey ? "An API key's invoices can only pay the wallet that created the key." : "Invoices can only pay the wallet you're signed in with.");
  }

  let order: Omit<OpenInvoiceInput, "issueReceipt" | "ttlMs" | "source" | "apiKey">;
  if (input.productId !== undefined) {
    if (apiKey) return error(400, "API keys create invoices for an amount, not product orders.");
    const product = await runtime.store.getProduct(input.productId);
    if (!product || product.merchant !== merchant) return error(404, "You have no product with that id.");
    if (product.network !== input.network) return error(400, `That product is on sale on ${product.network}, not ${input.network}.`);
    if (product.archivedAt !== null) return error(409, "That product was archived, so it can't be sold anymore.");
    order = orderOf(product);
  } else {
    order = { ...input, product: null };
  }

  let reserved: { keyId: string; day: number; cents: number } | null = null;
  if (apiKey) {
    if (!networkAllowed(apiKey.environment, order.network)) {
      return error(403, `A ${apiKey.environment} key works on ${apiKey.environment === "live" ? "mainnet-beta" : "devnet and localnet"} only.`);
    }
    if (order.currency !== "USDC") return error(400, "API keys create USDC invoices only: their daily cap is in US dollars.");
    const cents = capCents(order.amount);
    const day = utcDay();
    const reservation = await runtime.store.reserveKeyVolume(apiKey.id, day, cents, apiKey.dailyCapCents);
    if (!reservation.ok) {
      const resetsIn = Math.ceil((day + 86_400_000 - Date.now()) / 1000);
      const dollars = (value: number) => `$${(value / 100).toFixed(2)}`;
      return error(
        429,
        `This key's daily cap is ${dollars(apiKey.dailyCapCents)} and ${dollars(reservation.usedCents)} of it is used today (UTC). It resets at 00:00 UTC.`,
        { "retry-after": String(resetsIn) },
      );
    }
    reserved = { keyId: apiKey.id, day, cents };
  }

  try {
    const invoice = await openInvoice(runtime, {
      ...order,
      // Buyers at the counter and dashboard clients get a cNFT receipt; an agent paying a 402 paywall doesn't.
      issueReceipt: apiKey === null,
      ttlMs: serverConfig.invoiceTtlMs,
      source: apiKey ? "api-key" : "dashboard",
      apiKey: apiKey ? { id: apiKey.id, name: apiKey.name } : null,
    });
    const response: CreateInvoiceResponse = { invoice: toPublicInvoice(invoice) };
    return json(response, 201);
  } catch (caught) {
    // Nothing was created, so the reservation goes back to the key's allowance.
    if (reserved) await runtime.store.releaseKeyVolume(reserved.keyId, reserved.day, reserved.cents).catch(() => {});
    if (isStoreError(caught, "too_many_open")) return error(503, caught.message, { "retry-after": "60" });
    throw caught;
  }
}

/**
 * Status of several invoices by reference key: ?references=a,b,c. Unknown ones are left out. Public, like the
 * single-invoice status: a reference key is unguessable, and knowing one is what lets a payer's page check it.
 */
async function handleGet(request: Request): Promise<Response> {
  if (!allow(`list:${clientIp(request)}`, 600)) return tooManyRequests();
  const references = (new URL(request.url).searchParams.get("references") ?? "").split(",").filter(Boolean);
  if (references.length === 0) return error(400, "Pass ?references=<reference>,<reference>.");
  if (references.length > MAX_REFERENCES) return error(400, `At most ${MAX_REFERENCES} references per request.`);

  const { store } = paymentRuntime();
  const found = await Promise.all(references.filter(isAddress).map((reference) => store.get(reference)));
  return json({ invoices: found.flatMap((invoice) => (invoice ? [toPublicInvoice(invoice)] : [])) });
}

export const POST = guarded(handlePost);

export const GET = guarded(handleGet);
