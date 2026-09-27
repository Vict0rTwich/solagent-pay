"use client";

import { useMemo, useState, type KeyboardEvent } from "react";

import { cn } from "@/lib/cn";
import { DAY_MS } from "@/lib/demo-data";
import { formatTime, formatUsd, pluralize } from "@/lib/format";
import { usdcCents } from "@/lib/metrics";
import type { Payment } from "@/lib/types";

interface SettlementRailProps {
  /** Settled inbound payments for the day: the USDC ledger's. */
  payments: readonly Payment[];
  dayStart: number;
  now: number;
  className?: string;
}

/** Twelve two-hour windows across the UTC day. */
const BUCKETS = 12;
const BUCKET_MS = DAY_MS / BUCKETS;

interface Bucket {
  start: number;
  cents: number;
  count: number;
  agents: number;
  /** Starts after now: nothing can have settled in it yet. */
  future: boolean;
}

/**
 * Today's settlements as twelve two-hour bars: height is the window's USDC volume, on a linear scale from zero.
 * Windows still to come are dashed outlines. Hover a bar, or focus the chart and use the arrow keys, for its totals.
 */
export function SettlementRail({ payments, dayStart, now, className }: SettlementRailProps) {
  const buckets = useMemo<Bucket[]>(() => {
    const list: Bucket[] = Array.from({ length: BUCKETS }, (_, i) => {
      const start = dayStart + i * BUCKET_MS;
      return { start, cents: 0, count: 0, agents: 0, future: start > now };
    });
    for (const payment of payments) {
      const bucket = list[Math.floor((payment.createdAt - dayStart) / BUCKET_MS)];
      if (!bucket) continue;
      bucket.cents += usdcCents(payment.amount);
      bucket.count += 1;
      if (payment.type === "agent") bucket.agents += 1;
    }
    return list;
  }, [payments, dayStart, now]);
  const [active, setActive] = useState<number | null>(null);

  const maxCents = Math.max(1, ...buckets.map((b) => b.cents));
  const totalCents = buckets.reduce((sum, b) => sum + b.cents, 0);
  const agentCount = buckets.reduce((sum, b) => sum + b.agents, 0);
  const currentIndex = Math.min(BUCKETS - 1, Math.max(0, Math.floor((now - dayStart) / BUCKET_MS)));

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, number> = {
      ArrowLeft: Math.max(0, (active ?? currentIndex) - 1),
      ArrowRight: Math.min(BUCKETS - 1, (active ?? currentIndex) + 1),
      Home: 0,
      End: BUCKETS - 1,
    };
    const next = moves[event.key];
    if (next !== undefined) {
      event.preventDefault();
      setActive(next);
    }
  };

  const activeBucket = active === null ? undefined : buckets[active];
  const activePct = active === null ? 0 : ((active + 0.5) / BUCKETS) * 100;
  const windowLabel = (i: number) => `${formatTime(dayStart + i * BUCKET_MS)}–${i === BUCKETS - 1 ? "24:00" : formatTime(dayStart + (i + 1) * BUCKET_MS)}`;

  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="eyebrow">Today&rsquo;s settlements</p>
        <p className="font-mono text-xs tabular-nums text-ink">{formatUsd(totalCents)}</p>
      </div>
      <p className="mt-1 text-xs text-ink-3">
        <span className="font-mono tabular-nums text-ink-2">{payments.length}</span> settled ·{" "}
        <span className="font-mono tabular-nums text-ink-2">{agentCount}</span> by AI agents · 2-hour windows
      </p>

      <div
        tabIndex={0}
        role="group"
        aria-label={`Today's settlements in two-hour windows: ${pluralize(payments.length, "payment")}, ${formatUsd(totalCents)} in total. Use the arrow keys to step through the windows.`}
        onFocus={() => setActive(currentIndex)}
        onBlur={() => setActive(null)}
        onPointerLeave={() => setActive(null)}
        onKeyDown={onKeyDown}
        className="relative mt-3 flex h-8 items-end gap-1 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-panel"
      >
        {buckets.map((bucket, i) => (
          <div key={bucket.start} onPointerEnter={() => setActive(i)} className="group/bar flex h-full flex-1 cursor-default items-end">
            {bucket.future ? (
              <span aria-hidden className="h-full w-full rounded-sm border border-dashed border-line-strong" />
            ) : (
              <span
                aria-hidden
                className={cn(
                  "w-full rounded-sm transition-colors",
                  bucket.count === 0 ? "bg-line-strong" : active === i ? "bg-blue-500" : "bg-blue-500/20 group-hover/bar:bg-blue-500",
                )}
                // Linear from zero; a paid window never drops below a visible sliver, an empty one sits on the baseline.
                style={{ height: bucket.count === 0 ? "2px" : `${Math.max(12, (bucket.cents / maxCents) * 100)}%` }}
              />
            )}
          </div>
        ))}

        {activeBucket && (
          <div
            role="status"
            className="popover pointer-events-none absolute bottom-full z-10 mb-2 w-max px-3 py-2"
            style={{
              left: `${activePct}%`,
              transform: `translateX(${activePct < 15 ? "-12%" : activePct > 85 ? "-88%" : "-50%"})`,
            }}
          >
            <p className="font-mono text-[11px] tabular-nums text-ink-3">{windowLabel(active ?? 0)} UTC</p>
            {activeBucket.future ? (
              <p className="mt-0.5 text-xs text-ink-2">Later today</p>
            ) : (
              <>
                <p className="mt-0.5 font-mono text-sm font-medium tabular-nums text-ink">{formatUsd(activeBucket.cents)}</p>
                <p className="mt-0.5 text-xs text-ink-2">
                  {pluralize(activeBucket.count, "payment")}
                  {activeBucket.agents > 0 && ` · ${activeBucket.agents} by AI agents`}
                </p>
              </>
            )}
          </div>
        )}
      </div>

      <div className="mt-1.5 flex justify-between font-mono text-[10px] tabular-nums text-ink-3" aria-hidden>
        <span>00:00</span>
        <span>06:00</span>
        <span>12:00</span>
        <span>18:00</span>
        <span>24:00</span>
      </div>
    </div>
  );
}
