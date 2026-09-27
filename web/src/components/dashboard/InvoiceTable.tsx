"use client";

import { ArrowRight, Download, ExternalLink, QrCode, SearchX } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { SolanaPayModal } from "@/components/checkout/SolanaPayModal";
import { ReceiptBadge } from "@/components/receipts/ReceiptBadge";
import { CopiedToast, CopyIcon } from "@/components/ui/CopiedToast";
import { CopyButton } from "@/components/ui/CopyButton";
import { segmentClass, segmentGroupClass } from "@/components/ui/FilterTabs";
import { TokenIcon } from "@/components/ui/TokenIcon";
import { toast } from "@/components/ui/Toaster";
import { useCheckoutLink } from "@/hooks/use-checkout-link";
import { useCopy } from "@/hooks/use-copy";
import { cn } from "@/lib/cn";
import { downloadCsv, toCsv } from "@/lib/csv";
import { useDashboard } from "@/lib/dashboard-store";
import { formatCount, formatDay, formatTime, pluralize, truncateAddress } from "@/lib/format";
import { txExplorer, type NetworkConfig } from "@/lib/network";
import { useNetwork } from "@/lib/settings";
import type { Invoice, Payment, PaymentStatus, PaymentType } from "@/lib/types";

import { PAYMENT_TYPES, StatusBadge, formatPaymentAmount } from "./payment-meta";

type Filter = "all" | PaymentStatus;

const FILTERS: ReadonlyArray<{ value: Filter; label: string }> = [
  { value: "all", label: "All" },
  { value: "paid", label: "Paid" },
  { value: "pending", label: "Pending" },
  { value: "failed", label: "Failed" },
];

// Row actions stay quiet until their row is hovered or focused. Touch screens can't hover, so they always show there.
const REVEAL =
  "transition-opacity pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100";

/**
 * How the money came in, as a tiny tag under the client. Only what the ledger records: which channel paid a link
 * (Blink, QR code, wallet) isn't stored, so there is no per-channel tag. Solana Pay requests (links and invoices)
 * share the Active links card's purple; AI agents take the accent blue.
 */
const PURPLE_TAG = "border-purple-500/25 bg-purple-500/10 text-purple-300 light:border-purple-200 light:bg-purple-50 light:text-purple-700";
const SLATE_TAG = "border-idle-line bg-idle-bg text-idle";
const TAGS: Record<PaymentType, { label: string; className: string }> = {
  agent: { label: "Agent", className: "border-accent-line bg-accent-soft text-accent-ink" },
  link: { label: "Link", className: PURPLE_TAG },
  invoice: { label: "Invoice", className: PURPLE_TAG },
  transfer: { label: "Direct", className: SLATE_TAG },
  payout: { label: "Payout", className: SLATE_TAG },
};

const actionClass =
  "grid size-7 place-items-center rounded-md text-accent-ink/70 transition-colors hover:bg-accent-soft hover:text-accent-ink";

const STATUS_LABEL: Record<PaymentStatus, string> = { paid: "Paid", pending: "Pending", failed: "Failed" };

/**
 * The rows on screen (status filter and search applied) as an accounting CSV. Amounts go in their own asset's
 * column, never converted: USDC and SOL can't be summed without a rate. Payouts are negative. Timestamps are ISO 8601
 * UTC. Solscan doesn't index localnet, so its links are left out there.
 */
function exportPayments(rows: readonly Payment[], network: NetworkConfig): void {
  const csv = toCsv(
    ["Signature", "Timestamp (UTC)", "Client/Agent", "Type", "Amount (USDC)", "Amount (SOL)", "Status", "Solscan URL", "cNFT receipt"],
    rows.map((payment) => [
      payment.signature ?? "",
      new Date(payment.createdAt).toISOString(),
      payment.client,
      PAYMENT_TYPES[payment.type].label,
      payment.amount.currency === "USDC" ? (payment.amount.cents / 100).toFixed(2) : "",
      payment.amount.currency === "SOL" ? payment.amount.amount : "",
      STATUS_LABEL[payment.status],
      payment.signature && network.id !== "localnet" ? txExplorer(payment.signature, network).url : "",
      payment.receipt ? (payment.receipt.mintAddress ?? payment.receipt.status) : "",
    ]),
  );
  downloadCsv(`solagent_payments_export_${new Date().toISOString().slice(0, 10)}.csv`, csv);
}

function matches(payment: Payment, terms: readonly string[]): boolean {
  const haystack = [
    payment.id,
    payment.client,
    payment.wallet ?? "",
    payment.signature ?? "",
    payment.memo,
    PAYMENT_TYPES[payment.type].label,
    TAGS[payment.type].label,
    formatPaymentAmount(payment.amount),
    payment.amount.currency,
  ]
    .join(" ")
    .toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

/** The overview's hero: every recent payment, invoice and agent transfer, newest first. */
export function InvoiceTable() {
  const { payments, invoices, query, setQuery } = useDashboard();
  const network = useNetwork();
  const [filter, setFilter] = useState<Filter>("all");
  const [paying, setPaying] = useState<Invoice | null>(null);
  // Open links in the feed are invoices: look them up by their link to open the Solana Pay dialog.
  const invoiceFor = (payment: Payment) => (payment.paymentUrl ? invoices.find((invoice) => invoice.paymentUrl === payment.paymentUrl) : undefined);

  const searched = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    return terms.length ? payments.filter((p) => matches(p, terms)) : payments;
  }, [payments, query]);

  const counts = useMemo(() => {
    const result: Record<Filter, number> = { all: searched.length, paid: 0, pending: 0, failed: 0 };
    for (const p of searched) result[p.status] += 1;
    return result;
  }, [searched]);

  const rows = filter === "all" ? searched : searched.filter((p) => p.status === filter);

  return (
    <section aria-labelledby="payments-heading" className="card flex min-w-0 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div>
          <h2 id="payments-heading" className="flex items-baseline gap-2 text-sm font-medium text-ink">
            Recent payments
            <span className="font-mono text-xs font-normal tabular-nums text-ink-3">{formatCount(payments.length)}</span>
          </h2>
          <p className="mt-0.5 text-xs text-ink-3">
            {query ? (
              <>
                Matching &ldquo;<span className="text-ink-2">{query}</span>&rdquo; ·{" "}
                <button type="button" onClick={() => setQuery("")} className="link">
                  Clear search
                </button>
              </>
            ) : (
              "Invoices, links and agent payments, newest first"
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Filter by status" className={segmentGroupClass}>
            {FILTERS.map(({ value, label }) => (
              <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)} className={segmentClass(filter === value)}>
                {label}
                <span className="font-mono text-[11px] tabular-nums text-ink-3">{counts[value]}</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              exportPayments(rows, network);
              toast(`Exported ${pluralize(rows.length, "payment record")}`);
            }}
            disabled={rows.length === 0}
            title={filter === "all" && !query ? "Export these payments as CSV" : "Export the filtered payments as CSV"}
            className="btn-ghost inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Download className="size-3.5" aria-hidden />
            Export CSV
          </button>
        </div>
      </div>

      {/* Sized so the whole card, footer included, fits above the event stream bar on a laptop screen. */}
      <div className="relative max-h-[max(320px,calc(100dvh-28rem))] min-h-[240px] overflow-auto border-t border-line">
        {rows.length > 0 ? (
          <table className="w-full text-[13px] md:min-w-[620px]">
            <caption className="sr-only">Recent payments</caption>
            <thead className="sticky top-0 z-10 bg-panel">
              <tr className="th text-left shadow-[inset_0_-1px_0_var(--line)]">
                <th scope="col" className="hidden h-9 pl-5 pr-4 font-medium sm:table-cell">
                  Date <span className="font-mono normal-case tracking-normal">(UTC)</span>
                </th>
                <th scope="col" className="h-9 pl-4 pr-3 font-medium sm:pl-0">
                  Client
                </th>
                <th scope="col" className="hidden h-9 pr-4 font-medium md:table-cell">
                  Signature
                </th>
                <th scope="col" className="h-9 pr-3 text-right font-medium sm:pr-5">
                  Amount
                </th>
                <th scope="col" className="h-9 pr-3 font-medium sm:pr-2">
                  Status
                </th>
                <th scope="col" className="hidden h-9 pr-3 sm:table-cell">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((payment) => {
                const invoice = invoiceFor(payment);
                return <PaymentRow key={payment.id} payment={payment} network={network} onOpenQr={invoice ? () => setPaying(invoice) : undefined} />;
              })}
            </tbody>
          </table>
        ) : (
          <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-3 px-6 py-10 text-center">
            <span className="grid size-10 place-items-center rounded-full border border-accent-line bg-accent-soft text-accent-ink">
              <SearchX className="size-4" aria-hidden />
            </span>
            <p className="text-[13px] text-ink-2">
              {query
                ? `No ${filter === "all" ? "" : `${filter} `}payments match “${query}”.`
                : `No ${filter} payments right now.`}
            </p>
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setFilter("all");
              }}
              className="btn-ghost h-8 rounded-lg px-3 text-[13px]"
            >
              Show all payments
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-2.5 text-xs text-ink-3">
        <span>
          Showing <span className="font-mono tabular-nums text-ink-2">{rows.length}</span> of{" "}
          <span className="font-mono tabular-nums text-ink-2">{payments.length}</span>
        </span>
        <span className="hidden items-center gap-1.5 md:inline-flex" aria-hidden>
          <kbd className="kbd">/</kbd> search
          <span className="mx-1 text-line-strong">·</span>
          <kbd className="kbd">esc</kbd> clear
        </span>
        <Link href="/dashboard/transactions" className="inline-flex items-center gap-1 text-accent-ink transition-colors hover:text-ink">
          View all transactions
          <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </div>

      <SolanaPayModal invoice={paying} onClose={() => setPaying(null)} />
    </section>
  );
}

function PaymentRow({ payment, network, onOpenQr }: { payment: Payment; network: NetworkConfig; onOpenQr?: () => void }) {
  const type = PAYMENT_TYPES[payment.type];
  const tag = TAGS[payment.type];
  const TypeIcon = type.icon;
  const inbound = payment.type !== "payout";
  const explorer = payment.signature ? txExplorer(payment.signature, network) : null;
  // A link with no client is listed under its type ("Payment link"): the line below names it by number instead.
  const unnamed = payment.client === type.label;
  const note = unnamed ? payment.id : payment.memo;

  return (
    <tr className="group border-t border-line transition-colors first:border-t-0 focus-within:bg-row-hover hover:bg-row-hover">
      {/* The hover rail lives on the first cell: box-shadow on a <tr> isn't painted reliably. */}
      <td className="hidden whitespace-nowrap py-2.5 pl-5 pr-4 align-top font-mono text-xs tabular-nums transition-shadow group-hover:shadow-[inset_2px_0_0_var(--accent)] group-focus-within:shadow-[inset_2px_0_0_var(--accent)] sm:table-cell">
        <span className="text-ink-2">{formatDay(payment.createdAt)}</span> <span className="text-ink-3">{formatTime(payment.createdAt)}</span>
      </td>
      {/* w-full + max-w-0: the client column takes whatever width the fixed-content columns leave, and truncates in it. */}
      <td className="w-full max-w-0 py-2.5 pl-4 pr-2 align-top sm:pl-0 sm:pr-3">
        <p className="flex items-center gap-1.5 font-medium text-ink">
          {/* Phones drop the icon for name room; the tag below names the type either way. */}
          <TypeIcon className="hidden size-3.5 shrink-0 text-accent-ink sm:block" aria-hidden />
          <span className="truncate">{payment.client}</span>
        </p>
        <p className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-ink-3 sm:pl-5">
          <span className="shrink-0 font-mono tabular-nums sm:hidden">{formatTime(payment.createdAt)}</span>
          <span
            title={type.label}
            className={cn(
              "inline-flex h-4 shrink-0 items-center rounded-sm border px-1 font-mono text-[9.5px] font-medium uppercase leading-none tracking-[0.06em]",
              tag.className,
            )}
          >
            {tag.label}
          </span>
          {note && (
            <span className={cn("truncate", unnamed && "font-mono tabular-nums")} title={note}>
              {note}
            </span>
          )}
        </p>
      </td>
      {/* nowrap: "…" is a line-break opportunity, and a hash split over two lines is unreadable. */}
      <td className="hidden whitespace-nowrap py-2.5 pr-4 align-top md:table-cell">
        <p className="font-mono text-xs tabular-nums text-ink-2 transition-colors group-hover:text-ink" title={payment.signature ?? undefined}>
          {payment.signature ? truncateAddress(payment.signature, 6) : payment.signature === null ? "not submitted" : "awaiting payment"}
        </p>
        <p className="mt-0.5 truncate font-mono text-[11px] tabular-nums text-ink-3" title={payment.wallet ?? undefined}>
          {payment.wallet ? `${inbound ? "from" : "to"} ${truncateAddress(payment.wallet, 5)}` : "any wallet"}
        </p>
      </td>
      <td
        className={cn(
          "whitespace-nowrap py-2.5 pr-3 text-right align-top font-mono tabular-nums sm:pr-5",
          payment.status === "failed" ? "text-ink-3" : payment.status === "pending" ? "text-ink-2" : "text-ink",
        )}
      >
        <span className="inline-flex items-center justify-end gap-1.5">
          {inbound ? "+" : ""}
          {formatPaymentAmount(payment.amount)}
          {/* Phones keep the coin and drop the ticker; the column still reads USDC vs SOL at a glance. */}
          <span className="inline-flex items-center gap-1 text-[10.5px] text-ink-3 sm:w-11">
            <TokenIcon currency={payment.amount.currency} className="size-3" />
            <span className="sr-only sm:not-sr-only">{payment.amount.currency}</span>
          </span>
        </span>
      </td>
      <td className="py-2.5 pr-3 align-top sm:pr-2">
        <div className="flex items-center gap-0.5">
          <StatusBadge status={payment.status} />
          {/* Phones have no actions column: an open link's QR button stays beside its status there. */}
          {onOpenQr ? (
            <QrButton onClick={onOpenQr} className="sm:hidden" />
          ) : (
            payment.paymentUrl && <CopyLinkButton url={payment.paymentUrl} className="sm:hidden" />
          )}
        </div>
        {payment.failureReason && <p className="mt-1 max-w-[240px] text-xs text-danger">{payment.failureReason}</p>}
        {payment.receipt && <ReceiptBadge receipt={payment.receipt} compact className="mt-1" />}
      </td>
      <td className="hidden py-2 pr-3 align-top sm:table-cell">
        <div className={cn("flex items-center justify-end gap-0.5", REVEAL)}>
          {payment.signature && explorer ? (
            <>
              <CopyButton text={payment.signature} label="Copy signature" copiedLabel="Signature copied" className="size-7" />
              <a
                href={explorer.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Open this transaction in ${explorer.name} (new tab)`}
                title={`Open in ${explorer.name}`}
                className={actionClass}
              >
                <ExternalLink className="size-3.5" aria-hidden />
              </a>
            </>
          ) : payment.paymentUrl ? (
            <>
              <CopyLinkButton url={payment.paymentUrl} />
              {onOpenQr && <QrButton onClick={onOpenQr} />}
            </>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

/** Opens the Solana Pay dialog: QR code, wallet links and settlement status. */
function QrButton({ onClick, className }: { onClick: () => void; className?: string }) {
  return (
    <button type="button" onClick={onClick} aria-label="Show QR code and wallet links" title="QR code & wallet links" className={cn(actionClass, className)}>
      <QrCode className="size-3.5" aria-hidden />
    </button>
  );
}

/** Copies the https checkout link for a `solana:` payment link: it opens in any browser, not only wallet apps. */
function CopyLinkButton({ url, className }: { url: string; className?: string }) {
  const { copied, copy } = useCopy();
  const checkoutLink = useCheckoutLink();
  return (
    <button
      type="button"
      onClick={() => void copy(checkoutLink(url))}
      aria-label={copied ? "Payment link copied" : "Copy payment link"}
      title={copied ? "Copied" : "Copy payment link"}
      className={cn("relative", actionClass, className)}
    >
      <CopyIcon copied={copied} className={cn("size-3.5", copied && "text-success")} />
      <CopiedToast show={copied} label="Link copied" />
    </button>
  );
}
