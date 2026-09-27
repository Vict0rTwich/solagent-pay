import type { PaymentSucceededEvent, PublicInvoice, ServerInvoiceStatus } from "@/lib/invoice-api";
import type { NetworkId } from "@/lib/network";
import { assetSymbol, formatAmount } from "@/lib/solana-pay";
import type { PaymentIssue, Product, ProductInfo, Receipt } from "@/lib/types";

// The payment server's records: invoices, which transaction settled each one, the webhook outbox, receipts to
// mint, products, and sign-in bookkeeping. One interface, two adapters:
//
// - FileInvoiceStore: a JSON file with one writer. Local development and single-process deployments.
// - DatabaseInvoiceStore: PostgreSQL. Several processes or serverless instances sharing one state.
//
// Both keep these rules under concurrency (the database adapter across processes, too):
// - An invoice leaves "pending" at most once: markPaid, expire and cancel only change a pending invoice.
// - A signature settles at most one invoice, ever.
// - `payment.succeeded`, and the buyer's receipt when the invoice issues one, are queued in the same atomic write
//   that marks the invoice paid, under ids derived from the invoice, so each is queued exactly once.
// - A webhook event, or a receipt, is claimed by one worker at a time.
// - A sign-in nonce is accepted once.

/** A receipt as the minter tracks it: the public part plus its retry bookkeeping. */
export interface ReceiptRecord extends Receipt {
  /** Underdog's id for the mint request that succeeded. */
  transactionId: string | null;
  attempts: number;
  /** When the next attempt is due; while one runs, the end of its lease (as for webhook events). */
  nextAttemptAt: number;
}

export type ReceiptPatch = Partial<Omit<ReceiptRecord, "owner">>;

export interface InvoiceRecord extends Omit<PublicInvoice, "issue" | "receipt"> {
  issue: PaymentIssue | null;
  /** Block time of the paying transaction, unix seconds. */
  blockTime: number | null;
  /** Later transactions that also paid this invoice: money to refund, never a second settlement. */
  duplicateSignatures: string[];
  expiredAt: number | null;
  /** Whether settling it queues a cNFT receipt for the buyer: product orders and dashboard invoices do. */
  issueReceipt: boolean;
  receipt: ReceiptRecord | null;
}

export type WebhookDelivery = "pending" | "delivered" | "failed" | "skipped";

export interface WebhookEventRecord {
  id: string;
  reference: string;
  payload: PaymentSucceededEvent;
  status: WebhookDelivery;
  attempts: number;
  createdAt: number;
  nextAttemptAt: number;
  deliveredAt: number | null;
  lastError: string | null;
}

export type WebhookEventPatch = Partial<Pick<WebhookEventRecord, "status" | "attempts" | "nextAttemptAt" | "deliveredAt" | "lastError">>;

export interface NewInvoiceRecord {
  reference: string;
  network: NetworkId;
  kind: "invoice" | "link";
  recipient: string;
  /** SPL mint to pay in; null for native SOL. */
  mint: string | null;
  /** In the asset's own units, canonical. */
  amount: string;
  memo: string;
  /** Builds the payment link once the invoice number is known (it goes in the memo). */
  paymentUrl: (id: string) => string;
  expiresAt: number;
  /** The product it's an order of, with what the product said when it was ordered. */
  product: { id: string; info: ProductInfo } | null;
  issueReceipt: boolean;
}

/** How an invoice was paid: the settling transaction, and the wallet it came from when that's known. */
export interface Settlement {
  signature: string;
  /** Unix seconds. */
  blockTime: number;
  payer: string | null;
}

export interface MarkPaidResult {
  changed: boolean;
  invoice: InvoiceRecord;
  reason?: "already_paid" | "not_pending" | "signature_used";
}

export interface CancelResult {
  result: "canceled" | "forbidden" | "not_pending";
  invoice: InvoiceRecord;
}

export interface InvoiceStore {
  get(reference: string): Promise<InvoiceRecord | null>;
  openInvoices(): Promise<InvoiceRecord[]>;
  /** The reference of the invoice this signature settled, if any. */
  settledInvoiceFor(signature: string): Promise<string | null>;
  /** Stores a new invoice with the next number for its recipient. */
  create(input: NewInvoiceRecord, maxOpen: number): Promise<InvoiceRecord>;
  /** The merchant's latest product orders on a network, newest first. */
  listOrders(recipient: string, network: NetworkId, limit: number): Promise<InvoiceRecord[]>;
  /**
   * The one way an invoice becomes paid, and it happens at most once: only from "pending", only with a signature
   * that hasn't settled another invoice. The same atomic write records the signature and payer, queues
   * `payment.succeeded`, and queues the buyer's receipt when the invoice issues one and the payer is known.
   */
  markPaid(reference: string, payment: Settlement): Promise<MarkPaidResult>;
  /** Later payments of an already paid invoice, kept for refunds. */
  recordDuplicates(reference: string, signatures: readonly string[]): Promise<void>;
  /** The latest wrong payment attempt, for an invoice still waiting. */
  recordIssue(reference: string, issue: PaymentIssue): Promise<void>;
  /** pending -> expired, once its deadline has passed. */
  expire(reference: string, now?: number): Promise<{ changed: boolean; invoice: InvoiceRecord | null }>;
  /** pending -> canceled, only for the wallet the invoice pays. */
  cancel(reference: string, merchant: string): Promise<CancelResult>;
  /**
   * The oldest webhook event that's due, leased to the caller: its next attempt moves `leaseMs` ahead, so no other
   * deliverer takes it meanwhile. If the caller dies mid-delivery, it's due again once the lease runs out.
   */
  claimDueEvent(leaseMs: number, now?: number): Promise<WebhookEventRecord | null>;
  pendingEventCount(): Promise<number>;
  updateEvent(id: string, patch: WebhookEventPatch): Promise<void>;
  /** The paid invoice whose receipt has waited longest to be minted, leased to the caller like claimDueEvent. */
  claimDueReceipt(leaseMs: number, now?: number): Promise<InvoiceRecord | null>;
  /** Records a mint attempt's outcome. No-op for an invoice without a receipt. */
  updateReceipt(reference: string, patch: ReceiptPatch): Promise<void>;
  /**
   * Queues a receipt for a paid invoice again: one whose mint failed or was only simulated, or one never queued
   * (e.g. an API-key invoice). Changes nothing while it's pending or once it's minted, or when the invoice isn't paid.
   */
  queueReceipt(reference: string, owner: string, now?: number): Promise<InvoiceRecord | null>;
  stats(): Promise<Record<ServerInvoiceStatus, number>>;
}

export interface ProductStore {
  /** Stores a new product, unless the merchant already has `maxActive` on sale. */
  createProduct(product: Product, maxActive: number): Promise<Product>;
  getProduct(id: string): Promise<Product | null>;
  /** The merchant's products still on sale on `network`, newest first. */
  listProducts(merchant: string, network: NetworkId): Promise<Product[]>;
  /** Takes one of the merchant's products off sale. Null when they have no product with that id. */
  archiveProduct(id: string, merchant: string, now?: number): Promise<Product | null>;
}

export interface AuthStore {
  /** Records a sign-in nonce as spent until `expiresAt`. False when it already was: a replay. */
  consumeNonce(nonce: string, expiresAt: number): Promise<boolean>;
  /** Ends a session before it expires (sign-out). */
  revokeSession(sessionId: string, expiresAt: number): Promise<void>;
  isSessionRevoked(sessionId: string): Promise<boolean>;
}

/**
 * A merchant API key. Only its SHA-256 is stored: the key itself is shown once, when it's created. A key can only
 * create USDC invoices that pay its merchant's wallet, on its environment's networks, up to its daily cap.
 */
export interface ApiKeyRecord {
  id: string;
  /** The wallet that created the key, and the only one its invoices can pay. */
  merchant: string;
  name: string;
  /** "test" keys work on devnet and localnet, "live" keys on mainnet-beta. */
  environment: KeyEnvironment;
  /** SHA-256 of the full key, hex. */
  hash: string;
  /** "sp_test_9fA2…x3aQ": enough to recognize it, not to use it. */
  preview: string;
  /** Most USDC, in cents, the key's invoices may request per UTC day. */
  dailyCapCents: number;
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

export type KeyEnvironment = "test" | "live";

export interface KeyStore {
  /** Stores a new key, unless the merchant already has `maxActive` unrevoked ones. */
  createApiKey(record: ApiKeyRecord, maxActive: number): Promise<ApiKeyRecord>;
  /** The merchant's keys, newest first, revoked ones included. */
  listApiKeys(merchant: string): Promise<ApiKeyRecord[]>;
  findApiKeyByHash(hash: string): Promise<ApiKeyRecord | null>;
  /** Revokes one of the merchant's keys. Null when it has no key with that id. */
  revokeApiKey(id: string, merchant: string, now?: number): Promise<ApiKeyRecord | null>;
  /**
   * Adds `cents` to the key's volume for `day` (UTC midnight, unix ms) only if the total stays within `capCents`,
   * atomically, and records the use. `ok: false` leaves the volume unchanged; `usedCents` is the day's total after.
   */
  reserveKeyVolume(id: string, day: number, cents: number, capCents: number, now?: number): Promise<{ ok: boolean; usedCents: number }>;
  /** Gives back a reservation whose invoice wasn't created after all. */
  releaseKeyVolume(id: string, day: number, cents: number): Promise<void>;
  /** Each key's volume for `day`, in cents; keys with none are left out. */
  keyVolume(ids: readonly string[], day: number): Promise<Record<string, number>>;
  /**
   * Redeems a paid invoice for the request it paid for: true for the first call only, ever. That's what makes an
   * HTTP 402 payment single-use, across every instance.
   */
  redeemInvoice(reference: string, keyId: string, now?: number): Promise<boolean>;
}

export type PaymentStore = InvoiceStore & AuthStore & KeyStore & ProductStore;

export class StoreError extends Error {
  override readonly name = "StoreError";
  constructor(
    readonly code: "not_found" | "duplicate_reference" | "too_many_open" | "too_many_keys" | "too_many_products",
    message: string,
  ) {
    super(message);
  }
}

/**
 * By name, not `instanceof`: the runtime is shared through globalThis and may have been created by another
 * bundle (instrumentation vs a route), whose StoreError is a different class with the same name.
 */
export function isStoreError(error: unknown, code?: StoreError["code"]): error is StoreError {
  return error instanceof Error && error.name === "StoreError" && (code === undefined || (error as StoreError).code === code);
}

export const FIRST_INVOICE_NUMBER = 1001;
/** Delivered and skipped webhook events are kept this long for inspection, then dropped. */
export const EVENT_RETENTION_MS = 7 * 24 * 60 * 60_000;

export const notFound = () => new StoreError("not_found", "No invoice with that reference.");
export const duplicateReference = () => new StoreError("duplicate_reference", "That reference key is already in use.");
export const tooManyOpen = () => new StoreError("too_many_open", "Too many open invoices. Try again when some are paid or expire.");
export const tooManyKeys = (max: number) => new StoreError("too_many_keys", `You can have at most ${max} active API keys. Revoke one first.`);
export const tooManyProducts = (max: number) =>
  new StoreError("too_many_products", `You can have at most ${max} products on sale. Archive one first.`);

/** A fresh receipt for `owner`, due now. */
export function newReceipt(owner: string, now = Date.now()): ReceiptRecord {
  return { status: "pending", owner, mintAddress: null, mintedAt: null, note: null, transactionId: null, attempts: 0, nextAttemptAt: now };
}

/** The receipt markPaid queues: one for the buyer when the invoice issues receipts and the payer is known. */
export function settlementReceipt(invoice: Pick<InvoiceRecord, "issueReceipt" | "receipt">, payment: Settlement, now = Date.now()): ReceiptRecord | null {
  if (invoice.receipt) return invoice.receipt;
  return invoice.issueReceipt && payment.payer ? newReceipt(payment.payer, now) : null;
}

/** Whether a receipt can be (re)queued: none yet, the last one failed, or it was only simulated (no Underdog key then). */
export function receiptQueueable(receipt: ReceiptRecord | null): boolean {
  return receipt === null || receipt.status === "failed" || receipt.status === "simulated";
}

/** Per-key daily volume is kept this long, then dropped: the cap only ever looks at today. */
export const KEY_VOLUME_RETENTION_MS = 2 * 24 * 60 * 60_000;

export function newInvoiceRecord(input: NewInvoiceRecord, number: number, now = Date.now()): InvoiceRecord {
  const id = `INV-${number}`;
  return {
    id,
    reference: input.reference,
    network: input.network,
    kind: input.kind,
    recipient: input.recipient,
    mint: input.mint,
    token: assetSymbol(input.mint),
    amount: input.amount,
    memo: input.memo,
    paymentUrl: input.paymentUrl(id),
    createdAt: now,
    expiresAt: input.expiresAt,
    status: "pending",
    paidAt: null,
    signature: null,
    blockTime: null,
    canceledAt: null,
    expiredAt: null,
    issue: null,
    duplicateSignatures: [],
    productId: input.product?.id ?? null,
    product: input.product?.info ?? null,
    payer: null,
    issueReceipt: input.issueReceipt,
    receipt: null,
  };
}

/** The `payment.succeeded` event for an invoice just marked paid. Its id is derived from the invoice. */
export function paymentSucceededEvent(invoice: InvoiceRecord, payment: Settlement, now = Date.now()): WebhookEventRecord {
  const id = `evt_paid_${invoice.reference}`;
  return {
    id,
    reference: invoice.reference,
    payload: {
      id,
      event: "payment.succeeded",
      invoiceId: invoice.id,
      amount: formatAmount(invoice.amount),
      token: invoice.token,
      signature: payment.signature,
      timestamp: payment.blockTime,
      reference: invoice.reference,
      network: invoice.network,
    },
    status: "pending",
    attempts: 0,
    createdAt: now,
    nextAttemptAt: now,
    deliveredAt: null,
    lastError: null,
  };
}

/** What the public API returns: a whitelist, so nothing added to the record later leaks by default. */
export function toPublicInvoice(record: InvoiceRecord): PublicInvoice {
  return {
    id: record.id,
    reference: record.reference,
    network: record.network,
    kind: record.kind,
    recipient: record.recipient,
    mint: record.mint,
    token: record.token,
    amount: record.amount,
    memo: record.memo,
    paymentUrl: record.paymentUrl,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    status: record.status,
    paidAt: record.paidAt,
    signature: record.signature,
    canceledAt: record.canceledAt,
    issue: record.issue,
    // Records from before products and receipts don't have these fields.
    productId: record.productId ?? null,
    product: record.product ?? null,
    payer: record.payer ?? null,
    receipt: record.receipt
      ? {
          status: record.receipt.status,
          owner: record.receipt.owner,
          mintAddress: record.receipt.mintAddress,
          mintedAt: record.receipt.mintedAt,
          note: record.receipt.note,
        }
      : null,
  };
}
