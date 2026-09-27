import { cn } from "@/lib/cn";
import type { Currency } from "@/lib/currency";

/**
 * Round token mark: USDC's blue dollar coin, or SOL's three bars in the monochrome version of the mark. Nothing for
 * a token it doesn't know. Decorative; say the ticker in text beside it.
 */
export function TokenIcon({ currency, className }: { currency: Currency | null; className?: string }) {
  if (currency === null) return null;
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("size-4 shrink-0", className)}>
      {currency === "USDC" ? (
        <>
          <circle cx="16" cy="16" r="16" fill="#2775CA" />
          <circle cx="16" cy="16" r="11.5" fill="none" stroke="#fff" strokeOpacity="0.35" strokeWidth="1.4" />
          <text x="16" y="21.6" textAnchor="middle" fontSize="15.5" fontWeight="700" fill="#fff" fontFamily="ui-sans-serif, system-ui, sans-serif">
            $
          </text>
        </>
      ) : (
        <>
          <circle cx="16" cy="16" r="16" fill="#1a2540" />
          <g fill="#f4f4f5">
            <path d="M10 9.4h14.6l-2.6 2.9H7.4z" />
            <path d="M7.4 14.55H22l2.6 2.9H10z" />
            <path d="M10 19.7h14.6l-2.6 2.9H7.4z" />
          </g>
        </>
      )}
    </svg>
  );
}
