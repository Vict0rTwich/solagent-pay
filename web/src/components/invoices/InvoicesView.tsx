"use client";

import { ExternalLink, FileText, Link2, PackagePlus, QrCode, SearchX, ShoppingBag, SlidersHorizontal, TriangleAlert } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { SolanaPayModal } from "@/components/checkout/SolanaPayModal";
import { InvoiceStatusBadge } from "@/components/dashboard/payment-meta";
import { Reveal } from "@/components/dashboard/Reveal";
import { CreateProductModal } from "@/components/products/CreateProductModal";
import { ProductsSection } from "@/components/products/ProductsSection";
import { ReceiptBadge } from "@/components/receipts/ReceiptBadge";
import { CopyButton } from "@/components/ui/CopyButton";
import { Figure } from "@/components/ui/Figure";
import { useCheckoutLink } from "@/hooks/use-checkout-link";
import { FilterTabs } from "@/components/ui/FilterTabs";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pagination } from "@/components/ui/Pagination";
import { SearchInput } from "@/components/ui/SearchInput";
import { TokenIcon } from "@/components/ui/TokenIcon";
import { cn } from "@/lib/cn";
import { currencyOfMint } from "@/lib/currency";
import { useDashboard } from "@/lib/dashboard-store";
import { DAY_MS } from "@/lib/demo-data";
import { formatCount, formatDay, formatDuration, formatTime, formatUsd, pluralize, truncateAddress } from "@/lib/format";
import { invoiceAmount, invoiceStatus, usdcCents } from "@/lib/metrics";
import { txExplorer } from "@/lib/network";
import { useNetwork } from "@/lib/settings";
import { SOL_DECIMALS, amountToBaseUnits, assetSymbol, formatAmount, formatBaseUnits } from "@/lib/solana-pay";
import type { Invoice, InvoiceStatus } from "@/lib/types";

import { InvoiceModal } from "./InvoiceModal";

const PAGE_SIZE = 12;

type Filter = "all" | InvoiceStatus;

/** USDC in cents and SOL in lamports, summed apart: there's no exchange rate here to add them up. */
function totals(invoices: readonly Invoice[]): { cents: number; lamports: bigint } {
  let cents = 0;
  let lamports = 0n;
  for (const invoice of invoices) {
    if (invoice.mint === null) lamports += amountToBaseUnits(invoice.amount, SOL_DECIMALS);
    else cents += usdcCents(invoiceAmount(invoice));
  }
  return { cents, lamports };
}

/** " · 2.5 SOL" when there's any SOL, else nothing. */
function solSuffix(lamports: bigint, prefix = " · "): string {
  return lamports > 0n ? `${prefix}${formatBaseUnits(lamports, SOL_DECIMALS)} SOL` : "";
}

interface Row {
  invoice: Invoice;
  status: InvoiceStatus;
  now: number;
}

export function InvoicesView() {
  const { invoices, clock, source } = useDashboard();
  const network = useNetwork();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(0);
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<Invoice | null>(null);
  const [paying, setPaying] = useState<Invoice | null>(null);
  const live = source.mode === "live";

  const rows = useMemo<Row[]>(
    () => invoices.map((invoice) => ({ invoice, status: invoiceStatus(invoice, clock.now), now: clock.now })),
    [invoices, clock.now],
  );

  const metrics = useMemo(() => {
    const windowStart = clock.today - 29 * DAY_MS;
    const open = rows.filter((r) => r.status === "pending");
    const paid = rows.filter((r) => r.invoice.paidAt !== undefined && r.invoice.paidAt >= windowStart);
    const collectionMs = paid.reduce((sum, r) => sum + ((r.invoice.paidAt ?? 0) - r.invoice.createdAt), 0);
    return {
      openCount: open.length,
      open: totals(open.map((r) => r.invoice)),
      paidCount: paid.length,
      paid: totals(paid.map((r) => r.invoice)),
      averageCollectionMs: paid.length ? collectionMs / paid.length : null,
    };
  }, [rows, clock.today]);

  const searched = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return rows;
    return rows.filter(({ invoice }) => {
      const haystack = [invoice.id, invoice.memo, invoice.client, invoice.payer ?? "", formatAmount(invoice.amount), assetSymbol(invoice.mint)]
        .join(" ")
        .toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }, [rows, query]);

  const counts = useMemo(() => {
    const result: Record<Filter, number> = { all: searched.length, pending: 0, paid: 0, expired: 0, canceled: 0 };
    for (const row of searched) result[row.status] += 1;
    return result;
  }, [searched]);

  const filtered = filter === "all" ? searched : searched.filter((r) => r.status === filter);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-5">
      <Reveal index={0}>
        <PageHeader
          title="Products & invoices"
          description="Sell products through Blinks and the PoS, bill clients in USDC or SOL, and see what has been paid."
          note={
            live
              ? `Live · orders and invoices for ${truncateAddress(source.owner ?? "")}, paid status checked on ${network.label}`
              : "Sample data · seeded devnet products and invoices"
          }
          actions={
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="btn-primary inline-flex h-9 items-center gap-2 rounded-lg px-3.5 text-[13px]"
            >
              <PackagePlus className="size-4" aria-hidden />
              New product
            </button>
          }
        />
      </Reveal>

      <Reveal index={1}>
        <ProductsSection onCreate={() => setCreating(true)} />
      </Reveal>

      <Reveal index={2}>
        <section aria-label="Invoice figures" className="card grid divide-y divide-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <Metric
            label="Active links"
            value={formatCount(metrics.openCount)}
            detail={`${formatUsd(metrics.open.cents)}${solSuffix(metrics.open.lamports, " + ")} awaiting payment`}
          />
          <Metric
            label="Settled volume"
            value={<Figure value={formatUsd(metrics.paid.cents)} />}
            unit="USDC"
            detail={`${pluralize(metrics.paidCount, "invoice")} paid · last 30 days${solSuffix(metrics.paid.lamports, " · plus ")}`}
          />
          <Metric
            label="Avg collection time"
            value={metrics.averageCollectionMs === null ? "—" : formatDuration(metrics.averageCollectionMs)}
            detail="From sending to payment · last 30 days"
          />
        </section>
      </Reveal>

      <Reveal index={3}>
        <section aria-labelledby="invoice-list-heading" className="card min-w-0">
          <h2 id="invoice-list-heading" className="sr-only">
            Orders and invoices
          </h2>
          <div className="flex flex-wrap items-center gap-2.5 px-4 py-3 sm:px-5">
            <SearchInput
              value={query}
              onChange={(value) => {
                setQuery(value);
                setPage(0);
              }}
              placeholder="Search product, client, buyer or number…"
              label="Search orders and invoices by product, memo, client, buyer wallet or number"
              className="w-full sm:w-80"
            />
            <FilterTabs
              label="Filter by status"
              value={filter}
              onChange={(value) => {
                setFilter(value);
                setPage(0);
              }}
              options={[
                { value: "all", label: "All", count: counts.all },
                { value: "pending", label: "Pending", count: counts.pending },
                { value: "paid", label: "Paid", count: counts.paid },
                { value: "expired", label: "Expired", count: counts.expired },
                { value: "canceled", label: "Canceled", count: counts.canceled },
              ]}
            />
          </div>

          <div className="relative overflow-x-auto border-t border-line">
            {pageRows.length > 0 ? (
              <table className="w-full text-[13px] sm:min-w-[860px]">
                <caption className="sr-only">Orders, invoices and payment links, newest first</caption>
                <thead>
                  <tr className="th text-left shadow-[inset_0_-1px_0_var(--line)]">
                    <th scope="col" className="h-9 pl-4 pr-3 font-medium sm:pl-5">
                      Invoice
                    </th>
                    <th scope="col" className="hidden h-9 pr-3 font-medium sm:table-cell">
                      Client or buyer
                    </th>
                    <th scope="col" className="hidden h-9 pr-6 text-right font-medium sm:table-cell">
                      Amount
                    </th>
                    <th scope="col" className="h-9 pr-3 font-medium">
                      Status
                    </th>
                    <th scope="col" className="hidden h-9 pr-3 font-medium sm:table-cell">
                      Created <span className="font-mono normal-case tracking-normal">(UTC)</span>
                    </th>
                    <th scope="col" className="h-9 pr-4 text-right font-medium sm:pr-5">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((row) => (
                    <InvoiceRow key={row.invoice.id} row={row} onOpenPayment={() => setViewing(row.invoice)} onOpenQr={() => setPaying(row.invoice)} />
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
                <span className="grid size-10 place-items-center rounded-full border border-accent-line bg-accent-soft text-accent-ink">
              <SearchX className="size-4" aria-hidden />
            </span>
                <p className="text-[13px] text-ink-2">
                  {query
                    ? `No ${filter === "all" ? "" : `${filter} `}orders or invoices match “${query}”.`
                    : filter === "all"
                      ? "No orders yet. Share a product's Blink or charge at the PoS, and each sale shows up here."
                      : `No ${filter} orders or invoices.`}
                </p>
                {query || filter !== "all" ? (
                  <button
                    type="button"
                    onClick={() => {
                      setQuery("");
                      setFilter("all");
                      setPage(0);
                    }}
                    className="btn-ghost h-8 rounded-lg px-3 text-[13px]"
                  >
                    Show all invoices
                  </button>
                ) : (
                  <button type="button" onClick={() => setCreating(true)} className="btn-primary h-8 rounded-lg px-3 text-[13px]">
                    New product
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="border-t border-line px-4 py-2.5 sm:px-5">
            <Pagination page={currentPage} pageSize={PAGE_SIZE} total={filtered.length} onPage={setPage} noun={["invoice", "invoices"]} />
          </div>
        </section>
      </Reveal>

      <CreateProductModal open={creating} onClose={() => setCreating(false)} />
      <InvoiceModal invoice={viewing} onClose={() => setViewing(null)} />
      <SolanaPayModal invoice={paying} onClose={() => setPaying(null)} />
    </div>
  );
}

function Metric({ label, value, unit, detail }: { label: string; value: ReactNode; unit?: string; detail: string }) {
  return (
    <div className="px-5 py-4">
      <p className="text-[13px] text-ink-2">{label}</p>
      <p className="mt-2 flex items-baseline gap-1.5">
        <span className="font-mono text-[22px] leading-tight tracking-[-0.03em] text-ink">{value}</span>
        {unit && <span className="font-mono text-[11px] text-ink-3">{unit}</span>}
      </p>
      <p className="mt-1.5 text-xs text-ink-3">{detail}</p>
    </div>
  );
}

function statusDetail({ invoice, status, now }: Row): string {
  if (status === "paid") return `Paid in ${formatDuration((invoice.paidAt ?? invoice.createdAt) - invoice.createdAt)}`;
  if (status === "expired") return `Expired ${formatDay(invoice.expiresAt)}`;
  if (status === "canceled") return `Canceled ${formatDay(invoice.canceledAt ?? invoice.createdAt)}`;
  return `Expires in ${formatDuration(invoice.expiresAt - Math.max(now, invoice.createdAt))}`;
}

const CLOSED_REASONS: Record<Exclude<InvoiceStatus, "pending">, string> = {
  paid: "Already paid",
  expired: "Link expired",
  canceled: "Payment canceled",
};

function InvoiceRow({ row, onOpenPayment, onOpenQr }: { row: Row; onOpenPayment: () => void; onOpenQr: () => void }) {
  const network = useNetwork();
  const checkoutLink = useCheckoutLink();
  const { invoice, status } = row;
  const KindIcon = invoice.productId ? ShoppingBag : invoice.kind === "link" ? Link2 : FileText;
  const who = invoice.client || (invoice.payer ? truncateAddress(invoice.payer, 5) : "Any payer");
  const explorer = invoice.signature ? txExplorer(invoice.signature, network) : null;
  const dimmed = status === "expired" || status === "canceled";

  const actionClass =
    "grid size-7 shrink-0 place-items-center rounded-md text-accent-ink/70 transition-colors hover:bg-accent-soft hover:text-accent-ink";

  return (
    <tr className="border-t border-line transition-colors first:border-t-0 focus-within:bg-row-hover hover:bg-row-hover">
      <td className="max-w-[170px] py-2.5 pl-4 pr-2 align-top sm:max-w-[300px] sm:pl-5 sm:pr-3">
        <p className="flex items-center gap-1.5 font-medium text-ink">
          <KindIcon
            className="size-3.5 shrink-0 text-accent-ink"
            aria-label={invoice.productId ? "Product order" : invoice.kind === "link" ? "Payment link" : "Invoice"}
          />
          <span className="truncate">{invoice.memo || "Untitled link"}</span>
        </p>
        <p className="mt-0.5 hidden truncate font-mono text-[11px] tabular-nums text-ink-3 sm:block">{invoice.id}</p>
        {/* Below sm the amount and client columns fold in here. */}
        <p className="truncate text-xs sm:hidden">
          <span className={cn("font-mono", dimmed ? "text-ink-3" : "text-ink")}>
            {formatAmount(invoice.amount)} {assetSymbol(invoice.mint)}
          </span>
          <span className="text-ink-3"> · {who}</span>
        </p>
      </td>
      <td className="hidden max-w-[200px] py-2.5 pr-3 align-top sm:table-cell">
        <p
          className={cn("truncate", invoice.client ? "text-ink-2" : invoice.payer ? "font-mono text-xs text-ink-2" : "text-ink-3")}
          title={invoice.client ? undefined : invoice.payer}
        >
          {who}
        </p>
      </td>
      <td
        className={cn(
          "hidden whitespace-nowrap py-2.5 pr-6 text-right align-top font-mono tabular-nums sm:table-cell",
          dimmed ? "text-ink-3" : "text-ink",
        )}
      >
        <span className="inline-flex items-center justify-end gap-1.5">
          {formatAmount(invoice.amount)}
          <span className="inline-flex w-12 items-center gap-1 text-[10.5px] text-ink-3">
            <TokenIcon currency={currencyOfMint(invoice.mint)} className="size-3" />
            {assetSymbol(invoice.mint)}
          </span>
        </span>
      </td>
      <td className="max-w-[220px] py-2.5 pr-2 align-top sm:pr-3">
        <div className="flex flex-wrap items-center gap-1">
          <InvoiceStatusBadge status={status} />
          {invoice.receipt && <ReceiptBadge receipt={invoice.receipt} compact />}
        </div>
        <p className="mt-1 text-[11.5px] text-ink-3 sm:whitespace-nowrap">{statusDetail(row)}</p>
        {status === "pending" && invoice.issue && (
          <p className="mt-1 flex gap-1 text-xs text-warning" title={invoice.issue.message}>
            <TriangleAlert className="mt-px size-3 shrink-0" aria-hidden />
            <span className="line-clamp-2">{invoice.issue.message}</span>
          </p>
        )}
      </td>
      <td className="hidden whitespace-nowrap py-2.5 pr-3 align-top sm:table-cell">
        <span className="text-ink-2">{formatDay(invoice.createdAt)}</span>{" "}
        <span className="font-mono text-xs tabular-nums text-ink-3">{formatTime(invoice.createdAt)}</span>
      </td>
      <td className="py-2 pr-2 align-top sm:pr-4">
        <div className="flex flex-col items-end gap-0.5 sm:flex-row sm:justify-end">
          <CopyButton
            className="size-7"
            text={checkoutLink(invoice.paymentUrl)}
            label={`Copy checkout link for ${invoice.id}`}
            copiedLabel="Link copied"
            disabled={status !== "pending"}
            disabledReason={status === "pending" ? undefined : CLOSED_REASONS[status]}
          />
          {status === "pending" ? (
            <>
              {/* QR code, wallet deep links and live settlement status. */}
              <button
                type="button"
                onClick={onOpenQr}
                aria-label={`QR code and wallet links for ${invoice.id}`}
                title="QR code & wallet links"
                className={actionClass}
              >
                <QrCode className="size-4" aria-hidden />
              </button>
              {/* Pay from this browser's wallet, share as a Blink, or cancel. */}
              <button
                type="button"
                onClick={onOpenPayment}
                aria-label={`Manage ${invoice.id}: pay, share or cancel`}
                title="Pay, share or cancel"
                className={actionClass}
              >
                <SlidersHorizontal className="size-4" aria-hidden />
              </button>
            </>
          ) : explorer ? (
            <a
              href={explorer.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`View the payment for ${invoice.id} on ${explorer.name}`}
              title={`View on ${explorer.name}`}
              className={actionClass}
            >
              <ExternalLink className="size-4" aria-hidden />
            </a>
          ) : (
            <span
              className={cn(actionClass, "cursor-not-allowed opacity-40 hover:bg-transparent")}
              title={CLOSED_REASONS[status]}
              aria-hidden
            >
              <ExternalLink className="size-4" />
            </span>
          )}
        </div>
      </td>
    </tr>
  );
}
