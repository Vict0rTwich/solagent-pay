import { promises as fs } from "node:fs";
import path from "node:path";

import type { ServerInvoiceStatus } from "@/lib/invoice-api";
import type { NetworkId } from "@/lib/network";
import type { PaymentIssue, Product } from "@/lib/types";

import {
  EVENT_RETENTION_MS,
  FIRST_INVOICE_NUMBER,
  KEY_VOLUME_RETENTION_MS,
  duplicateReference,
  newInvoiceRecord,
  notFound,
  newReceipt,
  paymentSucceededEvent,
  receiptQueueable,
  settlementReceipt,
  tooManyKeys,
  tooManyOpen,
  tooManyProducts,
  type ApiKeyRecord,
  type CancelResult,
  type InvoiceRecord,
  type MarkPaidResult,
  type NewInvoiceRecord,
  type PaymentStore,
  type ReceiptPatch,
  type Settlement,
  type WebhookEventPatch,
  type WebhookEventRecord,
} from "./types";

// One JSON file, loaded once and kept in memory. Every change runs one at a time on a copy, is written to a
// temporary file and renamed over the old one, and only then becomes the live state, so a crash mid-write
// never leaves a half-written file or a change that exists in memory but not on disk. That makes it correct
// for one server process; several processes (or serverless instances) need DatabaseInvoiceStore.

interface StoreData {
  version: 1;
  /** By reference key. */
  invoices: Record<string, InvoiceRecord>;
  /** Signature -> the reference of the invoice it settled. One transfer settles one invoice, ever. */
  settledBy: Record<string, string>;
  /** Last invoice number per "<network>:<recipient>". */
  sequences: Record<string, number>;
  events: Record<string, WebhookEventRecord>;
  /** Spent sign-in nonces -> when they can be forgotten (unix ms). */
  nonces: Record<string, number>;
  /** Signed-out session ids -> when the session would have expired anyway (unix ms). */
  revokedSessions: Record<string, number>;
  /** API keys by id (hashes only). */
  apiKeys: Record<string, ApiKeyRecord>;
  /** "<key id>:<UTC day ms>" -> USDC cents of invoices that key created that day. */
  keyVolume: Record<string, number>;
  /** Invoice reference -> the redemption that spent it. One per invoice, ever. */
  redemptions: Record<string, { keyId: string; at: number }>;
  /** Products by id, archived ones included (their orders still name them). */
  products: Record<string, Product>;
}

function emptyData(): StoreData {
  return {
    version: 1,
    invoices: {},
    settledBy: {},
    sequences: {},
    events: {},
    nonces: {},
    revokedSessions: {},
    apiKeys: {},
    keyVolume: {},
    redemptions: {},
    products: {},
  };
}

const volumeKey = (id: string, day: number) => `${id}:${day}`;

/** Drops entries whose expiry has passed. */
function prune(entries: Record<string, number>, now: number): void {
  for (const [key, expiresAt] of Object.entries(entries)) if (expiresAt <= now) delete entries[key];
}

export class FileInvoiceStore implements PaymentStore {
  private data: StoreData | null = null;
  private loading: Promise<StoreData> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly file: string;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, "payments.json");
  }

  private load(): Promise<StoreData> {
    if (this.data) return Promise.resolve(this.data);
    this.loading ??= (async () => {
      try {
        const parsed = JSON.parse(await fs.readFile(this.file, "utf8")) as StoreData;
        if (parsed.version !== 1) throw new Error(`Unsupported store version ${String(parsed.version)} in ${this.file}`);
        // Files from before sign-in (or API keys, or products) don't have those maps yet.
        this.data = { ...emptyData(), ...parsed };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        this.data = emptyData();
      }
      return this.data;
    })();
    return this.loading;
  }

  /** Runs `change` alone, on a copy that replaces the live state only once it's safely on disk. */
  private transaction<T>(change: (draft: StoreData) => T): Promise<T> {
    const run = this.queue.then(async () => {
      const draft = structuredClone(await this.load());
      const result = change(draft);
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const temporary = `${this.file}.${process.pid}.tmp`;
      await fs.writeFile(temporary, JSON.stringify(draft), "utf8");
      await fs.rename(temporary, this.file);
      this.data = draft;
      return result;
    });
    this.queue = run.catch(() => {});
    return run;
  }

  async get(reference: string): Promise<InvoiceRecord | null> {
    return (await this.load()).invoices[reference] ?? null;
  }

  async openInvoices(): Promise<InvoiceRecord[]> {
    return Object.values((await this.load()).invoices).filter((invoice) => invoice.status === "pending");
  }

  async settledInvoiceFor(signature: string): Promise<string | null> {
    return (await this.load()).settledBy[signature] ?? null;
  }

  async listOrders(recipient: string, network: NetworkId, limit: number): Promise<InvoiceRecord[]> {
    return Object.values((await this.load()).invoices)
      .filter((invoice) => invoice.recipient === recipient && invoice.network === network && invoice.productId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  create(input: NewInvoiceRecord, maxOpen: number): Promise<InvoiceRecord> {
    return this.transaction((draft) => {
      if (draft.invoices[input.reference]) throw duplicateReference();
      const open = Object.values(draft.invoices).filter((invoice) => invoice.status === "pending").length;
      if (open >= maxOpen) throw tooManyOpen();

      const sequenceKey = `${input.network}:${input.recipient}`;
      const number = Math.max(FIRST_INVOICE_NUMBER - 1, draft.sequences[sequenceKey] ?? 0) + 1;
      draft.sequences[sequenceKey] = number;
      const invoice = newInvoiceRecord(input, number);
      draft.invoices[input.reference] = invoice;
      return invoice;
    });
  }

  markPaid(reference: string, payment: Settlement): Promise<MarkPaidResult> {
    return this.transaction((draft): MarkPaidResult => {
      const invoice = draft.invoices[reference];
      if (!invoice) throw notFound();
      if (invoice.status === "paid") {
        if (invoice.signature !== payment.signature && !invoice.duplicateSignatures.includes(payment.signature)) {
          invoice.duplicateSignatures.push(payment.signature);
        }
        return { changed: false, invoice, reason: "already_paid" };
      }
      if (invoice.status !== "pending") return { changed: false, invoice, reason: "not_pending" };
      const owner = draft.settledBy[payment.signature];
      if (owner && owner !== reference) return { changed: false, invoice, reason: "signature_used" };

      invoice.status = "paid";
      invoice.signature = payment.signature;
      invoice.blockTime = payment.blockTime;
      invoice.paidAt = payment.blockTime * 1000;
      invoice.issue = null;
      invoice.payer = payment.payer;
      invoice.receipt = settlementReceipt(invoice, payment);
      draft.settledBy[payment.signature] = reference;
      const event = paymentSucceededEvent(invoice, payment);
      draft.events[event.id] ??= event;
      return { changed: true, invoice };
    });
  }

  recordDuplicates(reference: string, signatures: readonly string[]): Promise<void> {
    return this.transaction((draft) => {
      const invoice = draft.invoices[reference];
      if (!invoice) return;
      for (const signature of signatures) {
        if (signature !== invoice.signature && !invoice.duplicateSignatures.includes(signature)) invoice.duplicateSignatures.push(signature);
      }
    });
  }

  /** No write when it's the one already recorded. */
  async recordIssue(reference: string, issue: PaymentIssue): Promise<void> {
    const current = await this.get(reference);
    if (!current || current.status !== "pending" || current.issue?.signature === issue.signature) return;
    await this.transaction((draft) => {
      const invoice = draft.invoices[reference];
      if (invoice?.status === "pending") invoice.issue = issue;
    });
  }

  expire(reference: string, now = Date.now()): Promise<{ changed: boolean; invoice: InvoiceRecord | null }> {
    return this.transaction((draft) => {
      const invoice = draft.invoices[reference];
      if (!invoice || invoice.status !== "pending" || invoice.expiresAt > now) return { changed: false, invoice: invoice ?? null };
      invoice.status = "expired";
      invoice.expiredAt = now;
      return { changed: true, invoice };
    });
  }

  cancel(reference: string, merchant: string): Promise<CancelResult> {
    return this.transaction((draft): CancelResult => {
      const invoice = draft.invoices[reference];
      if (!invoice) throw notFound();
      if (invoice.recipient !== merchant) return { result: "forbidden", invoice };
      if (invoice.status !== "pending") return { result: "not_pending", invoice };
      invoice.status = "canceled";
      invoice.canceledAt = Date.now();
      return { result: "canceled", invoice };
    });
  }

  private static due(data: StoreData, now: number): WebhookEventRecord | undefined {
    return Object.values(data.events)
      .filter((event) => event.status === "pending" && event.nextAttemptAt <= now)
      .sort((a, b) => a.createdAt - b.createdAt)[0];
  }

  /** No write when nothing is due, which is almost every sweep. */
  async claimDueEvent(leaseMs: number, now = Date.now()): Promise<WebhookEventRecord | null> {
    if (!FileInvoiceStore.due(await this.load(), now)) return null;
    return this.transaction((draft) => {
      const event = FileInvoiceStore.due(draft, now);
      if (!event) return null;
      event.nextAttemptAt = now + leaseMs;
      return event;
    });
  }

  async pendingEventCount(): Promise<number> {
    return Object.values((await this.load()).events).filter((event) => event.status === "pending").length;
  }

  updateEvent(id: string, patch: WebhookEventPatch): Promise<void> {
    return this.transaction((draft) => {
      const event = draft.events[id];
      if (event) Object.assign(event, patch);
      // Housekeeping: finished events past retention go.
      const cutoff = Date.now() - EVENT_RETENTION_MS;
      for (const [key, old] of Object.entries(draft.events)) {
        if ((old.status === "delivered" || old.status === "skipped") && (old.deliveredAt ?? old.createdAt) < cutoff) delete draft.events[key];
      }
    });
  }

  private static dueReceipt(data: StoreData, now: number): InvoiceRecord | undefined {
    return Object.values(data.invoices)
      .filter((invoice) => invoice.receipt?.status === "pending" && invoice.receipt.nextAttemptAt <= now)
      .sort((a, b) => (a.paidAt ?? 0) - (b.paidAt ?? 0))[0];
  }

  /** No write when nothing is due, which is almost every sweep. */
  async claimDueReceipt(leaseMs: number, now = Date.now()): Promise<InvoiceRecord | null> {
    if (!FileInvoiceStore.dueReceipt(await this.load(), now)) return null;
    return this.transaction((draft) => {
      const invoice = FileInvoiceStore.dueReceipt(draft, now);
      if (!invoice?.receipt) return null;
      invoice.receipt.nextAttemptAt = now + leaseMs;
      return invoice;
    });
  }

  updateReceipt(reference: string, patch: ReceiptPatch): Promise<void> {
    return this.transaction((draft) => {
      const receipt = draft.invoices[reference]?.receipt;
      if (receipt) Object.assign(receipt, patch);
    });
  }

  queueReceipt(reference: string, owner: string, now = Date.now()): Promise<InvoiceRecord | null> {
    return this.transaction((draft) => {
      const invoice = draft.invoices[reference];
      if (!invoice) return null;
      if (invoice.status === "paid" && receiptQueueable(invoice.receipt ?? null)) invoice.receipt = newReceipt(owner, now);
      return invoice;
    });
  }

  async stats(): Promise<Record<ServerInvoiceStatus, number>> {
    const counts: Record<ServerInvoiceStatus, number> = { pending: 0, paid: 0, expired: 0, canceled: 0 };
    for (const invoice of Object.values((await this.load()).invoices)) counts[invoice.status]++;
    return counts;
  }

  consumeNonce(nonce: string, expiresAt: number): Promise<boolean> {
    return this.transaction((draft) => {
      prune(draft.nonces, Date.now());
      if (draft.nonces[nonce] !== undefined) return false;
      draft.nonces[nonce] = expiresAt;
      return true;
    });
  }

  revokeSession(sessionId: string, expiresAt: number): Promise<void> {
    return this.transaction((draft) => {
      prune(draft.revokedSessions, Date.now());
      draft.revokedSessions[sessionId] = expiresAt;
    });
  }

  async isSessionRevoked(sessionId: string): Promise<boolean> {
    return (await this.load()).revokedSessions[sessionId] !== undefined;
  }

  createApiKey(record: ApiKeyRecord, maxActive: number): Promise<ApiKeyRecord> {
    return this.transaction((draft) => {
      const active = Object.values(draft.apiKeys).filter((key) => key.merchant === record.merchant && key.revokedAt === null).length;
      if (active >= maxActive) throw tooManyKeys(maxActive);
      draft.apiKeys[record.id] = record;
      return record;
    });
  }

  async listApiKeys(merchant: string): Promise<ApiKeyRecord[]> {
    return Object.values((await this.load()).apiKeys)
      .filter((key) => key.merchant === merchant)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  async findApiKeyByHash(hash: string): Promise<ApiKeyRecord | null> {
    return Object.values((await this.load()).apiKeys).find((key) => key.hash === hash) ?? null;
  }

  revokeApiKey(id: string, merchant: string, now = Date.now()): Promise<ApiKeyRecord | null> {
    return this.transaction((draft) => {
      const key = draft.apiKeys[id];
      if (!key || key.merchant !== merchant) return null;
      key.revokedAt ??= now;
      return key;
    });
  }

  reserveKeyVolume(id: string, day: number, cents: number, capCents: number, now = Date.now()): Promise<{ ok: boolean; usedCents: number }> {
    return this.transaction((draft) => {
      // Housekeeping: only today's (and yesterday's, across the UTC boundary) volume matters.
      for (const key of Object.keys(draft.keyVolume)) {
        if (Number(key.slice(key.lastIndexOf(":") + 1)) < now - KEY_VOLUME_RETENTION_MS) delete draft.keyVolume[key];
      }
      const used = draft.keyVolume[volumeKey(id, day)] ?? 0;
      if (used + cents > capCents) return { ok: false, usedCents: used };
      draft.keyVolume[volumeKey(id, day)] = used + cents;
      const apiKey = draft.apiKeys[id];
      if (apiKey) apiKey.lastUsedAt = now;
      return { ok: true, usedCents: used + cents };
    });
  }

  releaseKeyVolume(id: string, day: number, cents: number): Promise<void> {
    return this.transaction((draft) => {
      const used = draft.keyVolume[volumeKey(id, day)];
      if (used !== undefined) draft.keyVolume[volumeKey(id, day)] = Math.max(0, used - cents);
    });
  }

  async keyVolume(ids: readonly string[], day: number): Promise<Record<string, number>> {
    const data = await this.load();
    const volume: Record<string, number> = {};
    for (const id of ids) {
      const used = data.keyVolume[volumeKey(id, day)];
      if (used !== undefined) volume[id] = used;
    }
    return volume;
  }

  async redeemInvoice(reference: string, keyId: string, now = Date.now()): Promise<boolean> {
    if ((await this.load()).redemptions[reference]) return false;
    return this.transaction((draft) => {
      if (draft.redemptions[reference]) return false;
      draft.redemptions[reference] = { keyId, at: now };
      return true;
    });
  }

  createProduct(product: Product, maxActive: number): Promise<Product> {
    return this.transaction((draft) => {
      const onSale = Object.values(draft.products).filter((p) => p.merchant === product.merchant && p.archivedAt === null).length;
      if (onSale >= maxActive) throw tooManyProducts(maxActive);
      draft.products[product.id] = product;
      return product;
    });
  }

  async getProduct(id: string): Promise<Product | null> {
    return (await this.load()).products[id] ?? null;
  }

  async listProducts(merchant: string, network: NetworkId): Promise<Product[]> {
    return Object.values((await this.load()).products)
      .filter((product) => product.merchant === merchant && product.network === network && product.archivedAt === null)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  archiveProduct(id: string, merchant: string, now = Date.now()): Promise<Product | null> {
    return this.transaction((draft) => {
      const product = draft.products[id];
      if (!product || product.merchant !== merchant) return null;
      product.archivedAt ??= now;
      return product;
    });
  }
}
