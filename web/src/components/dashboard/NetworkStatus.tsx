"use client";

import { useLiveSlot, type NetworkHealth } from "@/hooks/use-live-slot";
import { cn } from "@/lib/cn";
import { formatCount } from "@/lib/format";
import { useNetwork } from "@/lib/settings";

const HEALTH: Record<NetworkHealth, { dot: string; text: string }> = {
  connecting: { dot: "bg-ink-3", text: "Connecting" },
  live: { dot: "bg-success", text: "Live" },
  slow: { dot: "bg-warning", text: "Slow RPC" },
  offline: { dot: "bg-danger", text: "RPC unreachable" },
};

/**
 * Network pill with the current slot and RPC round-trip, polled from the configured endpoint.
 * `display` is the caller's call (e.g. "hidden md:inline-flex") so it never fights a default. With `onClick` it's a
 * button (the header's, which opens the developer console).
 */
export function NetworkStatus({ display = "inline-flex", className, onClick }: { display?: string; className?: string; onClick?: () => void }) {
  const network = useNetwork();
  const { slot, latencyMs, health } = useLiveSlot();
  const { dot, text } = HEALTH[health];
  const content = (
    <>
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", dot)} />
      <span className="whitespace-nowrap text-xs font-medium text-ink">{network.label}</span>
      <span className="sr-only">{text}</span>
      <span className="hidden h-3.5 w-px bg-line-strong xl:block" aria-hidden />
      <span className="hidden font-mono text-[11px] tabular-nums text-ink-2 xl:inline" aria-label="Current slot">
        {slot === null ? "slot —" : `#${formatCount(slot)}`}
      </span>
      <span className="hidden whitespace-nowrap font-mono text-[11px] tabular-nums text-ink-3 xl:inline">
        {latencyMs === null ? text : `${latencyMs}ms`}
      </span>
    </>
  );
  const base = cn(display, "h-8 items-center gap-2 rounded-lg border border-line bg-panel px-2.5", className);

  if (!onClick) {
    return (
      <div className={base} title={`${network.label} via ${network.endpoint}`}>
        {content}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-keyshortcuts="` ~"
      title={`${network.label} via ${network.endpoint}. Open the developer console (~)`}
      className={cn(base, "transition-colors hover:border-line-strong hover:bg-raised")}
    >
      {content}
    </button>
  );
}
