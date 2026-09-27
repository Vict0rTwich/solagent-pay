import { PublicKey } from "@solana/web3.js";

import { currencyOfMint } from "@/lib/currency";
import { NETWORKS, type NetworkId } from "@/lib/network";
import { assetSymbol, formatAmount, parseTransferRequest } from "@/lib/solana-pay";
import type { Product } from "@/lib/types";
import { buildTransferTransaction, toPaymentError } from "@/lib/wallet-payment";

import { serverConfig } from "./config";
import { allow, clientIp, isAddress, readJson } from "./http";
import { openInvoice, orderOf } from "./invoices";
import { publicOrigin } from "./origin";
import { paymentRuntime, type PaymentRuntime } from "./runtime";
import { isStoreError, type InvoiceRecord } from "./store";

// Solana Actions (Blinks). Any Actions client (Phantom, Dialect's dial.to, blinks on X) can show:
// - an invoice as a card with a "Pay" button (/api/actions/pay/<reference>);
// - a product as a card with a "Buy" button (/api/actions/product/<id>). A product's Blink never expires: each buyer's
//   POST opens an order of its own, a fresh invoice with its own reference key.
// Either way the wallet gets from here the same transfer the checkout page builds: the invoice's reference key on it,
// so the listener finds and settles the payment like any other, and mints the buyer's cNFT receipt.
// Spec: https://solana.com/docs/advanced/actions (types from @solana/actions-spec 2.4).

/** A Blink order is opened the moment a wallet asks for its transaction, and signed right away or not at all. */
const BLINK_ORDER_TTL_MS = 10 * 60_000;

/** Actions spec version these responses follow. */
const ACTION_VERSION = "2.4";

/** CAIP-2 ids. Localnet has none: no Actions client can reach a local validator anyway. */
const BLOCKCHAIN_IDS: Partial<Record<NetworkId, string>> = {
  devnet: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
  "mainnet-beta": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
};

interface ActionError {
  message: string;
}

/** ActionGetResponse, the fields this server uses. */
interface ActionGetResponse {
  type: "action";
  icon: string;
  title: string;
  description: string;
  label: string;
  disabled?: boolean;
  error?: ActionError;
}

/** ActionPostResponse for a transaction. */
interface TransactionResponse {
  type: "transaction";
  /** base64 of the serialized, unsigned transaction. */
  transaction: string;
  message?: string;
}

/** The CORS headers Actions clients need on every response (ACTIONS_CORS_HEADERS), plus version and chain. */
export function actionHeaders(network?: NetworkId): Record<string, string> {
  const headers: Record<string, string> = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,PUT,OPTIONS",
    "access-control-allow-headers":
      "Content-Type, Authorization, Content-Encoding, Accept-Encoding, X-Accept-Action-Version, X-Accept-Blockchain-Ids",
    "access-control-expose-headers": "X-Action-Version, X-Blockchain-Ids",
    "x-action-version": ACTION_VERSION,
    "cache-control": "no-store",
  };
  const chain = network ? BLOCKCHAIN_IDS[network] : undefined;
  if (chain) headers["x-blockchain-ids"] = chain;
  return headers;
}

export function actionJson(body: unknown, status = 200, network?: NetworkId): Response {
  return Response.json(body, { status, headers: actionHeaders(network) });
}

function actionError(status: number, message: string, network?: NetworkId): Response {
  return actionJson({ message } satisfies ActionError, status, network);
}

/** CORS preflight for every Actions route. */
export function actionPreflight(): Response {
  return new Response(null, { status: 204, headers: actionHeaders() });
}

/** Why an invoice can't be paid anymore, or null while it can. */
function closedReason(invoice: InvoiceRecord, now = Date.now()): { label: string; message: string } | null {
  if (invoice.status === "paid") return { label: "Paid", message: `${invoice.id} is already paid.` };
  if (invoice.status === "canceled") return { label: "Canceled", message: `${invoice.id} was canceled. Ask for a new payment link.` };
  if (invoice.status === "expired" || invoice.expiresAt <= now) {
    return { label: "Expired", message: `${invoice.id} expired before it was paid. Ask for a new payment link.` };
  }
  return null;
}

async function findInvoice(reference: string | null): Promise<InvoiceRecord | null> {
  return reference && isAddress(reference) ? paymentRuntime().store.get(reference) : null;
}

/** The card image: the product's own, else the generated one for the token it's paid in. */
function cardIcon(request: Request, image: string | null, mint: string | null): string {
  return image ?? new URL(`/api/actions/icon?currency=${currencyOfMint(mint) ?? "USDC"}`, publicOrigin(request)).toString();
}

/** The paying wallet from a POST body, or why it can't pay. */
function payingAccount(body: unknown, recipient: string): { account: string } | { error: string } {
  const account = body && typeof body === "object" && "account" in body ? (body as { account: unknown }).account : undefined;
  if (!isAddress(account)) return { error: "account must be the paying wallet's address." };
  if (account === recipient) return { error: "That's the wallet being paid. Pay from another account." };
  return { account };
}

/**
 * The unsigned transfer for `account` to sign, as the checkout page would build it (memo with the invoice number,
 * the exact asset and amount, the reference key on the transfer). Balances are checked first, so the payer sees
 * "Insufficient balance" in the blink rather than a failed simulation.
 */
async function transactionFor(
  payments: PaymentRuntime,
  invoice: InvoiceRecord,
  account: string,
  message: string,
): Promise<{ ok: true; response: Response } | { ok: false; response: Response }> {
  await payments.start();
  try {
    const { transaction } = await buildTransferTransaction(
      payments.rpc(invoice.network).connection,
      new PublicKey(account),
      parseTransferRequest(invoice.paymentUrl),
    );
    const encoded = Buffer.from(transaction.serialize({ requireAllSignatures: false, verifySignatures: false })).toString("base64");
    payments.events.emit({
      type: "BLINK_TX_BUILT",
      network: invoice.network,
      merchant: invoice.recipient,
      reference: invoice.reference,
      data: {
        invoiceId: invoice.id,
        payer: account,
        amount: invoice.amount,
        asset: invoice.token,
        instructions: transaction.instructions.length,
        productId: invoice.productId,
      },
    });
    const response: TransactionResponse = { type: "transaction", transaction: encoded, message };
    return { ok: true, response: actionJson(response, 200, invoice.network) };
  } catch (caught) {
    const failure = toPaymentError(caught);
    const retryable = failure.kind === "timeout" || failure.kind === "network";
    return { ok: false, response: actionError(retryable ? 503 : 400, failure.message, invoice.network) };
  }
}

/** GET: the invoice as an Action card; an order shows its product. Closed invoices come back disabled, with the reason. */
export async function getPayAction(request: Request, reference: string | null): Promise<Response> {
  if (!allow(`action-get:${clientIp(request)}`, 300)) return actionError(429, "Too many requests. Try again shortly.");
  const invoice = await findInvoice(reference);
  if (!invoice) return actionError(404, "No invoice with that reference.");

  const shown = `${formatAmount(invoice.amount)} ${invoice.token}`;
  const closed = closedReason(invoice);
  const product = invoice.product;
  const body: ActionGetResponse = {
    type: "action",
    icon: cardIcon(request, product?.image ?? null, invoice.mint),
    title: product ? product.title : `Pay Invoice ${invoice.id}`,
    description: product
      ? `${product.description ? `${product.description} · ` : ""}${shown} · order ${invoice.id}`
      : `${shown} to ${invoice.recipient}${invoice.memo ? ` · ${invoice.memo}` : ""}`,
    label: closed ? closed.label : `Pay ${shown}`,
    ...(closed ? { disabled: true, error: { message: closed.message } } : {}),
  };
  return actionJson(body, 200, invoice.network);
}

/** POST { account }: the unsigned transfer that pays this invoice. */
export async function postPayAction(request: Request, reference: string | null): Promise<Response> {
  if (!allow(`action-post:${clientIp(request)}`, 30)) return actionError(429, "Too many requests. Try again shortly.");
  const invoice = await findInvoice(reference);
  if (!invoice) return actionError(404, "No invoice with that reference.");
  const closed = closedReason(invoice);
  if (closed) return actionError(409, closed.message, invoice.network);

  const payer = payingAccount(await readJson(request), invoice.recipient);
  if ("error" in payer) return actionError(400, payer.error, invoice.network);

  const message = `Pays ${invoice.id}: ${formatAmount(invoice.amount)} ${invoice.token} on ${NETWORKS[invoice.network].label}. It's marked paid once it confirms.`;
  return (await transactionFor(paymentRuntime(), invoice, payer.account, message)).response;
}

async function findProduct(id: string | null): Promise<Product | null> {
  return id && /^prod_[1-9A-HJ-NP-Za-km-z]{6,20}$/.test(id) ? paymentRuntime().store.getProduct(id) : null;
}

/** "45.00 USDC" */
function priceOf(product: Product): string {
  return `${formatAmount(product.amount)} ${assetSymbol(product.mint)}`;
}

/** GET: the product as an Action card: its image, title and description, and a "Buy" button with the price. */
export async function getProductAction(request: Request, id: string | null): Promise<Response> {
  if (!allow(`action-get:${clientIp(request)}`, 300)) return actionError(429, "Too many requests. Try again shortly.");
  const product = await findProduct(id);
  if (!product) return actionError(404, "No product with that id.");

  const price = priceOf(product);
  const archived = product.archivedAt !== null;
  const body: ActionGetResponse = {
    type: "action",
    icon: cardIcon(request, product.image, product.mint),
    title: product.title,
    description: `${product.description ? `${product.description}\n\n` : ""}${price} on ${NETWORKS[product.network].label}. Every purchase comes with a cNFT proof-of-purchase receipt.`,
    label: archived ? "Unavailable" : `Buy · ${price}`,
    ...(archived ? { disabled: true, error: { message: `${product.title} isn't for sale anymore.` } } : {}),
  };
  return actionJson(body, 200, product.network);
}

/**
 * POST { account }: opens an order for this buyer (a fresh invoice with its own reference key, issuing a cNFT receipt
 * once paid) and returns the transfer that pays it. If the transfer can't be built (e.g. the buyer's balance is too
 * low), the order is canceled at once rather than left open.
 */
export async function postProductAction(request: Request, id: string | null): Promise<Response> {
  const ip = clientIp(request);
  if (!allow(`action-post:${ip}`, 30)) return actionError(429, "Too many requests. Try again shortly.");
  const product = await findProduct(id);
  if (!product) return actionError(404, "No product with that id.");
  if (product.archivedAt !== null) return actionError(409, `${product.title} isn't for sale anymore.`, product.network);

  const payer = payingAccount(await readJson(request), product.merchant);
  if ("error" in payer) return actionError(400, payer.error, product.network);
  // Each order is watched until it's paid or expires, so opening them is limited more tightly than reading cards.
  if (!allow(`blink-order:${ip}`, 10)) return actionError(429, "Too many orders from here. Try again in a minute.", product.network);

  const payments = paymentRuntime();
  let order: InvoiceRecord;
  try {
    order = await openInvoice(payments, {
      ...orderOf(product),
      issueReceipt: true,
      ttlMs: Math.min(serverConfig.invoiceTtlMs, BLINK_ORDER_TTL_MS),
      source: "blink",
    });
  } catch (caught) {
    if (isStoreError(caught, "too_many_open")) return actionError(503, "This shop is taking a lot of orders right now. Try again in a minute.", product.network);
    throw caught;
  }

  const message = `Buys ${product.title} for ${priceOf(product)} on ${NETWORKS[product.network].label} (order ${order.id}). Your cNFT receipt is minted once it confirms.`;
  const built = await transactionFor(payments, order, payer.account, message);
  if (!built.ok) {
    const { result, invoice } = await payments.store.cancel(order.reference, order.recipient).catch(() => ({ result: "not_pending" as const, invoice: order }));
    payments.listener.unwatch(order.reference);
    if (result === "canceled") {
      payments.events.emit({
        type: "STATUS_UPDATED",
        network: invoice.network,
        merchant: invoice.recipient,
        reference: invoice.reference,
        data: { invoiceId: invoice.id, from: "PENDING", to: "CANCELED", canceledAt: invoice.canceledAt, reason: "transaction couldn't be built" },
      });
    }
  }
  return built.response;
}
