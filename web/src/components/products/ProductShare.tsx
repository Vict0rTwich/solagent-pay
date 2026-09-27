"use client";

import { Zap } from "lucide-react";

import { CopiedToast, CopyIcon } from "@/components/ui/CopiedToast";
import { useOrigin } from "@/hooks/use-checkout-link";
import { useCopy } from "@/hooks/use-copy";
import { dialToActionUrl, isPublicOrigin, productActionUrl, shareOnXUrl } from "@/lib/blink";
import { cn } from "@/lib/cn";
import { useDashboard } from "@/lib/dashboard-store";
import { NETWORKS } from "@/lib/network";
import { assetSymbol, formatAmount } from "@/lib/solana-pay";
import type { Product } from "@/lib/types";

/** The X logo, since lucide has none. */
function XMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="currentColor">
      <path d="M17.75 3h3.07l-6.7 7.66L22 21h-6.17l-4.83-6.32L5.47 21H2.4l7.17-8.2L2 3h6.33l4.37 5.77L17.75 3Zm-1.08 16.2h1.7L7.42 4.73H5.6l11.07 14.47Z" />
    </svg>
  );
}

/**
 * Where a product's Blink goes: a dial.to link (a buy card in any browser, and on X once the domain is registered
 * with Dialect), a post on X, or the raw `solana-action:` URI for wallets. Live data only: the payment server serves
 * the action and opens the orders.
 */
export function ProductShare({ product }: { product: Product }) {
  const { source } = useDashboard();
  const origin = useOrigin();
  const blink = useCopy();
  const uri = useCopy();
  const live = source.mode === "live";
  if (!origin) return null;

  const action = productActionUrl(origin, product.id);
  const link = dialToActionUrl(action, product.network);
  const price = `${formatAmount(product.amount)} ${assetSymbol(product.mint)}`;
  const reachable = isPublicOrigin(origin);
  const disabled = !live;

  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => void blink.copy(link)}
          disabled={disabled}
          className="btn-primary relative inline-flex h-9 items-center justify-center gap-2 rounded-lg px-3 text-[13px] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {blink.copied ? <CopyIcon copied className="size-3.5" /> : <Zap className="size-3.5" fill="currentColor" strokeWidth={1.5} aria-hidden />}
          {blink.copied ? "Blink link copied" : "Copy Blink link"}
          <CopiedToast show={blink.copied} label="dial.to link copied" />
        </button>
        {disabled ? (
          <span aria-disabled="true" className="btn-ghost inline-flex h-9 cursor-not-allowed items-center justify-center gap-2 rounded-lg px-3 text-[13px] font-medium opacity-50">
            <XMark className="size-3.5" />
            Post on X
          </span>
        ) : (
          <a
            href={shareOnXUrl(`${product.title}: ${price}, paid on Solana with a cNFT receipt.`, link)}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost inline-flex h-9 items-center justify-center gap-2 rounded-lg px-3 text-[13px] font-medium"
          >
            <XMark className="size-3.5" />
            Post on X
          </a>
        )}
      </div>
      <button
        type="button"
        onClick={() => void uri.copy(`solana-action:${action}`)}
        disabled={disabled}
        title="Copy the solana-action: URI, for wallets"
        className="relative mt-2 flex w-full min-w-0 items-center gap-2 rounded-lg border border-line bg-canvas px-2.5 py-2 text-left transition-colors hover:border-line-strong disabled:cursor-not-allowed disabled:opacity-50"
      >
        <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-2">solana-action:{action}</code>
        <CopyIcon copied={uri.copied} className={cn("size-3.5 shrink-0", uri.copied ? "text-success" : "text-accent-ink")} />
        <CopiedToast show={uri.copied} label="Action URI copied" />
      </button>
      <p className="mt-1.5 text-xs leading-relaxed text-ink-3">
        {!live
          ? "Blinks are served by the payment server: switch to live data in Settings to share this product."
          : reachable
            ? `Unfurls as a buy card in Phantom, on dial.to and in blinks on X. Each buyer gets their own order on ${NETWORKS[product.network].label}.`
            : `Blink clients fetch the action over the internet, so it unfurls once this dashboard runs on a public https URL (this is ${new URL(origin).host}).`}
      </p>
    </div>
  );
}
