import { DAY_MS } from "./demo-data";
import { parseUsdcCents } from "./solana-pay";
import type { DailySettlement, Invoice, InvoiceStatus, LedgerTx, Payment, PaymentAmount, PaymentType, RangeDays } from "./types";

/** Card processing the fee comparison is made against: 2.9% + 30¢ per payment. */
export const CARD_RATE = 0.029;
export const CARD_FIXED_CENTS = 30;
/** ~5,000 lamports per Solana transfer at ~$160/SOL, in cents. */
export const SOLANA_FEE_CENTS = 0.08;

export interface Change {
  /** Fractional change vs the comparison period, or null when there is nothing to compare. */
  ratio: number | null;
  /** Human label for the comparison period, e.g. "vs Aug 1–23". */
  against: string;
}

export function isInbound(type: PaymentType): boolean {
  return type !== "payout";
}

function isSettledInbound(tx: LedgerTx): boolean {
  return tx.status === "confirmed" && isInbound(tx.type);
}

/** Confirmed inbound payments on `day` (UTC midnight). */
export function settledOn(ledger: readonly LedgerTx[], day: number): LedgerTx[] {
  return ledger.filter((tx) => isSettledInbound(tx) && tx.createdAt >= day && tx.createdAt < day + DAY_MS);
}

/** Older daily totals followed by per-day totals computed from the itemized ledger. */
export function buildSeries(
  history: readonly DailySettlement[],
  ledger: readonly LedgerTx[],
  today: number,
  ledgerDays: number,
): DailySettlement[] {
  const firstDay = today - (ledgerDays - 1) * DAY_MS;
  const buckets = new Map<number, DailySettlement>();
  for (let day = firstDay; day <= today; day += DAY_MS) buckets.set(day, { day, volumeCents: 0, count: 0 });
  for (const tx of ledger) {
    if (!isSettledInbound(tx)) continue;
    const bucket = buckets.get(tx.createdAt - (tx.createdAt % DAY_MS));
    if (bucket) {
      bucket.volumeCents += tx.amountCents;
      bucket.count += 1;
    }
  }
  return [...history.filter((d) => d.day < firstDay), ...buckets.values()];
}

export function sumSeries(days: readonly DailySettlement[]): { volumeCents: number; count: number } {
  return days.reduce(
    (acc, d) => ({ volumeCents: acc.volumeCents + d.volumeCents, count: acc.count + d.count }),
    { volumeCents: 0, count: 0 },
  );
}

export function change(current: number, previous: number): number | null {
  return previous > 0 ? (current - previous) / previous : null;
}

/** What the same volume would have cost on card rails, minus Solana network fees. */
export function feesSavedCents(volumeCents: number, count: number): number {
  const cardFees = volumeCents * CARD_RATE + count * CARD_FIXED_CENTS;
  return Math.max(0, Math.round(cardFees - count * SOLANA_FEE_CENTS));
}

/** Last `range` days (including today) and the `range` days before them. */
export function splitRange(
  series: readonly DailySettlement[],
  range: RangeDays,
): { current: DailySettlement[]; previous: DailySettlement[] } {
  return {
    current: series.slice(-range),
    previous: series.slice(-range * 2, -range),
  };
}

/** Month-to-date for the month containing `today`, and the same days of the previous month. */
export function monthToDate(
  series: readonly DailySettlement[],
  today: number,
): { current: DailySettlement[]; previous: DailySettlement[]; previousStart: number; previousEnd: number } {
  const t = new Date(today);
  const year = t.getUTCFullYear();
  const month = t.getUTCMonth();
  const dayOfMonth = t.getUTCDate();
  const monthStart = Date.UTC(year, month, 1);
  const previousStart = Date.UTC(year, month - 1, 1);
  const daysInPrevious = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const previousEnd = Date.UTC(year, month - 1, Math.min(dayOfMonth, daysInPrevious));

  return {
    current: series.filter((d) => d.day >= monthStart && d.day <= today),
    previous: series.filter((d) => d.day >= previousStart && d.day <= previousEnd),
    previousStart,
    previousEnd,
  };
}

export function invoiceStatus(invoice: Invoice, now: number): InvoiceStatus {
  // A payment that landed counts even if the invoice was canceled afterwards.
  if (invoice.paidAt !== undefined) return "paid";
  if (invoice.canceledAt !== undefined) return "canceled";
  return now >= invoice.expiresAt ? "expired" : "pending";
}

export function txToPayment(tx: LedgerTx): Payment {
  return {
    id: tx.invoiceId ?? (tx.signature ? tx.signature.slice(0, 10) : `payout-${tx.createdAt}`),
    createdAt: tx.createdAt,
    client: tx.senderName,
    wallet: tx.wallet,
    amount: { currency: "USDC", cents: tx.amountCents },
    type: tx.type,
    status: tx.status === "confirmed" ? "paid" : tx.status,
    memo: tx.memo,
    failureReason: tx.failure?.message,
    signature: tx.signature,
  };
}

/** An invoice's amount as a feed row shows it: USDC in cents, SOL as is. */
export function invoiceAmount(invoice: Pick<Invoice, "amount" | "mint">): PaymentAmount {
  return invoice.mint === null ? { currency: "SOL", amount: invoice.amount } : { currency: "USDC", cents: parseUsdcCents(invoice.amount) ?? 0 };
}

/** USDC cents of a payment, for totals and charts; zero for SOL, which has no USD value here. */
export function usdcCents(amount: PaymentAmount): number {
  return amount.currency === "USDC" ? amount.cents : 0;
}

/** How a feed row names an invoice: its client, else the product it sold, else what it is. */
function invoiceLabel(invoice: Invoice): { client: string; memo: string } {
  if (invoice.client) return { client: invoice.client, memo: invoice.memo };
  if (invoice.product) return { client: invoice.product.title, memo: `Order ${invoice.id}` };
  return { client: "Payment link", memo: invoice.memo };
}

/**
 * Overview feed: every transaction since `since`, plus invoices created since then that are still open, plus paid
 * invoices the USDC ledger doesn't list (SOL payments, and sales the ledger hasn't refreshed to yet). Rows that settled
 * an invoice carry its buyer's cNFT receipt.
 */
export function recentActivity(
  ledger: readonly LedgerTx[],
  invoices: readonly Invoice[],
  since: number,
  now: number,
): Payment[] {
  const byId = new Map(invoices.map((inv) => [inv.id, inv]));
  const fromLedger = ledger
    .filter((tx) => tx.createdAt >= since)
    .map((tx) => {
      const receipt = tx.invoiceId ? byId.get(tx.invoiceId)?.receipt : undefined;
      return receipt ? { ...txToPayment(tx), receipt } : txToPayment(tx);
    });
  const inLedger = new Set(ledger.flatMap((tx) => [tx.signature ?? "", tx.invoiceId ?? ""]).filter(Boolean));

  const fromInvoices = invoices.flatMap<Payment>((inv) => {
    const status = invoiceStatus(inv, now);
    const base = { id: inv.id, wallet: null, amount: invoiceAmount(inv), type: inv.kind, ...invoiceLabel(inv) };
    if (status === "pending" && inv.createdAt >= since) {
      return [{ ...base, createdAt: inv.createdAt, status: "pending", paymentUrl: inv.paymentUrl }];
    }
    if (status === "paid" && inv.paidAt !== undefined && inv.paidAt >= since && !inLedger.has(inv.id) && !inLedger.has(inv.signature ?? "")) {
      return [
        {
          ...base,
          createdAt: inv.paidAt,
          wallet: inv.payer ?? null,
          status: "paid",
          signature: inv.signature ?? null,
          ...(inv.receipt ? { receipt: inv.receipt } : {}),
        },
      ];
    }
    return [];
  });
  return [...fromLedger, ...fromInvoices].sort((a, b) => b.createdAt - a.createdAt);
}
