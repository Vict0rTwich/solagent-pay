"use client";

import { useMemo } from "react";

import { useMinuteClock } from "@/hooks/use-minute-clock";
import { cn } from "@/lib/cn";
import { useDashboard } from "@/lib/dashboard-store";
import { useNetwork } from "@/lib/settings";
import { BUSINESS_TIME_ZONE, formatUtc, formatZoned, viewerTimeZone, zonedTime } from "@/lib/time-zones";

/**
 * A moment as UTC, Nigeria's time (WAT), and the viewer's own time when their device is somewhere else. Renders
 * nothing until mounted: the zones come from the browser.
 */
function Moment({ ms, withDay }: { ms: number; withDay: boolean }) {
  const viewer = useMemo(() => viewerTimeZone(), []);
  const business = zonedTime(ms, BUSINESS_TIME_ZONE);
  const title = [
    formatUtc(ms),
    `${business.day}, ${business.time} ${business.zoneName} (${BUSINESS_TIME_ZONE.place})`,
    ...(viewer ? [`${formatZoned(ms, viewer)} on this device (${viewer.place})`] : []),
  ].join("\n");

  return (
    <time dateTime={new Date(ms).toISOString()} title={title}>
      {formatUtc(ms, withDay)} · {formatZoned(ms, BUSINESS_TIME_ZONE)}
      {viewer && <span className="text-ink-3/70"> · {formatZoned(ms, viewer)}</span>}
    </time>
  );
}

export function OverviewHeading() {
  const { source, clock } = useDashboard();
  const network = useNetwork();
  const live = source.mode === "live";
  // Demo figures run on a fixed clock, but the label reads the real one, ticking each minute.
  const now = useMinuteClock();

  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
      <div>
        <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.02em] text-ink">Overview</h1>
        <p className="mt-1 text-[13px] text-ink-2">USDC settlements from AI agents, payment links and invoices.</p>
      </div>
      {/* Announced when live data refreshes; the demo clock ticking over each minute isn't news. */}
      <p className="inline-flex items-center gap-2 font-mono text-[11px] text-ink-3" aria-live={live ? "polite" : "off"}>
        <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", live ? "bg-success" : "bg-ink-3")} />
        {live ? (
          <span>
            Live · {network.label} · updated <Moment ms={clock.now} withDay={false} />
          </span>
        ) : (
          <span>
            Demo data{now !== null && (
              <>
                {" "}
                · as of <Moment ms={now} withDay />
              </>
            )}
          </span>
        )}
      </p>
    </div>
  );
}
