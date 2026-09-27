"use client";

import { Archive, LoaderCircle, PackagePlus, Share2, Store } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { toast } from "@/components/ui/Toaster";
import { useMerchantSession } from "@/hooks/use-merchant-session";
import { cn } from "@/lib/cn";
import { useDashboard } from "@/lib/dashboard-store";
import { formatCount } from "@/lib/format";
import { describeApiError } from "@/lib/invoice-api";
import { assetSymbol, formatAmount } from "@/lib/solana-pay";
import type { Product } from "@/lib/types";

import { ProductModal } from "./CreateProductModal";
import { ProductThumb } from "./ProductThumb";

const actionClass =
  "grid size-7 shrink-0 place-items-center rounded-md text-accent-ink/70 transition-colors hover:bg-accent-soft hover:text-accent-ink disabled:cursor-wait disabled:opacity-50";

/** The merchant's products on sale, each with its Blink, a PoS shortcut and what it has sold. */
export function ProductsSection({ onCreate }: { onCreate: () => void }) {
  const { products, productsLoaded, productsError, reloadProducts, invoices, source } = useDashboard();
  const { status, signIn } = useMerchantSession();
  const [sharing, setSharing] = useState<Product | null>(null);

  const sold = useMemo(() => {
    const counts = new Map<string, number>();
    for (const invoice of invoices) {
      if (invoice.productId && invoice.paidAt !== undefined) counts.set(invoice.productId, (counts.get(invoice.productId) ?? 0) + 1);
    }
    return counts;
  }, [invoices]);

  const waiting = source.mode === "live" && !productsLoaded;

  return (
    <section aria-labelledby="products-heading" className="card min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-5">
        <div>
          <h2 id="products-heading" className="flex items-baseline gap-2 text-sm font-medium text-ink">
            Products
            <span className="font-mono text-xs font-normal tabular-nums text-ink-3">{formatCount(products.length)}</span>
          </h2>
          <p className="mt-0.5 text-xs text-ink-3">Each product&rsquo;s Blink takes any number of orders; every buyer gets a cNFT receipt.</p>
        </div>
        <Link href="/dashboard/pos" className="btn-ghost inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium">
          <Store className="size-3.5" aria-hidden />
          Open PoS
        </Link>
      </div>

      <div className="border-t border-line p-3 sm:p-4">
        {waiting ? (
          <EmptyState
            text={
              productsError
                ? `Your products didn't load: ${productsError}`
                : status === "signed-in"
                  ? "Loading your products…"
                  : status === "signing-in"
                    ? "Waiting for your wallet's signature…"
                    : "Sign in with your merchant wallet to load your products."
            }
            action={
              productsError ? (
                <button type="button" onClick={() => void reloadProducts()} className="btn-primary h-8 rounded-lg px-3 text-[13px]">
                  Try again
                </button>
              ) : status === "signed-out" ? (
                <button type="button" onClick={() => void signIn().catch(() => {})} className="btn-primary h-8 rounded-lg px-3 text-[13px]">
                  Sign in
                </button>
              ) : null
            }
          />
        ) : products.length === 0 ? (
          <EmptyState
            text="No products yet. List one and share its Blink: buyers pay from X, their wallet or dial.to."
            action={
              <button type="button" onClick={onCreate} className="btn-primary inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px]">
                <PackagePlus className="size-3.5" aria-hidden />
                New product
              </button>
            }
          />
        ) : (
          <ul className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {products.map((product) => (
              <li key={product.id}>
                <ProductCard product={product} sold={sold.get(product.id) ?? 0} onShare={() => setSharing(product)} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <ProductModal product={sharing} onClose={() => setSharing(null)} />
    </section>
  );
}

function ProductCard({ product, sold, onShare }: { product: Product; sold: number; onShare: () => void }) {
  const { archiveProduct } = useDashboard();
  const [confirming, setConfirming] = useState(false);
  const [archiving, setArchiving] = useState(false);

  // "Archive?" asks once, then goes back to the icon if it isn't confirmed.
  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), 4_000);
    return () => clearTimeout(timer);
  }, [confirming]);

  const archive = async () => {
    setArchiving(true);
    try {
      await archiveProduct(product);
      toast(`Archived ${product.title}`);
    } catch (failure) {
      toast(describeApiError(failure), "error");
      setArchiving(false);
      setConfirming(false);
    }
  };

  return (
    <article className="group flex h-full items-start gap-3 rounded-lg border border-line bg-canvas p-3 transition-colors hover:border-line-strong">
      <ProductThumb title={product.title} image={product.image} className="size-14 rounded-md border text-base" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-ink" title={product.title}>
          {product.title}
        </p>
        <p className="mt-0.5 font-mono text-xs tabular-nums text-ink-2">
          {formatAmount(product.amount)} <span className="text-ink-3">{assetSymbol(product.mint)}</span>
        </p>
        <p className="mt-1 truncate text-[11px] text-ink-3">
          <span className={cn("font-mono tabular-nums", sold > 0 && "text-success")}>{formatCount(sold)}</span> sold
          <span className="mx-1 text-line-strong">·</span>
          <span className="font-mono">{product.id}</span>
        </p>
      </div>
      <div className="-mr-1 flex shrink-0 flex-col items-end gap-0.5">
        <button type="button" onClick={onShare} aria-label={`Share the Blink for ${product.title}`} title="Share Blink" className={actionClass}>
          <Share2 className="size-3.5" aria-hidden />
        </button>
        <Link
          href={`/dashboard/pos?product=${encodeURIComponent(product.id)}`}
          aria-label={`Charge ${product.title} at the PoS`}
          title="Charge at the PoS"
          className={actionClass}
        >
          <Store className="size-3.5" aria-hidden />
        </Link>
        {confirming ? (
          <button
            type="button"
            onClick={() => void archive()}
            disabled={archiving}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-danger-line bg-danger-bg px-2 text-[11px] font-medium text-danger disabled:cursor-wait"
          >
            {archiving && <LoaderCircle className="size-3 animate-spin" aria-hidden />}
            Archive?
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            aria-label={`Archive ${product.title}`}
            title="Archive: take it off sale"
            className={cn(actionClass, "hover:bg-danger-bg hover:text-danger")}
          >
            <Archive className="size-3.5" aria-hidden />
          </button>
        )}
      </div>
    </article>
  );
}

function EmptyState({ text, action }: { text: string; action: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-8 text-center">
      <span className="grid size-10 place-items-center rounded-full border border-accent-line bg-accent-soft text-accent-ink">
        <PackagePlus className="size-4" aria-hidden />
      </span>
      <p className="max-w-md text-[13px] text-ink-2">{text}</p>
      {action}
    </div>
  );
}
