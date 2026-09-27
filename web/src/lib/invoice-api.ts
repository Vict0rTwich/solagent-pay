import type { Currency } from "./currency";
import type { NetworkId } from "./network";
import type { Invoice, PaymentIssue, Product, ProductInfo, Receipt } from "./types";

// The payment server's HTTP API (app/api/invoices), shared by its route handlers and the browser.

export type ServerInvoiceStatus = "pending" | "paid" | "expired" | "canceled";

/** What an on-chain check found for an invoice's reference key. */
export type VerificationStatus = "VERIFIED_PAID" | "TOKEN_MISMATCH" | "UNDERPAID" | "INVALID_RECIPIENT" | "PENDING";

/** An invoice as the API returns it: what its payment link already says, plus how it settled. Nothing private. */
export interface PublicInvoice {
  id: string;
  reference: string;
  network: NetworkId;
  kind: "invoice" | "link";
  recipient: string;
  /** SPL mint to pay in; null for native SOL. */
  mint: string | null;
  /** Ticker: "USDC" or "SOL". */
  token: string;
  /** In the token's units, e.g. "1.25" USDC or "0.5" SOL. */
  amount: string;
  /** Description shown to the payer in their wallet. */
  memo: string;
  paymentUrl: string;
  /** Unix ms. */
  createdAt: number;
  expiresAt: number;
  status: ServerInvoiceStatus;
  /** Block time of the paying transaction, unix ms. */
  paidAt: number | null;
  signature: string | null;
  canceledAt: number | null;
  /** The latest transaction that carried the reference but paid the wrong token, wallet or amount. */
  issue: PaymentIssue | null;
  /** The product this invoice is an order of, if any. */
  productId: string | null;
  product: ProductInfo | null;
  /** The wallet that paid, once it's paid. */
  payer: string | null;
  /** The buyer's cNFT proof-of-purchase, for a paid order that issues one. */
  receipt: Receipt | null;
}

/** A product as the API returns it. Everything here is on its public Blink card anyway. */
export type PublicProduct = Product;

export interface CreateProductRequest {
  network: NetworkId;
  /** Must be the signed-in wallet: sales pay it. */
  merchant: string;
  title: string;
  description: string;
  /** Absolute https URL, or null for none. */
  image: string | null;
  currency: Currency;
  /** In `currency`'s units, e.g. "49.99" USDC; see parseAmount for the rules. */
  amount: string;
}

export interface VerificationResult {
  status: VerificationStatus;
  invoiceId: string;
  reference: string;
  /** The invoice's state after this check. */
  invoiceStatus: ServerInvoiceStatus;
  /** The transaction that paid (VERIFIED_PAID) or the one that was wrong. */
  signature: string | null;
  /** Unix seconds. */
  blockTime: number | null;
  message: string | null;
  /** This check is the one that marked the invoice paid (and queued its webhook). */
  settledNow: boolean;
}

/** Either an amount the merchant names, or an order of one of their products (price and title from the product). */
export type CreateInvoiceRequest =
  | {
      network: NetworkId;
      recipient: string;
      /** What the payer pays in: the network's USDC (SPL token) or native SOL. */
      currency: Currency;
      /** In `currency`'s units, e.g. "49.99" USDC or "0.001" SOL. See parseAmount for the rules. */
      amount: string;
      memo: string;
      kind: "invoice" | "link";
      productId?: undefined;
    }
  | {
      network: NetworkId;
      recipient: string;
      productId: string;
    };

export interface CreateInvoiceResponse {
  invoice: PublicInvoice;
}

/** Body of a `payment.succeeded` webhook. `id` is the same on every delivery attempt: use it to deduplicate. */
export interface PaymentSucceededEvent {
  id: string;
  event: "payment.succeeded";
  invoiceId: string;
  amount: string;
  token: string;
  signature: string;
  /** Block time, unix seconds. */
  timestamp: number;
  reference: string;
  network: NetworkId;
}

/** The webhook part of GET /api/health. */
export interface WebhookHealth {
  /** SOLAGENT_WEBHOOK_URL is set. */
  configured: boolean;
  /** SOLAGENT_WEBHOOK_SECRET is set, so deliveries carry X-SolAgent-Signature. */
  signed: boolean;
  queued: number;
  delivered: number;
  failed: number;
}

export class InvoiceApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** An API failure in words for the merchant or payer. */
export function describeApiError(error: unknown): string {
  if (error instanceof InvoiceApiError) return error.message;
  // Sign-in failures (lib/auth-api) are already worded for the merchant. By name, to keep the modules acyclic.
  if (error instanceof Error && error.name === "SignInError") return error.message;
  return "Couldn't reach the payment server. Check your connection and try again.";
}

/** A JSON request to the payment server; non-2xx answers throw InvoiceApiError with the server's message. */
export async function apiCall<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body && typeof body === "object" && "error" in body ? String(body.error) : response.statusText;
    throw new InvoiceApiError(response.status, message || `Request failed (${response.status})`);
  }
  return body as T;
}

const path = (reference: string) => `/api/invoices/${encodeURIComponent(reference)}`;

export const invoiceApi = {
  /** Needs the merchant session cookie (lib/auth-api), for the wallet the invoice pays. */
  create: (input: CreateInvoiceRequest) => apiCall<CreateInvoiceResponse>("/api/invoices", { method: "POST", body: JSON.stringify(input) }),

  /** Invoices the server knows among `references`; unknown ones are left out. */
  list: async (references: readonly string[]) =>
    references.length === 0
      ? []
      : (await apiCall<{ invoices: PublicInvoice[] }>(`/api/invoices?references=${references.map(encodeURIComponent).join(",")}`)).invoices,

  /** Null when the server doesn't know this reference (a link made elsewhere, or demo data). */
  get: async (reference: string) => {
    try {
      return await apiCall<PublicInvoice>(path(reference));
    } catch (error) {
      if (error instanceof InvoiceApiError && error.status === 404) return null;
      throw error;
    }
  },

  /** Asks the server to check the chain now. Null when it doesn't know this reference. */
  verify: async (reference: string, invoiceId: string) => {
    try {
      return await apiCall<VerificationResult>(`${path(reference)}/verify`, { method: "POST", body: JSON.stringify({ invoiceId }) });
    } catch (error) {
      if (error instanceof InvoiceApiError && error.status === 404) return null;
      throw error;
    }
  },

  /** Needs the merchant session cookie (lib/auth-api): only the wallet the invoice pays can cancel it. */
  cancel: (reference: string) => apiCall<PublicInvoice>(`${path(reference)}/cancel`, { method: "POST" }),

  webhookHealth: async () => (await apiCall<{ webhooks: WebhookHealth }>("/api/health")).webhooks,

  /**
   * Needs the merchant session cookie. The merchant's latest product orders on `network`, newest first: Blink
   * purchases included, which no browser of theirs created.
   */
  orders: async (network: NetworkId) =>
    (await apiCall<{ invoices: PublicInvoice[] }>(`/api/orders?network=${encodeURIComponent(network)}`)).invoices,

  /** Needs the merchant session cookie. Mints (again) the buyer's cNFT receipt for a paid order. */
  mintReceipt: (reference: string) =>
    apiCall<PublicInvoice>("/api/receipts/mint", { method: "POST", body: JSON.stringify({ reference }) }),
};

/** Products: every call needs the merchant session cookie (lib/auth-api). */
export const productApi = {
  create: (input: CreateProductRequest) =>
    apiCall<{ product: PublicProduct }>("/api/products", { method: "POST", body: JSON.stringify(input) }),

  /** The merchant's products on sale on `network`, newest first. */
  list: async (network: NetworkId) =>
    (await apiCall<{ products: PublicProduct[] }>(`/api/products?network=${encodeURIComponent(network)}`)).products,

  /** Takes a product off sale: its Blink shows as unavailable from then on. Orders already open stay payable. */
  archive: (id: string) => apiCall<{ product: PublicProduct }>(`/api/products/${encodeURIComponent(id)}/archive`, { method: "POST" }),
};

/** The dashboard's view of a server invoice. `local` keeps what only this browser knows. */
export function toClientInvoice(server: PublicInvoice, local: Pick<Invoice, "client">): Invoice {
  return {
    id: server.id,
    kind: server.kind,
    client: local.client,
    memo: server.memo,
    amount: server.amount,
    createdAt: server.createdAt,
    expiresAt: server.expiresAt,
    ...(server.paidAt !== null ? { paidAt: server.paidAt } : {}),
    ...(server.signature !== null ? { signature: server.signature } : {}),
    ...(server.canceledAt !== null ? { canceledAt: server.canceledAt } : {}),
    ...(server.issue ? { issue: server.issue } : {}),
    recipient: server.recipient,
    mint: server.mint,
    reference: server.reference,
    paymentUrl: server.paymentUrl,
    tracked: true,
    ...(server.productId !== null ? { productId: server.productId } : {}),
    ...(server.product ? { product: server.product } : {}),
    ...(server.payer !== null ? { payer: server.payer } : {}),
    ...(server.receipt ? { receipt: server.receipt } : {}),
  };
}
