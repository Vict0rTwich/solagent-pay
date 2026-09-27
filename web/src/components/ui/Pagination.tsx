"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

import { formatCount } from "@/lib/format";

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
  noun,
}: {
  /** Zero-based. */
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  /** Singular and plural nouns for the count, e.g. ["transaction", "transactions"]. */
  noun: readonly [string, string];
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : page * pageSize + 1;
  const last = Math.min(total, (page + 1) * pageSize);

  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-3 text-xs text-ink-3">
      <p aria-live="polite">
        {total === 0 ? (
          `No ${noun[1]}`
        ) : (
          <>
            <span className="font-mono text-ink-2">
              {formatCount(first)}–{formatCount(last)}
            </span>{" "}
            of <span className="font-mono text-ink-2">{formatCount(total)}</span> {total === 1 ? noun[0] : noun[1]}
          </>
        )}
      </p>
      <div className="flex items-center gap-1.5">
        <span className="mr-1 font-mono tabular-nums">
          {page + 1} / {pageCount}
        </span>
        <button
          type="button"
          onClick={() => onPage(page - 1)}
          disabled={page === 0}
          aria-label="Previous page"
          className="btn-ghost grid size-7 place-items-center rounded-md disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronLeft className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => onPage(page + 1)}
          disabled={page >= pageCount - 1}
          aria-label="Next page"
          className="btn-ghost grid size-7 place-items-center rounded-md disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>
    </nav>
  );
}
