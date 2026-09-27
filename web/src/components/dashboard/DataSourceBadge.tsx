"use client";

import { AnimatePresence, motion } from "framer-motion";
import { CircleAlert, Database, LoaderCircle, RefreshCw } from "lucide-react";
import { useState } from "react";

import { useDismiss } from "@/hooks/use-dismiss";
import { cn } from "@/lib/cn";
import { useDashboard } from "@/lib/dashboard-store";
import { formatTime, truncateAddress } from "@/lib/format";
import { PROGRAM_ID } from "@/lib/network";
import { useNetwork, useSettings } from "@/lib/settings";

/** Header badge saying whether the dashboard shows live chain data or demo data, and why. */
export function DataSourceBadge() {
  const { source } = useDashboard();
  const network = useNetwork();
  const [settings, update] = useSettings();
  const [open, setOpen] = useState(false);
  const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false));

  const live = source.mode === "live";
  const loading = source.liveStatus === "loading";
  const label = live ? "Live" : loading ? "Loading" : "Demo";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Data source: ${live ? "live" : "demo"} data`}
        className={cn(
          "inline-flex h-8 items-center gap-2 rounded-lg border px-2.5 text-xs font-medium transition-colors",
          live && !source.stale
            ? "border-success-line bg-success-bg text-success hover:border-success"
            : "border-line bg-panel text-ink-2 hover:border-line-strong hover:text-ink",
        )}
      >
        {loading ? (
          <LoaderCircle className="size-3.5 animate-spin text-ink-3" aria-hidden />
        ) : (
          <span aria-hidden className={cn("size-1.5 rounded-full", live ? (source.stale ? "bg-warning" : "bg-success") : "bg-ink-3")} />
        )}
        <span className="hidden sm:inline">{label}</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-label="Data source"
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.14, ease: "easeOut" }}
            className="popover absolute right-0 top-full z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] p-4"
          >
            <p className="flex items-center gap-2 text-sm font-medium text-ink">
              <Database className="size-4 text-accent-ink" aria-hidden />
              {live ? `Live data · ${network.label}` : "Demo data"}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-ink-2">
              {live
                ? `USDC balance, transfers and agent wallets for ${truncateAddress(source.owner ?? "")}${
                    source.fetchedAt ? `, updated ${formatTime(source.fetchedAt)} UTC` : ""
                  }.`
                : `${source.reason ?? ""} Everything shown is seeded sample data.`}
            </p>

            {source.stale && source.reason && (
              <p className="mt-2 flex gap-1.5 text-xs text-warning">
                <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
                {source.reason} Showing the last data that loaded.
              </p>
            )}
            {live && !source.programDeployed && (
              <p className="mt-2 text-xs leading-relaxed text-ink-3">
                The SolAgent Pay program (<span className="font-mono">{truncateAddress(PROGRAM_ID)}</span>) isn&rsquo;t
                deployed on {network.label}, so there are no agent wallets to show yet.
              </p>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              {(live || source.liveStatus === "error") && (
                <button
                  type="button"
                  onClick={source.refresh}
                  className="btn-ghost inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs"
                >
                  <RefreshCw className="size-3.5" aria-hidden />
                  {live ? "Refresh now" : "Try again"}
                </button>
              )}
              {settings.dataSource === "auto" ? (
                // Only offered once live data is on screen or being attempted; without a wallet it's demo anyway.
                source.liveStatus !== "off" && (
                <button
                  type="button"
                  onClick={() => {
                    update({ dataSource: "demo" });
                    setOpen(false);
                  }}
                  className="btn-ghost h-8 rounded-md px-2.5 text-xs"
                >
                  Use demo data
                </button>
                )
              ) : (
                <button
                  type="button"
                  onClick={() => update({ dataSource: "auto" })}
                  className="btn-ghost h-8 rounded-md px-2.5 text-xs"
                >
                  Use live data
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
