"use client";

import { Globe } from "lucide-react";

import { cn } from "@/lib/cn";
import type { ProductInfo } from "@/lib/types";

import { ProductThumb } from "./ProductThumb";

/**
 * What the product's Blink looks like where it unfurls (X, Phantom, dial.to): the image, where it's served from, the
 * title and description the Action returns, and the Buy button. Built from the same fields the server sends.
 */
export function BlinkPreview({
  info,
  price,
  networkLabel,
  host,
  className,
}: {
  info: ProductInfo;
  /** "45.00 USDC", or null while the price isn't valid yet. */
  price: string | null;
  networkLabel: string;
  host: string;
  className?: string;
}) {
  const title = info.title || "Product title";
  return (
    <figure className={cn("flex flex-col", className)}>
      <div className="overflow-hidden rounded-xl border border-line-strong bg-canvas">
        <ProductThumb title={title} image={info.image} className="aspect-square w-full border-b text-5xl" />
        <div className="p-3.5">
          <p className="flex items-center gap-1 truncate text-[11px] text-ink-3">
            <Globe className="size-3 shrink-0" aria-hidden />
            {host || "your-shop.example"}
          </p>
          <p className={cn("mt-1.5 line-clamp-2 text-[15px] font-semibold leading-snug", info.title ? "text-ink" : "text-ink-3")}>{title}</p>
          {info.description && <p className="mt-1 line-clamp-3 whitespace-pre-line text-[12.5px] leading-relaxed text-ink-2">{info.description}</p>}
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-3">
            {price ?? "Price"} on {networkLabel}. Every purchase comes with a cNFT proof-of-purchase receipt.
          </p>
          <div
            aria-hidden
            className={cn(
              "mt-3 grid h-9 place-items-center rounded-lg text-[13px] font-medium",
              price ? "bg-accent text-accent-fg" : "border border-line bg-raised text-ink-3",
            )}
          >
            {price ? `Buy · ${price}` : "Buy"}
          </div>
        </div>
      </div>
      <figcaption className="mt-2 text-center text-[11px] text-ink-3">How the Blink unfurls on X, in Phantom and on dial.to</figcaption>
    </figure>
  );
}
