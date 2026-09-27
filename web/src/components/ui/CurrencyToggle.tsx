"use client";

import { useRef, type KeyboardEvent } from "react";

import { cn } from "@/lib/cn";
import { CURRENCIES, CURRENCY_CODES, type Currency } from "@/lib/currency";

import { segmentClass, segmentGroupClass } from "./FilterTabs";
import { TokenIcon } from "./TokenIcon";

/**
 * USDC | SOL segmented control: a radio group, so arrow keys move between the options and Tab leaves the group
 * from the selected one.
 */
export function CurrencyToggle({
  value,
  onChange,
  label = "Currency",
  disabled = false,
  className,
}: {
  value: Currency;
  onChange: (currency: Currency) => void;
  label?: string;
  disabled?: boolean;
  className?: string;
}) {
  const refs = useRef(new Map<Currency, HTMLButtonElement>());

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const index = CURRENCY_CODES.indexOf(value);
    const next = CURRENCY_CODES[(index + step + CURRENCY_CODES.length) % CURRENCY_CODES.length];
    if (!next) return;
    onChange(next);
    refs.current.get(next)?.focus();
  };

  return (
    <div role="radiogroup" aria-label={label} onKeyDown={onKeyDown} className={cn(segmentGroupClass, "shrink-0 flex-nowrap", className)}>
      {CURRENCY_CODES.map((code) => {
        const checked = code === value;
        return (
          <button
            key={code}
            ref={(node) => {
              if (node) refs.current.set(code, node);
              else refs.current.delete(code);
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(code)}
            title={`${code} (${CURRENCIES[code].kind})`}
            className={cn(segmentClass(checked), "h-6 px-2 font-mono text-[11px] disabled:cursor-not-allowed disabled:opacity-60")}
          >
            <TokenIcon currency={code} className="size-3.5" />
            {code}
          </button>
        );
      })}
    </div>
  );
}
