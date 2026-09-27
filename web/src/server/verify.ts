import { PublicKey } from "@solana/web3.js";

import { baseUnits } from "@/lib/currency";
import type { VerificationResult, VerificationStatus } from "@/lib/invoice-api";
import { checkPayment, type PaymentCheckCache, type PaymentTarget } from "@/lib/invoice-payments";
import type { PaymentIssue } from "@/lib/types";

import type { EmitEngineEvent } from "./events";
import type { RpcClient } from "./rpc";
import type { InvoiceRecord, InvoiceStore, Settlement } from "./store";

/** How many transactions carrying one reference are examined. More than a handful means abuse, not payments. */
const REFERENCE_LOOKBACK = 25;
/** A transaction older than its invoice (beyond clock skew) can't be paying it. */
const CLOCK_SKEW_MS = 2 * 60_000;
/** Bound on remembered transaction checks. */
const CHECK_CACHE_LIMIT = 5_000;

export class InvoiceNotFoundError extends Error {
  override readonly name = "InvoiceNotFoundError";
}

/** By name, not `instanceof`, for the same reason as isStoreError. */
export function isInvoiceNotFound(error: unknown): error is InvoiceNotFoundError {
  return error instanceof Error && error.name === "InvoiceNotFoundError";
}

const ISSUE_STATUS: Record<PaymentIssue["reason"], VerificationStatus> = {
  token: "TOKEN_MISMATCH",
  recipient: "INVALID_RECIPIENT",
  amount: "UNDERPAID",
  // Failed on-chain: nothing moved, so the invoice is simply still waiting.
  failed: "PENDING",
};

/** A Map that forgets its oldest entries past `limit`. */
class BoundedCache<K, V> extends Map<K, V> {
  constructor(private readonly limit: number) {
    super();
  }
  override set(key: K, value: V): this {
    super.set(key, value);
    if (this.size > this.limit) {
      const oldest = this.keys().next().value;
      if (oldest !== undefined) this.delete(oldest);
    }
    return this;
  }
}

export interface VerifierDeps {
  store: InvoiceStore;
  rpc: (invoice: InvoiceRecord) => RpcClient;
  /** Called when a check marks an invoice paid, so its webhook goes out now. */
  onSettled: (invoice: InvoiceRecord) => void;
  emit: EmitEngineEvent;
}

export function createVerifier({ store, rpc, onSettled, emit }: VerifierDeps) {
  const checks: PaymentCheckCache = new BoundedCache(CHECK_CACHE_LIMIT);
  // "<reference>|<signature>" already in the event log: polls see the same transactions again and again.
  const detected = new BoundedCache<string, true>(CHECK_CACHE_LIMIT);
  const verified = new BoundedCache<string, true>(CHECK_CACHE_LIMIT);
  // One chain check per invoice at a time: the socket, the poller and the API asking at once share it.
  const inFlight = new Map<string, Promise<VerificationResult>>();

  const result = (
    invoice: InvoiceRecord,
    status: VerificationStatus,
    extra: Partial<Pick<VerificationResult, "signature" | "blockTime" | "message" | "settledNow">> = {},
  ): VerificationResult => ({
    status,
    invoiceId: invoice.id,
    reference: invoice.reference,
    invoiceStatus: invoice.status,
    signature: extra.signature ?? null,
    blockTime: extra.blockTime ?? null,
    message: extra.message ?? null,
    settledNow: extra.settledNow ?? false,
  });

  async function check(invoice: InvoiceRecord): Promise<VerificationResult> {
    const { connection } = rpc(invoice);
    const target: PaymentTarget = {
      reference: invoice.reference,
      fields: { recipient: invoice.recipient, amount: invoice.amount, splToken: invoice.mint },
    };
    const signatures = await connection.getSignaturesForAddress(new PublicKey(invoice.reference), { limit: REFERENCE_LOOKBACK }, "confirmed");

    // Oldest first: if the payer paid twice, the first payment settles the invoice, every time this runs.
    let paid: Settlement | null = null;
    const duplicates: string[] = [];
    let newestIssue: PaymentIssue | null = null;
    const about = { network: invoice.network, merchant: invoice.recipient, reference: invoice.reference };
    for (const info of [...signatures].reverse()) {
      const key = `${invoice.reference}|${info.signature}`;
      if (!detected.has(key)) {
        detected.set(key, true);
        emit({
          type: "TX_DETECTED",
          ...about,
          data: { invoiceId: invoice.id, signature: info.signature, slot: info.slot, blockTime: info.blockTime ?? null, failed: info.err !== null },
        });
      }
      if (info.err) continue;
      const outcome = await checkPayment(connection, info.signature, target, checks);
      if (!outcome) continue; // not served by this node yet; the next check picks it up
      if (!verified.has(key)) {
        verified.set(key, true);
        const native = invoice.mint === null;
        emit({
          type: native ? "LAMPORT_DELTA_VERIFIED" : "TOKEN_DELTA_VERIFIED",
          ...about,
          data: {
            invoiceId: invoice.id,
            signature: info.signature,
            asset: invoice.token,
            unit: native ? "lamports" : `${invoice.token} base units`,
            expected: outcome.delta?.expected ?? baseUnits(invoice.amount, invoice.mint)?.units ?? null,
            // No delta: none of the requested asset reached the recipient (the verdict says what did).
            received: outcome.delta?.received ?? "0",
            verdict: outcome.ok ? "MATCH" : outcome.issue.reason.toUpperCase(),
            ...(outcome.ok ? {} : { message: outcome.issue.message }),
          },
        });
      }
      if (!outcome.ok) {
        newestIssue = outcome.issue;
        continue;
      }
      if (outcome.paidAt < invoice.createdAt - CLOCK_SKEW_MS) continue;
      const settled = await store.settledInvoiceFor(info.signature);
      if (settled && settled !== invoice.reference) continue; // already settled a different invoice
      if (paid) duplicates.push(info.signature);
      else paid = { signature: info.signature, blockTime: Math.floor(outcome.paidAt / 1000), payer: outcome.payer };
    }

    if (paid) {
      const settlement = await store.markPaid(invoice.reference, paid);
      if (duplicates.length) await store.recordDuplicates(invoice.reference, duplicates);
      if (settlement.changed) {
        emit({
          type: "STATUS_UPDATED",
          network: invoice.network,
          merchant: invoice.recipient,
          reference: invoice.reference,
          data: { invoiceId: invoice.id, from: "PENDING", to: "PAID", signature: paid.signature, blockTime: paid.blockTime, payer: paid.payer },
        });
        onSettled(settlement.invoice);
      }
      if (settlement.invoice.status === "paid") {
        return result(settlement.invoice, "VERIFIED_PAID", {
          signature: settlement.invoice.signature,
          blockTime: settlement.invoice.blockTime,
          settledNow: settlement.changed,
        });
      }
      // Canceled or expired in the meantime: the payment is real but doesn't reopen the invoice.
      return result(settlement.invoice, "PENDING", { message: `The invoice is ${settlement.invoice.status}.` });
    }
    if (newestIssue) {
      await store.recordIssue(invoice.reference, newestIssue);
      const status = ISSUE_STATUS[newestIssue.reason];
      return result((await store.get(invoice.reference)) ?? invoice, status, {
        signature: newestIssue.signature,
        message: newestIssue.message,
      });
    }
    return result(invoice, "PENDING");
  }

  /**
   * Server-side verdict for an invoice's payment, from the chain at "confirmed" commitment. A paid invoice
   * answers from the store without touching the RPC; an open one is checked and, if a transfer pays it
   * exactly (token, recipient, at least the amount), settled here, once.
   */
  async function verifyInvoicePayment(invoiceId: string, referenceKey: string): Promise<VerificationResult> {
    const invoice = await store.get(referenceKey);
    if (!invoice || invoice.id !== invoiceId) throw new InvoiceNotFoundError(`No invoice ${invoiceId} with that reference.`);
    if (invoice.status === "paid") {
      return result(invoice, "VERIFIED_PAID", { signature: invoice.signature, blockTime: invoice.blockTime });
    }
    if (invoice.status !== "pending") return result(invoice, "PENDING", { message: `The invoice is ${invoice.status}.` });

    const running = inFlight.get(referenceKey);
    if (running) return running;
    const run = check(invoice).finally(() => inFlight.delete(referenceKey));
    inFlight.set(referenceKey, run);
    return run;
  }

  return { verifyInvoicePayment };
}
