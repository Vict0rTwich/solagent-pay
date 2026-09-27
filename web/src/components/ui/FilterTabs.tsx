"use client";

import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/cn";

export interface FilterOption<T extends string> {
  value: T;
  label: string;
  count?: number;
  icon?: LucideIcon;
}

/** Segmented-control look, shared with the other toggle groups (chart/table, status filters). */
export const segmentGroupClass = "inline-flex flex-wrap gap-0.5 rounded-lg border border-line bg-canvas p-0.5";

export function segmentClass(selected: boolean): string {
  return cn(
    "inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 text-xs transition-colors",
    selected ? "border-accent-line bg-accent-soft font-medium text-accent-ink" : "border-transparent text-ink-3 hover:text-ink-2",
  );
}

/** Single-select filter chips. Each chip is a toggle button so screen readers announce the pressed state. */
export function FilterTabs<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: {
  label: string;
  options: ReadonlyArray<FilterOption<T>>;
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cn(segmentGroupClass, className)}>
      {options.map((option) => {
        const Icon = option.icon;
        const selected = option.value === value;
        return (
          <button key={option.value} type="button" aria-pressed={selected} onClick={() => onChange(option.value)} className={segmentClass(selected)}>
            {Icon && <Icon className="size-3.5" aria-hidden />}
            {option.label}
            {option.count !== undefined && <span className="font-mono text-[11px] tabular-nums text-ink-3">{option.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
