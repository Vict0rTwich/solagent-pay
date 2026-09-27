import { centsToAmount } from "./solana-pay";
import type { Invoice } from "./types";

// Invoices created while connected live in this browser, per network and wallet, so their
// payment status can still be checked on-chain after a reload.

const PREFIX = "solagent-invoices";

/** As saved by earlier versions: USDC-only amounts in cents, and a manage token instead of `tracked`. */
type StoredInvoice = Omit<Invoice, "amount"> & { amount?: string; amountCents?: number; manageToken?: unknown };

function isStoredInvoice(value: unknown): value is StoredInvoice {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.reference === "string" &&
    typeof v.recipient === "string" &&
    (typeof v.mint === "string" || v.mint === null) &&
    (typeof v.amount === "string" || typeof v.amountCents === "number") &&
    typeof v.paymentUrl === "string"
  );
}

/** Brings an older saved invoice up to date; the old fields are gone from storage at the next save. */
function upgrade({ amountCents, manageToken, ...invoice }: StoredInvoice): Invoice {
  return {
    ...invoice,
    amount: invoice.amount ?? centsToAmount(amountCents ?? 0),
    // The wallet session replaced the manage token; having one meant the server tracks the invoice.
    ...(manageToken !== undefined ? { tracked: true } : {}),
  };
}

export function loadInvoices(key: string): Invoice[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(`${PREFIX}:${key}`) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isStoredInvoice).map(upgrade) : [];
  } catch {
    return [];
  }
}

export function saveInvoices(key: string, invoices: readonly Invoice[]): void {
  try {
    localStorage.setItem(`${PREFIX}:${key}`, JSON.stringify(invoices));
  } catch {
    // Storage full or blocked: the invoices still work for this visit.
  }
}
