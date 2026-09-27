"use client";

import { Delete } from "lucide-react";

import { cn } from "@/lib/cn";

export type KeypadKey = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "." | "back";

const KEYS: readonly KeypadKey[] = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "back"];

/** Most whole digits a counter sale takes: up to 9,999,999. */
const MAX_WHOLE_DIGITS = 7;

/**
 * The typed amount after one key press, as the keypad builds it: no leading zeros, one decimal point, and no more
 * decimals than the currency takes at the counter.
 */
export function pressKey(entry: string, key: KeypadKey, decimals: number): string {
  if (key === "back") return entry.slice(0, -1);
  const [whole = "", fraction] = entry.split(".");
  if (key === ".") return decimals === 0 || fraction !== undefined ? entry : `${whole || "0"}.`;
  if (fraction !== undefined) return fraction.length >= decimals ? entry : entry + key;
  if (whole === "0") return key;
  return whole.length >= MAX_WHOLE_DIGITS ? entry : entry + key;
}

/** Drops decimals past `decimals`, e.g. after switching from SOL to USDC. */
export function trimDecimals(entry: string, decimals: number): string {
  const [whole = "", fraction] = entry.split(".");
  if (fraction === undefined) return entry;
  return decimals === 0 ? whole : `${whole}.${fraction.slice(0, decimals)}`;
}

/** Big touch keys for the counter: 1–9, decimal point, 0 and backspace. Typing on a keyboard works too. */
export function Keypad({ onKey, disabled = false, className }: { onKey: (key: KeypadKey) => void; disabled?: boolean; className?: string }) {
  return (
    <div role="group" aria-label="Keypad" className={cn("grid grid-cols-3 gap-2 sm:gap-2.5", className)}>
      {KEYS.map((key) => (
        <button
          key={key}
          type="button"
          onClick={() => onKey(key)}
          disabled={disabled}
          aria-label={key === "back" ? "Delete last digit" : key === "." ? "Decimal point" : key}
          className={cn(
            "grid h-14 place-items-center rounded-xl border border-line bg-panel font-mono text-[26px] text-ink transition-colors select-none sm:h-16",
            "hover:border-line-strong active:bg-raised disabled:opacity-40",
            key === "back" && "text-ink-2",
          )}
        >
          {key === "back" ? <Delete className="size-6" strokeWidth={1.75} aria-hidden /> : key}
        </button>
      ))}
    </div>
  );
}
