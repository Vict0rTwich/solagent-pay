import { cn } from "@/lib/cn";

/**
 * A money figure in the ledger style: mono and tabular, with the fractional part a step dimmer so the whole
 * number reads first and live updates don't shift the layout. `value` comes pre-formatted: "$7,711.50", "0.75".
 */
export function Figure({ value, className, fractionClassName }: { value: string; className?: string; fractionClassName?: string }) {
  const dot = value.lastIndexOf(".");
  const whole = dot === -1 ? value : value.slice(0, dot);
  const fraction = dot === -1 ? "" : value.slice(dot);
  return (
    <span className={cn("font-mono tabular-nums", className)}>
      {whole}
      {/* cn doesn't merge conflicting utilities: the default dim color only applies when the caller sets none. */}
      {fraction && <span className={fractionClassName ?? "text-ink-3"}>{fraction}</span>}
    </span>
  );
}
