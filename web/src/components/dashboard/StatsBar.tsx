"use client";

import { useMemo, type ReactNode } from "react";

import { Figure } from "@/components/ui/Figure";
import { cn } from "@/lib/cn";
import { useDashboard, useDashboardMetrics } from "@/lib/dashboard-store";
import { DAY_MS } from "@/lib/demo-data";
import { formatCount, formatDuration, formatUsd, pluralize } from "@/lib/format";
import { invoiceAmount, invoiceStatus, isInbound, usdcCents, type Change } from "@/lib/metrics";

/**
 * Each metric's color personality: a faint 950-step wash, a 900-step hairline, and the 400-step hue for its figure
 * (a step dimmer for decimals). Light theme uses the 50 / 200 / 700 steps.
 */
const TINTS = {
  blue: {
    card: "border-blue-900/50 bg-blue-950/30 light:border-blue-200 light:bg-blue-50",
    value: "text-blue-400 light:text-blue-700",
    muted: "text-blue-400/55 light:text-blue-700/60",
  },
  purple: {
    card: "border-purple-900/50 bg-purple-950/30 light:border-purple-200 light:bg-purple-50",
    value: "text-purple-400 light:text-purple-700",
    muted: "text-purple-400/55 light:text-purple-700/60",
  },
  amber: {
    card: "border-amber-900/50 bg-amber-950/30 light:border-amber-200 light:bg-amber-50",
    value: "text-amber-400 light:text-amber-700",
    muted: "text-amber-400/55 light:text-amber-700/60",
  },
  emerald: {
    card: "border-emerald-900/50 bg-emerald-950/30 light:border-emerald-200 light:bg-emerald-50",
    value: "text-emerald-400 light:text-emerald-700",
    muted: "text-emerald-400/55 light:text-emerald-700/60",
  },
} as const;

// Top-right badges: mono caps, tabular, a crisp tinted hairline over a 10% fill of the same hue.
const BADGE = "inline-flex h-5 shrink-0 items-center gap-1.5 rounded border px-1.5 font-mono text-[10.5px] font-medium uppercase leading-none tabular-nums tracking-[0.04em]";
const BADGE_TONES = {
  blue: "border-blue-500/20 bg-blue-500/10 text-blue-400 light:border-blue-200 light:bg-blue-50 light:text-blue-700",
  red: "border-red-500/25 bg-red-500/10 text-red-400 light:border-red-200 light:bg-red-50 light:text-red-700",
  emerald: "border-emerald-500/25 bg-emerald-500/10 text-emerald-400 light:border-emerald-200 light:bg-emerald-50 light:text-emerald-700",
  amber: "border-amber-500/30 bg-amber-500/10 text-amber-400/80 light:border-amber-200 light:bg-amber-50 light:text-amber-700",
  slate: "border-idle-line bg-idle-bg text-idle",
} as const;

/** Signed change vs the prior period, e.g. "+7.3%"; red when it fell. "—" when there's no earlier period. */
function TrendBadge({ change }: { change: Change }) {
  if (change.ratio === null) {
    return (
      <span className={cn(BADGE, BADGE_TONES.blue)} title="No earlier data to compare">
        —
      </span>
    );
  }
  const down = change.ratio < 0;
  return (
    <span className={cn(BADGE, down ? BADGE_TONES.red : BADGE_TONES.blue)} title={change.against}>
      <span className="sr-only">{down ? "Down" : "Up"} </span>
      {down ? "−" : "+"}
      {(Math.abs(change.ratio) * 100).toFixed(1)}%
    </span>
  );
}

/** "LIVE" with a softly pulsing dot while the figures come from the chain; "DEMO", still, on sample data. */
function SourceBadge({ live }: { live: boolean }) {
  return live ? (
    <span className={cn(BADGE, BADGE_TONES.emerald)} title="Open links, counted from live data">
      <span aria-hidden className="size-1.5 rounded-full bg-emerald-400 motion-safe:animate-pulse light:bg-emerald-600" />
      Live
    </span>
  ) : (
    <span className={cn(BADGE, BADGE_TONES.slate)} title="Counted from sample data">
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      Demo
    </span>
  );
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[mid] ?? null) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

interface Stat {
  label: string;
  tint: keyof typeof TINTS;
  /** Top-right badge: trend, data source, or what the figure summarizes. */
  badge: ReactNode;
  value: ReactNode;
  detail: ReactNode;
  title?: string;
}

/**
 * The overview's metric cards: volume, open links, how fast links get paid, and how often payments land. All four
 * come from the same ledger and invoices as the rest of the page.
 */
export function StatsBar() {
  const { rangeDays, invoices, ledger, clock, source } = useDashboard();
  const metrics = useDashboardMetrics();

  const derived = useMemo(() => {
    const windowStart = clock.today - (rangeDays - 1) * DAY_MS;

    let openCount = 0;
    let openCents = 0;
    let openSol = 0;
    const payTimes: number[] = [];
    for (const invoice of invoices) {
      const status = invoiceStatus(invoice, clock.now);
      if (status === "pending") {
        openCount += 1;
        if (invoice.mint === null) openSol += 1;
        else openCents += usdcCents(invoiceAmount(invoice));
      } else if (status === "paid" && invoice.paidAt !== undefined && invoice.paidAt >= windowStart) {
        payTimes.push(invoice.paidAt - invoice.createdAt);
      }
    }

    let settled = 0;
    let failed = 0;
    for (const tx of ledger) {
      if (tx.createdAt < windowStart || !isInbound(tx.type)) continue;
      if (tx.status === "confirmed") settled += 1;
      else if (tx.status === "failed") failed += 1;
    }
    const attempts = settled + failed;

    return {
      openCount,
      openCents,
      openSol,
      medianPayMs: median(payTimes),
      paidLinks: payTimes.length,
      successRate: attempts ? settled / attempts : null,
      failed,
      attempts,
    };
  }, [invoices, ledger, clock, rangeDays]);

  const stats: readonly Stat[] = [
    {
      label: "Volume",
      tint: "blue",
      badge: <TrendBadge change={metrics.range.change} />,
      value: <Figure value={formatUsd(metrics.range.volumeCents)} fractionClassName={TINTS.blue.muted} />,
      detail: (
        <span className="text-ink-3">
          <span className="font-mono tabular-nums text-ink-2">{formatCount(metrics.range.count)}</span> payments · last {rangeDays} days
        </span>
      ),
    },
    {
      label: "Active links",
      tint: "purple",
      badge: <SourceBadge live={source.mode === "live"} />,
      value: <span className="font-mono tabular-nums">{formatCount(derived.openCount)}</span>,
      detail: (
        <span className="text-ink-3">
          <span className="font-mono tabular-nums text-ink-2">{formatUsd(derived.openCents)}</span> awaiting payment
          {derived.openSol > 0 && ` · ${derived.openSol} in SOL`}
        </span>
      ),
    },
    {
      label: "Time to pay",
      tint: "amber",
      badge: <span className={cn(BADGE, BADGE_TONES.amber)}>Median</span>,
      title: "From creating a link or invoice to its payment confirming on-chain, for those paid in this range.",
      value: <span className="font-mono tabular-nums">{derived.medianPayMs === null ? "—" : formatDuration(derived.medianPayMs)}</span>,
      detail: (
        <span className="text-ink-3">
          {derived.paidLinks ? `${pluralize(derived.paidLinks, "link")} paid in ${rangeDays} days` : "No links paid in this range"}
        </span>
      ),
    },
    {
      label: "Success rate",
      tint: "emerald",
      // Phones drop "avg" so the label beside it isn't cut off.
      badge: (
        <span className={cn(BADGE, BADGE_TONES.emerald)}>
          {rangeDays}D<span className="hidden sm:inline"> avg</span>
        </span>
      ),
      title: "Settled inbound payments out of settled plus failed ones in this range. Pending payments aren't counted yet.",
      value: <span className="font-mono tabular-nums">{derived.successRate === null ? "—" : `${(derived.successRate * 100).toFixed(1)}%`}</span>,
      detail: (
        <span className="text-ink-3">
          {derived.attempts ? (
            <>
              <span className={cn("font-mono tabular-nums", derived.failed ? "text-danger" : "text-ink-2")}>{formatCount(derived.failed)}</span> failed of{" "}
              <span className="font-mono tabular-nums text-ink-2">{formatCount(derived.attempts)}</span>
            </>
          ) : (
            "No settled payments yet"
          )}
        </span>
      ),
    },
  ];

  return (
    <section aria-label="Key figures" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {stats.map((stat) => {
        const tint = TINTS[stat.tint];
        return (
          <div
            key={stat.label}
            title={stat.title}
            // A 1px top highlight gives the tinted surface a pressed-glass edge without any glow.
            className={cn(
              "min-w-0 rounded-xl border px-4 py-3.5 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] sm:px-5 sm:py-4",
              tint.card,
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-[13px] text-ink-2">{stat.label}</p>
              {stat.badge}
            </div>
            <p className={cn("mt-2 truncate text-xl leading-tight tracking-[-0.03em] sm:text-[22px]", tint.value)}>{stat.value}</p>
            <div className="mt-1.5 truncate text-xs">{stat.detail}</div>
          </div>
        );
      })}
    </section>
  );
}
