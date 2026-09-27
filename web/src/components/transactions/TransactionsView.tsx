"use client";

import { Bot, Download, ExternalLink, FileText, Link2, SearchX } from "lucide-react";
import { useMemo, useState } from "react";

import { PAYMENT_TYPES, TxStatusBadge, TypeBadge } from "@/components/dashboard/payment-meta";
import { Reveal } from "@/components/dashboard/Reveal";
import { CopyButton } from "@/components/ui/CopyButton";
import { FilterTabs, type FilterOption } from "@/components/ui/FilterTabs";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pagination } from "@/components/ui/Pagination";
import { SearchInput } from "@/components/ui/SearchInput";
import { cn } from "@/lib/cn";
import { downloadCsv, toCsv } from "@/lib/csv";
import { useDashboard } from "@/lib/dashboard-store";
import { LEDGER_DAYS } from "@/lib/demo-data";
import { LEDGER_LIMIT } from "@/lib/live-data";
import { formatDay, formatTime, formatUsd, formatUsdc, pluralize, truncateAddress } from "@/lib/format";
import { txExplorer, type NetworkConfig } from "@/lib/network";
import { useNetwork } from "@/lib/settings";
import type { LedgerTx } from "@/lib/types";

const PAGE_SIZE = 20;

type TypeFilter = "all" | "agent" | "link" | "invoice";

function matches(tx: LedgerTx, terms: readonly string[]): boolean {
  const haystack = [tx.signature ?? "", tx.senderName, tx.wallet ?? "", tx.memo, tx.invoiceId ?? ""].join(" ").toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

function exportLedger(rows: readonly LedgerTx[], network: NetworkConfig): void {
  const csv = toCsv(
    ["signature", "timestamp_utc", "sender", "sender_wallet", "type", "amount_usdc", "status", "error_code", "memo", "invoice_id", "explorer_url"],
    rows.map((tx) => [
      tx.signature,
      new Date(tx.createdAt).toISOString(),
      tx.senderName,
      tx.wallet,
      PAYMENT_TYPES[tx.type].label,
      (tx.amountCents / 100).toFixed(2),
      tx.status,
      tx.failure?.code,
      tx.memo,
      tx.invoiceId,
      tx.signature ? txExplorer(tx.signature, network).url : null,
    ]),
  );
  downloadCsv(`solagent-transactions-${new Date().toISOString().slice(0, 10)}.csv`, csv);
}

export function TransactionsView() {
  const { ledger, source } = useDashboard();
  const network = useNetwork();
  const live = source.mode === "live";
  const [query, setQuery] = useState("");
  const [type, setType] = useState<TypeFilter>("all");
  const [page, setPage] = useState(0);

  const searched = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    return terms.length ? ledger.filter((tx) => matches(tx, terms)) : ledger;
  }, [ledger, query]);

  const counts = useMemo(() => {
    const result: Record<TypeFilter, number> = { all: searched.length, agent: 0, link: 0, invoice: 0 };
    for (const tx of searched) if (tx.type === "agent" || tx.type === "link" || tx.type === "invoice") result[tx.type] += 1;
    return result;
  }, [searched]);

  const filtered = useMemo(() => (type === "all" ? searched : searched.filter((tx) => tx.type === type)), [searched, type]);
  const confirmedCents = useMemo(
    () => filtered.filter((tx) => tx.status === "confirmed" && tx.type !== "payout").reduce((sum, tx) => sum + tx.amountCents, 0),
    [filtered],
  );

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  const typeOptions: ReadonlyArray<FilterOption<TypeFilter>> = [
    { value: "all", label: "All", count: counts.all },
    { value: "agent", label: "AI agent", icon: Bot, count: counts.agent },
    { value: "link", label: "Payment link", icon: Link2, count: counts.link },
    { value: "invoice", label: "Direct invoice", icon: FileText, count: counts.invoice },
  ];

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-5">
      <Reveal index={0}>
        <PageHeader
          title="Transactions"
          description={
            live
              ? `USDC moving in and out of your wallet on ${network.label}.`
              : `Audit ledger of USDC settlements over the last ${LEDGER_DAYS} days.`
          }
          note={
            live
              ? `Live · latest ${LEDGER_LIMIT} transfers for ${truncateAddress(source.owner ?? "")}${
                  source.fetchedAt ? ` · updated ${formatTime(source.fetchedAt)} UTC` : ""
                }`
              : "Sample data · seeded signatures won't resolve on Solscan"
          }
          actions={
            <button
              type="button"
              onClick={() => exportLedger(filtered, network)}
              disabled={filtered.length === 0}
              className="btn-ghost inline-flex h-9 items-center gap-2 rounded-lg px-3.5 text-[13px] font-medium disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download className="size-3.5" aria-hidden />
              Export CSV
            </button>
          }
        />
      </Reveal>

      <Reveal index={1}>
        <section aria-labelledby="ledger-heading" className="card min-w-0">
          <h2 id="ledger-heading" className="sr-only">
            Settlement ledger
          </h2>
          <div className="flex flex-wrap items-center gap-2.5 px-4 py-3 sm:px-5">
            <SearchInput
              value={query}
              onChange={(value) => {
                setQuery(value);
                setPage(0);
              }}
              placeholder="Search signature, sender or wallet…"
              label="Search transactions by signature, sender name or wallet"
              className="w-full sm:w-80"
            />
            <FilterTabs
              label="Filter by payment type"
              value={type}
              onChange={(value) => {
                setType(value);
                setPage(0);
              }}
              options={typeOptions}
            />
            <p className="ml-auto text-xs text-ink-3" aria-live="polite">
              {pluralize(filtered.length, "transaction")} · <span className="font-mono text-ink-2">{formatUsd(confirmedCents)}</span> confirmed
            </p>
          </div>

          <div className="relative overflow-x-auto border-t border-line">
            {pageRows.length > 0 ? (
              <table className="w-full min-w-[980px] text-[13px]">
                <caption className="sr-only">USDC settlements, newest first</caption>
                <thead>
                  <tr className="th text-left shadow-[inset_0_-1px_0_var(--line)]">
                    <th scope="col" className="h-9 pl-4 pr-3 font-medium sm:pl-5">
                      Signature
                    </th>
                    <th scope="col" className="h-9 pr-3 font-medium">
                      Sender
                    </th>
                    <th scope="col" className="h-9 pr-3 font-medium">
                      Type
                    </th>
                    <th scope="col" className="h-9 pr-6 text-right font-medium">
                      Amount <span className="font-mono normal-case tracking-normal">(USDC)</span>
                    </th>
                    <th scope="col" className="h-9 pr-3 font-medium">
                      Status
                    </th>
                    <th scope="col" className="h-9 pr-3 font-medium">
                      Time <span className="font-mono normal-case tracking-normal">(UTC)</span>
                    </th>
                    <th scope="col" className="h-9 pr-4 font-medium sm:pr-5">
                      Explorer
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((tx) => (
                    <LedgerRow key={tx.signature ?? `payout-${tx.createdAt}`} tx={tx} network={network} />
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
                    ? `No transactions match “${query}”.`
                    : type !== "all"
                      ? "No transactions of this type yet."
                      : `No USDC has moved in or out of this wallet on ${network.label} yet.`}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    setType("all");
                    setPage(0);
                  }}
                  className="btn-ghost h-8 rounded-lg px-3 text-[13px]"
                >
                  Show all transactions
                </button>
              </div>
            )}
          </div>

          <div className="border-t border-line px-4 py-2.5 sm:px-5">
            <Pagination
              page={currentPage}
              pageSize={PAGE_SIZE}
              total={filtered.length}
              onPage={setPage}
              noun={["transaction", "transactions"]}
            />
          </div>
        </section>
      </Reveal>
    </div>
  );
}

function LedgerRow({ tx, network }: { tx: LedgerTx; network: NetworkConfig }) {
  const explorer = tx.signature ? txExplorer(tx.signature, network) : null;
  const outbound = tx.type === "payout";

  return (
    <tr className="border-t border-line transition-colors first:border-t-0 focus-within:bg-row-hover hover:bg-row-hover">
      <td className="py-2 pl-4 pr-3 align-top sm:pl-5">
        {tx.signature ? (
          <div className="flex items-center gap-0.5">
            <span className="font-mono text-xs tabular-nums text-ink-2" title={tx.signature}>
              {truncateAddress(tx.signature, 6)}
            </span>
            <CopyButton text={tx.signature} label="Copy signature" copiedLabel="Signature copied" className="size-6" />
          </div>
        ) : (
          <span className="text-xs text-ink-3">Not submitted yet</span>
        )}
      </td>
      <td className="max-w-[220px] py-2 pr-3 align-top">
        <p className="truncate font-medium text-ink">{tx.senderName}</p>
        <p className="mt-0.5 truncate font-mono text-[11px] tabular-nums text-ink-3" title={tx.wallet ?? undefined}>
          {tx.wallet ? truncateAddress(tx.wallet, 5) : "—"}
          {tx.invoiceId && <span className="text-ink-3"> · {tx.invoiceId}</span>}
        </p>
      </td>
      <td className="py-2 pr-3 align-top">
        <TypeBadge type={tx.type} />
      </td>
      <td
        className={cn(
          "whitespace-nowrap py-2 pr-6 text-right align-top font-mono tabular-nums",
          tx.status === "failed" ? "text-ink-3 line-through decoration-ink-3/60" : tx.status === "pending" ? "text-ink-2" : "text-ink",
        )}
      >
        {outbound ? "" : "+"}
        {formatUsdc(tx.amountCents)}
      </td>
      <td className="py-2 pr-3 align-top">
        <TxStatusBadge status={tx.status} />
        {tx.failure && (
          <p className="mt-1 max-w-[200px] text-xs text-danger">
            <span className="font-mono">{tx.failure.code}</span>
            <span className="block text-ink-3">{tx.failure.message}</span>
          </p>
        )}
      </td>
      <td className="whitespace-nowrap py-2 pr-3 align-top">
        <span className="text-ink-2">{formatDay(tx.createdAt)}</span>{" "}
        <span className="font-mono text-xs tabular-nums text-ink-3">{formatTime(tx.createdAt)}</span>
      </td>
      <td className="py-2 pr-4 align-top sm:pr-5">
        {explorer ? (
          <a
            href={explorer.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-accent-ink transition-colors hover:text-ink"
          >
            {explorer.name}
            <ExternalLink className="size-3.5" aria-hidden />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        ) : (
          <span className="text-xs text-ink-3">—</span>
        )}
      </td>
    </tr>
  );
}
