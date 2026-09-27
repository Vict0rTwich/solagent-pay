import type { Pool, PoolClient } from "pg";

import type { ServerInvoiceStatus } from "@/lib/invoice-api";
import type { NetworkId } from "@/lib/network";
import type { PaymentIssue, Product, ProductInfo } from "@/lib/types";

import {
  EVENT_RETENTION_MS,
  FIRST_INVOICE_NUMBER,
  KEY_VOLUME_RETENTION_MS,
  duplicateReference,
  newInvoiceRecord,
  notFound,
  newReceipt,
  paymentSucceededEvent,
  settlementReceipt,
  tooManyKeys,
  tooManyOpen,
  tooManyProducts,
  type ApiKeyRecord,
  type CancelResult,
  type KeyEnvironment,
  type InvoiceRecord,
  type MarkPaidResult,
  type NewInvoiceRecord,
  type PaymentStore,
  type ReceiptPatch,
  type ReceiptRecord,
  type Settlement,
  type WebhookDelivery,
  type WebhookEventPatch,
  type WebhookEventRecord,
} from "./types";

// PostgreSQL adapter, for several server processes or serverless instances (e.g. Vercel) sharing one state.
// Schema: web/db/schema.sql.
//
// Nothing is cached in memory: every read goes to the database, and every transition is either one conditional
// UPDATE (`... WHERE status = 'pending'`) or one transaction that holds the invoice's row lock. Unique keys are
// the final word where two instances could race: settlements.signature (one transfer settles one invoice),
// webhook_events.id (one event per invoice) and auth_nonces.nonce (one use per nonce).

type Db = Pick<PoolClient, "query">;
type Millis = string | number;

// pg returns BIGINT as a string, hence Number() on the way out.
type InvoiceRow = {
  reference: string;
  id: string;
  network: string;
  kind: string;
  recipient: string;
  /** Null for native SOL. */
  mint: string | null;
  token: string;
  amount: string;
  memo: string;
  payment_url: string;
  created_at: Millis;
  expires_at: Millis;
  status: string;
  paid_at: Millis | null;
  signature: string | null;
  block_time: Millis | null;
  canceled_at: Millis | null;
  expired_at: Millis | null;
  issue: PaymentIssue | null;
  duplicate_signatures: string[] | null;
  product_id: string | null;
  product: ProductInfo | null;
  payer: string | null;
  issue_receipt: boolean | null;
  receipt: ReceiptRecord | null;
};

type ProductRow = {
  id: string;
  network: string;
  merchant: string;
  title: string;
  description: string;
  image: string | null;
  amount: string;
  mint: string | null;
  created_at: Millis;
  archived_at: Millis | null;
};

type EventRow = {
  id: string;
  reference: string;
  payload: WebhookEventRecord["payload"];
  status: string;
  attempts: number;
  created_at: Millis;
  next_attempt_at: Millis;
  delivered_at: Millis | null;
  last_error: string | null;
};

type ApiKeyRow = {
  id: string;
  merchant: string;
  name: string;
  environment: string;
  hash: string;
  preview: string;
  daily_cap_cents: Millis;
  created_at: Millis;
  last_used_at: Millis | null;
  revoked_at: Millis | null;
};

const nullableNumber = (value: Millis | null): number | null => (value === null ? null : Number(value));

function toApiKey(row: ApiKeyRow): ApiKeyRecord {
  return {
    id: row.id,
    merchant: row.merchant,
    name: row.name,
    environment: row.environment as KeyEnvironment,
    hash: row.hash,
    preview: row.preview,
    dailyCapCents: Number(row.daily_cap_cents),
    createdAt: Number(row.created_at),
    lastUsedAt: nullableNumber(row.last_used_at),
    revokedAt: nullableNumber(row.revoked_at),
  };
}

function toInvoice(row: InvoiceRow): InvoiceRecord {
  return {
    id: row.id,
    reference: row.reference,
    network: row.network as NetworkId,
    kind: row.kind as InvoiceRecord["kind"],
    recipient: row.recipient,
    mint: row.mint,
    token: row.token,
    amount: row.amount,
    memo: row.memo,
    paymentUrl: row.payment_url,
    createdAt: Number(row.created_at),
    expiresAt: Number(row.expires_at),
    status: row.status as ServerInvoiceStatus,
    paidAt: nullableNumber(row.paid_at),
    signature: row.signature,
    blockTime: nullableNumber(row.block_time),
    canceledAt: nullableNumber(row.canceled_at),
    expiredAt: nullableNumber(row.expired_at),
    issue: row.issue,
    duplicateSignatures: row.duplicate_signatures ?? [],
    productId: row.product_id,
    product: row.product,
    payer: row.payer,
    issueReceipt: row.issue_receipt ?? false,
    receipt: row.receipt,
  };
}

function toProduct(row: ProductRow): Product {
  return {
    id: row.id,
    network: row.network as NetworkId,
    merchant: row.merchant,
    title: row.title,
    description: row.description,
    image: row.image,
    amount: row.amount,
    mint: row.mint,
    createdAt: Number(row.created_at),
    archivedAt: nullableNumber(row.archived_at),
  };
}

function toEvent(row: EventRow): WebhookEventRecord {
  return {
    id: row.id,
    reference: row.reference,
    payload: row.payload,
    status: row.status as WebhookDelivery,
    attempts: row.attempts,
    createdAt: Number(row.created_at),
    nextAttemptAt: Number(row.next_attempt_at),
    deliveredAt: nullableNumber(row.delivered_at),
    lastError: row.last_error,
  };
}

function only<T>(rows: T[]): T {
  const [row] = rows;
  if (row === undefined) throw new Error("Expected a row from the database.");
  return row;
}

const EVENT_COLUMNS: Record<keyof WebhookEventPatch, string> = {
  status: "status",
  attempts: "attempts",
  nextAttemptAt: "next_attempt_at",
  deliveredAt: "delivered_at",
  lastError: "last_error",
};

async function selectInvoice(db: Db, reference: string, lock = false): Promise<InvoiceRecord | null> {
  const { rows } = await db.query<InvoiceRow>(`SELECT * FROM invoices WHERE reference = $1${lock ? " FOR UPDATE" : ""}`, [reference]);
  return rows[0] ? toInvoice(rows[0]) : null;
}

/** The reference of the invoice this signature settled, if any. */
async function settlementOf(db: Db, signature: string): Promise<string | null> {
  const { rows } = await db.query<{ reference: string }>("SELECT reference FROM settlements WHERE signature = $1", [signature]);
  return rows[0]?.reference ?? null;
}

export class DatabaseInvoiceStore implements PaymentStore {
  constructor(private readonly pool: Pool) {}

  /** Runs `work` in one transaction on one connection; any throw rolls all of it back. */
  private async transaction<T>(work: (db: Db) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  get(reference: string): Promise<InvoiceRecord | null> {
    return selectInvoice(this.pool, reference);
  }

  async openInvoices(): Promise<InvoiceRecord[]> {
    const { rows } = await this.pool.query<InvoiceRow>("SELECT * FROM invoices WHERE status = 'pending'");
    return rows.map(toInvoice);
  }

  settledInvoiceFor(signature: string): Promise<string | null> {
    return settlementOf(this.pool, signature);
  }

  async listOrders(recipient: string, network: NetworkId, limit: number): Promise<InvoiceRecord[]> {
    const { rows } = await this.pool.query<InvoiceRow>(
      `SELECT * FROM invoices WHERE recipient = $1 AND network = $2 AND product_id IS NOT NULL
       ORDER BY created_at DESC LIMIT $3`,
      [recipient, network, limit],
    );
    return rows.map(toInvoice);
  }

  create(input: NewInvoiceRecord, maxOpen: number): Promise<InvoiceRecord> {
    return this.transaction(async (db) => {
      // A soft cap: two instances creating at the same moment can each see one slot left.
      const open = await db.query<{ count: number }>("SELECT count(*)::int AS count FROM invoices WHERE status = 'pending'");
      if (only(open.rows).count >= maxOpen) throw tooManyOpen();

      // The upsert locks the sequence row until commit, so concurrent creates for one recipient get distinct
      // numbers; a rollback returns the number.
      const sequence = await db.query<{ last_number: number }>(
        `INSERT INTO invoice_sequences (sequence_key, last_number) VALUES ($1, $2)
         ON CONFLICT (sequence_key) DO UPDATE SET last_number = invoice_sequences.last_number + 1
         RETURNING last_number`,
        [`${input.network}:${input.recipient}`, FIRST_INVOICE_NUMBER],
      );
      const invoice = newInvoiceRecord(input, only(sequence.rows).last_number);
      const inserted = await db.query(
        `INSERT INTO invoices (reference, id, network, kind, recipient, mint, token, amount, memo, payment_url, created_at, expires_at, status,
                               product_id, product, issue_receipt)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'pending', $13, $14, $15)
         ON CONFLICT (reference) DO NOTHING`,
        [
          invoice.reference,
          invoice.id,
          invoice.network,
          invoice.kind,
          invoice.recipient,
          invoice.mint,
          invoice.token,
          invoice.amount,
          invoice.memo,
          invoice.paymentUrl,
          invoice.createdAt,
          invoice.expiresAt,
          invoice.productId,
          invoice.product === null ? null : JSON.stringify(invoice.product),
          invoice.issueReceipt,
        ],
      );
      if (inserted.rowCount === 0) throw duplicateReference();
      return invoice;
    });
  }

  markPaid(reference: string, payment: Settlement): Promise<MarkPaidResult> {
    return this.transaction(async (db): Promise<MarkPaidResult> => {
      // The row lock orders this against every other transition of the same invoice, on any instance.
      const invoice = await selectInvoice(db, reference, true);
      if (!invoice) throw notFound();
      if (invoice.status === "paid") {
        if (invoice.signature !== payment.signature && !invoice.duplicateSignatures.includes(payment.signature)) {
          invoice.duplicateSignatures.push(payment.signature);
          await db.query("UPDATE invoices SET duplicate_signatures = $2 WHERE reference = $1", [reference, invoice.duplicateSignatures]);
        }
        return { changed: false, invoice, reason: "already_paid" };
      }
      if (invoice.status !== "pending") return { changed: false, invoice, reason: "not_pending" };

      // Claim the signature. A concurrent claim of the same signature waits here for the other transaction to
      // end, then either takes it (that one rolled back) or finds it taken.
      const claimed = await db.query("INSERT INTO settlements (signature, reference) VALUES ($1, $2) ON CONFLICT (signature) DO NOTHING", [
        payment.signature,
        reference,
      ]);
      if (claimed.rowCount === 0 && (await settlementOf(db, payment.signature)) !== reference) {
        return { changed: false, invoice, reason: "signature_used" };
      }

      const receipt = settlementReceipt(invoice, payment);
      const paid = await db.query<InvoiceRow>(
        `UPDATE invoices SET status = 'paid', signature = $2, block_time = $3, paid_at = $4, issue = NULL, payer = $5, receipt = $6::jsonb
         WHERE reference = $1 RETURNING *`,
        [reference, payment.signature, payment.blockTime, payment.blockTime * 1000, payment.payer, receipt === null ? null : JSON.stringify(receipt)],
      );
      const settled = toInvoice(only(paid.rows));
      const event = paymentSucceededEvent(settled, payment);
      await db.query(
        `INSERT INTO webhook_events (id, reference, payload, status, attempts, created_at, next_attempt_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING`,
        [event.id, event.reference, JSON.stringify(event.payload), event.status, event.attempts, event.createdAt, event.nextAttemptAt],
      );
      return { changed: true, invoice: settled };
    });
  }


  recordDuplicates(reference: string, signatures: readonly string[]): Promise<void> {
    return this.transaction(async (db) => {
      const invoice = await selectInvoice(db, reference, true);
      if (!invoice) return;
      const added = signatures.filter((signature) => signature !== invoice.signature && !invoice.duplicateSignatures.includes(signature));
      if (added.length === 0) return;
      await db.query("UPDATE invoices SET duplicate_signatures = $2 WHERE reference = $1", [reference, [...invoice.duplicateSignatures, ...added]]);
    });
  }

  /** No write when it's the one already recorded. */
  async recordIssue(reference: string, issue: PaymentIssue): Promise<void> {
    await this.pool.query(
      `UPDATE invoices SET issue = $2::jsonb
       WHERE reference = $1 AND status = 'pending' AND (issue IS NULL OR issue->>'signature' IS DISTINCT FROM $3)`,
      [reference, JSON.stringify(issue), issue.signature],
    );
  }

  async expire(reference: string, now = Date.now()): Promise<{ changed: boolean; invoice: InvoiceRecord | null }> {
    const { rows } = await this.pool.query<InvoiceRow>(
      `UPDATE invoices SET status = 'expired', expired_at = $2
       WHERE reference = $1 AND status = 'pending' AND expires_at <= $2 RETURNING *`,
      [reference, now],
    );
    if (rows[0]) return { changed: true, invoice: toInvoice(rows[0]) };
    return { changed: false, invoice: await this.get(reference) };
  }

  async cancel(reference: string, merchant: string): Promise<CancelResult> {
    const { rows } = await this.pool.query<InvoiceRow>(
      `UPDATE invoices SET status = 'canceled', canceled_at = $3
       WHERE reference = $1 AND recipient = $2 AND status = 'pending' RETURNING *`,
      [reference, merchant, Date.now()],
    );
    if (rows[0]) return { result: "canceled", invoice: toInvoice(rows[0]) };
    const invoice = await this.get(reference);
    if (!invoice) throw notFound();
    return { result: invoice.recipient === merchant ? "not_pending" : "forbidden", invoice };
  }

  async claimDueEvent(leaseMs: number, now = Date.now()): Promise<WebhookEventRecord | null> {
    // SKIP LOCKED: instances sweeping at the same moment take different events instead of queueing on one.
    const { rows } = await this.pool.query<EventRow>(
      `UPDATE webhook_events SET next_attempt_at = $2
       WHERE id = (
         SELECT id FROM webhook_events
         WHERE status = 'pending' AND next_attempt_at <= $1
         ORDER BY created_at LIMIT 1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING *`,
      [now, now + leaseMs],
    );
    return rows[0] ? toEvent(rows[0]) : null;
  }

  async pendingEventCount(): Promise<number> {
    const { rows } = await this.pool.query<{ count: number }>("SELECT count(*)::int AS count FROM webhook_events WHERE status = 'pending'");
    return only(rows).count;
  }

  async updateEvent(id: string, patch: WebhookEventPatch): Promise<void> {
    const values: unknown[] = [id];
    const assignments: string[] = [];
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || !Object.hasOwn(EVENT_COLUMNS, key)) continue;
      // Retry times carry jitter and can be fractional; the columns are whole milliseconds.
      values.push(typeof value === "number" ? Math.round(value) : value);
      assignments.push(`${EVENT_COLUMNS[key as keyof WebhookEventPatch]} = $${values.length}`);
    }
    if (assignments.length > 0) await this.pool.query(`UPDATE webhook_events SET ${assignments.join(", ")} WHERE id = $1`, values);
    // Housekeeping: finished events past retention go.
    await this.pool.query(
      "DELETE FROM webhook_events WHERE status IN ('delivered', 'skipped') AND COALESCE(delivered_at, created_at) < $1",
      [Date.now() - EVENT_RETENTION_MS],
    );
  }

  async claimDueReceipt(leaseMs: number, now = Date.now()): Promise<InvoiceRecord | null> {
    // As claimDueEvent: SKIP LOCKED, so instances sweeping at once take different receipts.
    const { rows } = await this.pool.query<InvoiceRow>(
      `UPDATE invoices SET receipt = jsonb_set(receipt, '{nextAttemptAt}', to_jsonb($2::bigint))
       WHERE reference = (
         SELECT reference FROM invoices
         WHERE receipt->>'status' = 'pending' AND (receipt->>'nextAttemptAt')::bigint <= $1
         ORDER BY paid_at LIMIT 1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING *`,
      [now, now + leaseMs],
    );
    return rows[0] ? toInvoice(rows[0]) : null;
  }

  async updateReceipt(reference: string, patch: ReceiptPatch): Promise<void> {
    // Retry times carry jitter and can be fractional; whole milliseconds, like the rest of the store.
    const clean = Object.fromEntries(
      Object.entries(patch)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [key, typeof value === "number" ? Math.round(value) : value]),
    );
    await this.pool.query("UPDATE invoices SET receipt = receipt || $2::jsonb WHERE reference = $1 AND receipt IS NOT NULL", [
      reference,
      JSON.stringify(clean),
    ]);
  }

  async queueReceipt(reference: string, owner: string, now = Date.now()): Promise<InvoiceRecord | null> {
    const { rows } = await this.pool.query<InvoiceRow>(
      `UPDATE invoices SET receipt = $2::jsonb
       WHERE reference = $1 AND status = 'paid' AND (receipt IS NULL OR receipt->>'status' IN ('failed', 'simulated'))
       RETURNING *`,
      [reference, JSON.stringify(newReceipt(owner, now))],
    );
    return rows[0] ? toInvoice(rows[0]) : this.get(reference);
  }

  async stats(): Promise<Record<ServerInvoiceStatus, number>> {
    const counts: Record<ServerInvoiceStatus, number> = { pending: 0, paid: 0, expired: 0, canceled: 0 };
    const { rows } = await this.pool.query<{ status: ServerInvoiceStatus; count: number }>(
      "SELECT status, count(*)::int AS count FROM invoices GROUP BY status",
    );
    for (const row of rows) counts[row.status] = row.count;
    return counts;
  }

  async consumeNonce(nonce: string, expiresAt: number): Promise<boolean> {
    await this.pool.query("DELETE FROM auth_nonces WHERE expires_at <= $1", [Date.now()]);
    const inserted = await this.pool.query("INSERT INTO auth_nonces (nonce, expires_at) VALUES ($1, $2) ON CONFLICT (nonce) DO NOTHING", [
      nonce,
      expiresAt,
    ]);
    return inserted.rowCount === 1;
  }

  async revokeSession(sessionId: string, expiresAt: number): Promise<void> {
    await this.pool.query("DELETE FROM revoked_sessions WHERE expires_at <= $1", [Date.now()]);
    await this.pool.query("INSERT INTO revoked_sessions (id, expires_at) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING", [sessionId, expiresAt]);
  }

  async isSessionRevoked(sessionId: string): Promise<boolean> {
    const { rows } = await this.pool.query("SELECT 1 FROM revoked_sessions WHERE id = $1", [sessionId]);
    return rows.length > 0;
  }

  createApiKey(record: ApiKeyRecord, maxActive: number): Promise<ApiKeyRecord> {
    return this.transaction(async (db) => {
      // Serializes key creation per merchant, so two instances can't both see one slot left.
      await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`api-keys:${record.merchant}`]);
      const active = await db.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM api_keys WHERE merchant = $1 AND revoked_at IS NULL",
        [record.merchant],
      );
      if (only(active.rows).count >= maxActive) throw tooManyKeys(maxActive);
      await db.query(
        `INSERT INTO api_keys (id, merchant, name, environment, hash, preview, daily_cap_cents, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [record.id, record.merchant, record.name, record.environment, record.hash, record.preview, record.dailyCapCents, record.createdAt],
      );
      return record;
    });
  }

  async listApiKeys(merchant: string): Promise<ApiKeyRecord[]> {
    const { rows } = await this.pool.query<ApiKeyRow>("SELECT * FROM api_keys WHERE merchant = $1 ORDER BY created_at DESC", [merchant]);
    return rows.map(toApiKey);
  }

  async findApiKeyByHash(hash: string): Promise<ApiKeyRecord | null> {
    const { rows } = await this.pool.query<ApiKeyRow>("SELECT * FROM api_keys WHERE hash = $1", [hash]);
    return rows[0] ? toApiKey(rows[0]) : null;
  }

  async revokeApiKey(id: string, merchant: string, now = Date.now()): Promise<ApiKeyRecord | null> {
    const { rows } = await this.pool.query<ApiKeyRow>(
      "UPDATE api_keys SET revoked_at = COALESCE(revoked_at, $3) WHERE id = $1 AND merchant = $2 RETURNING *",
      [id, merchant, now],
    );
    return rows[0] ? toApiKey(rows[0]) : null;
  }

  async reserveKeyVolume(id: string, day: number, cents: number, capCents: number, now = Date.now()): Promise<{ ok: boolean; usedCents: number }> {
    await this.pool.query("DELETE FROM api_key_volume WHERE day < $1", [now - KEY_VOLUME_RETENTION_MS]);
    if (cents > capCents) return { ok: false, usedCents: await this.usedCents(id, day) };
    // One statement: the conditional upsert is what keeps concurrent requests on any instance within the cap.
    const { rows } = await this.pool.query<{ cents: Millis }>(
      `INSERT INTO api_key_volume (key_id, day, cents) VALUES ($1, $2, $3)
       ON CONFLICT (key_id, day) DO UPDATE SET cents = api_key_volume.cents + EXCLUDED.cents
       WHERE api_key_volume.cents + EXCLUDED.cents <= $4
       RETURNING cents`,
      [id, day, cents, capCents],
    );
    if (!rows[0]) return { ok: false, usedCents: await this.usedCents(id, day) };
    await this.pool.query("UPDATE api_keys SET last_used_at = $2 WHERE id = $1", [id, now]);
    return { ok: true, usedCents: Number(rows[0].cents) };
  }

  private async usedCents(id: string, day: number): Promise<number> {
    const { rows } = await this.pool.query<{ cents: Millis }>("SELECT cents FROM api_key_volume WHERE key_id = $1 AND day = $2", [id, day]);
    return rows[0] ? Number(rows[0].cents) : 0;
  }

  async releaseKeyVolume(id: string, day: number, cents: number): Promise<void> {
    await this.pool.query("UPDATE api_key_volume SET cents = GREATEST(0, cents - $3) WHERE key_id = $1 AND day = $2", [id, day, cents]);
  }

  async keyVolume(ids: readonly string[], day: number): Promise<Record<string, number>> {
    if (ids.length === 0) return {};
    const { rows } = await this.pool.query<{ key_id: string; cents: Millis }>(
      "SELECT key_id, cents FROM api_key_volume WHERE key_id = ANY($1) AND day = $2",
      [[...ids], day],
    );
    return Object.fromEntries(rows.map((row) => [row.key_id, Number(row.cents)]));
  }

  async redeemInvoice(reference: string, keyId: string, now = Date.now()): Promise<boolean> {
    const inserted = await this.pool.query(
      "INSERT INTO invoice_redemptions (reference, key_id, redeemed_at) VALUES ($1, $2, $3) ON CONFLICT (reference) DO NOTHING",
      [reference, keyId, now],
    );
    return inserted.rowCount === 1;
  }

  createProduct(product: Product, maxActive: number): Promise<Product> {
    return this.transaction(async (db) => {
      // Serializes product creation per merchant, so two instances can't both see one slot left.
      await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`products:${product.merchant}`]);
      const onSale = await db.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM products WHERE merchant = $1 AND archived_at IS NULL",
        [product.merchant],
      );
      if (only(onSale.rows).count >= maxActive) throw tooManyProducts(maxActive);
      await db.query(
        `INSERT INTO products (id, network, merchant, title, description, image, amount, mint, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          product.id,
          product.network,
          product.merchant,
          product.title,
          product.description,
          product.image,
          product.amount,
          product.mint,
          product.createdAt,
        ],
      );
      return product;
    });
  }

  async getProduct(id: string): Promise<Product | null> {
    const { rows } = await this.pool.query<ProductRow>("SELECT * FROM products WHERE id = $1", [id]);
    return rows[0] ? toProduct(rows[0]) : null;
  }

  async listProducts(merchant: string, network: NetworkId): Promise<Product[]> {
    const { rows } = await this.pool.query<ProductRow>(
      "SELECT * FROM products WHERE merchant = $1 AND network = $2 AND archived_at IS NULL ORDER BY created_at DESC",
      [merchant, network],
    );
    return rows.map(toProduct);
  }

  async archiveProduct(id: string, merchant: string, now = Date.now()): Promise<Product | null> {
    const { rows } = await this.pool.query<ProductRow>(
      "UPDATE products SET archived_at = COALESCE(archived_at, $3) WHERE id = $1 AND merchant = $2 RETURNING *",
      [id, merchant, now],
    );
    return rows[0] ? toProduct(rows[0]) : null;
  }
}
