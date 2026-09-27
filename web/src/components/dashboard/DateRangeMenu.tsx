"use client";

import { AnimatePresence, motion } from "framer-motion";
import { CalendarDays, Check, ChevronDown } from "lucide-react";
import { useState } from "react";

import { useDismiss } from "@/hooks/use-dismiss";
import { cn } from "@/lib/cn";
import { useDashboard } from "@/lib/dashboard-store";
import type { RangeDays } from "@/lib/types";

const OPTIONS: ReadonlyArray<{ value: RangeDays; label: string; short: string }> = [
  { value: 7, label: "Last 7 days", short: "7D" },
  { value: 30, label: "Last 30 days", short: "30D" },
  { value: 90, label: "Last 90 days", short: "90D" },
];

/** Date range for the chart and period-based stats. */
export function DateRangeMenu() {
  const { rangeDays, setRangeDays } = useDashboard();
  const [open, setOpen] = useState(false);
  const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false));
  const current = OPTIONS.find((o) => o.value === rangeDays) ?? OPTIONS[1]!;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Date range: ${current.label}`}
        className="inline-flex h-8 items-center gap-2 rounded-lg border border-line bg-panel px-2.5 text-xs font-medium text-ink transition-colors hover:border-line-strong"
      >
        <CalendarDays className="size-3.5 text-accent-ink" aria-hidden />
        <span className="hidden sm:inline">{current.label}</span>
        <span className="font-mono text-[11px] sm:hidden">{current.short}</span>
        <ChevronDown className="size-3.5 text-ink-3" aria-hidden />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.14, ease: "easeOut" }}
            className="popover absolute right-0 top-full z-50 mt-2 w-48 p-1"
          >
            {OPTIONS.map((option) => {
              const selected = option.value === rangeDays;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  onClick={() => {
                    setRangeDays(option.value);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex h-8 w-full items-center justify-between rounded-md px-2.5 text-[13px] transition-colors hover:bg-raised",
                    selected ? "font-medium text-ink" : "text-ink-2",
                  )}
                >
                  <span className="flex items-center gap-2.5">
                    <span className="w-7 font-mono text-[11px] text-ink-3">{option.short}</span>
                    {option.label}
                  </span>
                  {selected && <Check className="size-3.5 text-accent-ink" strokeWidth={2.5} aria-hidden />}
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
