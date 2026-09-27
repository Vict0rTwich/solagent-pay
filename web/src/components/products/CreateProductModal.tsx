"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { CircleAlert, CircleCheck, LoaderCircle, Store, Zap } from "lucide-react";
import Link from "next/link";
import { useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";

import { WalletButton } from "@/components/dashboard/WalletButton";
import { CurrencyToggle } from "@/components/ui/CurrencyToggle";
import { Modal } from "@/components/ui/Modal";
import { TokenIcon } from "@/components/ui/TokenIcon";
import { useOrigin } from "@/hooks/use-checkout-link";
import { CURRENCIES, parseAmount, type Currency } from "@/lib/currency";
import { useDashboard } from "@/lib/dashboard-store";
import { DEMO_MERCHANT } from "@/lib/demo-data";
import { truncateAddress } from "@/lib/format";
import { describeApiError } from "@/lib/invoice-api";
import { PRODUCT_DESCRIPTION_MAX, PRODUCT_TITLE_MAX, parseImageUrl, parseProductInfo } from "@/lib/products";
import { useNetwork } from "@/lib/settings";
import { assetSymbol, formatAmount } from "@/lib/solana-pay";
import type { Product, ProductInfo } from "@/lib/types";

import { BlinkPreview } from "./BlinkPreview";
import { ProductShare } from "./ProductShare";

/**
 * Lists a product for sale: title, description, price and image. Its Blink then takes any number of orders, each
 * settled on its own and receipted with a cNFT. The preview beside the form is the card buyers will see.
 */
export function CreateProductModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const titleRef = useRef<HTMLInputElement>(null);
  const [created, setCreated] = useState<Product | null>(null);
  // Every way out (Done, ×, Escape) resets the modal for the next product.
  const close = () => {
    setCreated(null);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      wide
      title={created ? "Your product is on sale" : "New product"}
      description={
        created
          ? "Share its Blink anywhere. Every buyer gets their own order, settled on-chain, and a cNFT receipt."
          : "List something to sell. Its Blink unfurls as a buy card on X, in wallets and on dial.to."
      }
      initialFocus={titleRef}
    >
      {created ? <ProductLive product={created} created onDone={close} /> : <CreateProductForm titleRef={titleRef} onCreated={setCreated} onCancel={close} />}
    </Modal>
  );
}

/** An existing product's Blink, share links and PoS shortcut. */
export function ProductModal({ product, onClose }: { product: Product | null; onClose: () => void }) {
  return (
    <Modal
      open={product !== null}
      onClose={onClose}
      wide
      title={product ? product.title : "Product"}
      description="Share its Blink anywhere. Every buyer gets their own order, settled on-chain, and a cNFT receipt."
    >
      {product && <ProductLive product={product} created={false} onDone={onClose} />}
    </Modal>
  );
}

type Field = keyof ProductInfo | "amount";

function CreateProductForm({
  titleRef,
  onCreated,
  onCancel,
}: {
  titleRef: RefObject<HTMLInputElement | null>;
  onCreated: (product: Product) => void;
  onCancel: () => void;
}) {
  const { publicKey } = useWallet();
  const network = useNetwork();
  const origin = useOrigin();
  const { createProduct, source } = useDashboard();
  // Sample data works without a wallet: its products pay the demo merchant, and nothing is sold for real.
  const merchant = publicKey?.toBase58() ?? (source.mode === "demo" ? DEMO_MERCHANT : null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<Currency>("USDC");
  const [image, setImage] = useState("");
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const clearError = (field: Field) => setErrors((current) => ({ ...current, [field]: undefined }));

  // The preview follows the form as it's typed; an image link that isn't valid yet just isn't shown.
  const previewImage = parseImageUrl(image);
  const previewPrice = parseAmount(amount, currency);
  const preview: ProductInfo = { title: title.trim(), description: description.trim(), image: previewImage.ok ? previewImage.image : null };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setFailure(null);
    const info = parseProductInfo({ title, description, image });
    const price = parseAmount(amount, currency);
    const next: Partial<Record<Field, string>> = {};
    if (!info.ok) next[info.field] = info.error;
    if (!price.ok) next.amount = price.error;
    setErrors(next);
    if (!info.ok || !price.ok || !merchant) return;

    setSubmitting(true);
    try {
      onCreated(await createProduct({ ...info.info, currency, amount: price.amount, merchant }));
    } catch (createError) {
      setFailure(describeApiError(createError));
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass =
    "mt-2 w-full rounded-lg border border-line bg-canvas px-3 text-ink outline-none transition-colors placeholder:text-ink-3 hover:border-line-strong focus:border-accent focus-visible:outline-none aria-[invalid=true]:border-danger-line";

  return (
    <form onSubmit={(event) => void submit(event)} noValidate className="mt-6 grid gap-6 md:grid-cols-[minmax(0,1fr)_264px]">
      <div className="min-w-0 space-y-5">
        <FormField id="product-title" label="Product title" error={errors.title} hint="The card's headline, and the name on each buyer's receipt." counter={`${title.length}/${PRODUCT_TITLE_MAX}`}>
          <input
            ref={titleRef}
            id="product-title"
            maxLength={PRODUCT_TITLE_MAX}
            autoComplete="off"
            placeholder="Solana Hacker Hoodie"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              clearError("title");
            }}
            aria-invalid={Boolean(errors.title)}
            aria-describedby={errors.title ? "product-title-error" : "product-title-hint"}
            className={`${inputClass} h-10 text-[13px]`}
          />
        </FormField>

        <FormField
          id="product-description"
          label="Description"
          optional
          error={errors.description}
          hint="What buyers read under the title."
          counter={`${description.length}/${PRODUCT_DESCRIPTION_MAX}`}
        >
          <textarea
            id="product-description"
            maxLength={PRODUCT_DESCRIPTION_MAX}
            rows={3}
            placeholder="Heavyweight cotton fleece, edition 001"
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              clearError("description");
            }}
            aria-invalid={Boolean(errors.description)}
            aria-describedby={errors.description ? "product-description-error" : "product-description-hint"}
            className={`${inputClass} resize-none py-2.5 text-[13px] leading-relaxed`}
          />
        </FormField>

        <div>
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="product-amount" className="text-xs font-medium text-ink-2">
              Price
            </label>
            <CurrencyToggle
              value={currency}
              onChange={(next) => {
                setCurrency(next);
                clearError("amount");
              }}
              label="Product currency"
            />
          </div>
          <div className="relative">
            <input
              id="product-amount"
              inputMode="decimal"
              autoComplete="off"
              placeholder={currency === "SOL" ? "0.000" : "0.00"}
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                clearError("amount");
              }}
              aria-invalid={Boolean(errors.amount)}
              aria-describedby={errors.amount ? "product-amount-error" : "product-amount-hint"}
              className={`${inputClass} h-10 pr-20 font-mono text-[15px] tabular-nums`}
            />
            <span className="pointer-events-none absolute right-3 top-1/2 mt-1 flex -translate-y-1/2 items-center gap-1.5 font-mono text-xs text-ink-3">
              <TokenIcon currency={currency} className="size-3.5" />
              {currency}
            </span>
          </div>
          {errors.amount ? (
            <FieldError id="product-amount-error" message={errors.amount} />
          ) : (
            <p id="product-amount-hint" className="mt-1.5 text-xs text-ink-3">
              {currency === "SOL" ? `Native SOL, down to ${CURRENCIES.SOL.min} SOL.` : `USDC (SPL token), to the cent. Minimum ${CURRENCIES.USDC.min}.`}
            </p>
          )}
        </div>

        <FormField id="product-image" label="Image link" optional error={errors.image} hint="A direct https link to a square image: the Blink card and the cNFT receipt show it.">
          <input
            id="product-image"
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://…/hoodie.png"
            value={image}
            onChange={(e) => {
              setImage(e.target.value);
              clearError("image");
            }}
            aria-invalid={Boolean(errors.image)}
            aria-describedby={errors.image ? "product-image-error" : "product-image-hint"}
            className={`${inputClass} h-10 font-mono text-[12px]`}
          />
        </FormField>

        <div className="rounded-lg border border-line bg-canvas px-3 py-2.5 text-xs text-ink-3">
          {merchant ? (
            <>
              Sales pay <span className="font-mono text-ink-2">{truncateAddress(merchant)}</span>
              {publicKey ? "" : " (the sample merchant)"} in {currency} on {network.label}
            </>
          ) : (
            "Connect the wallet that should receive this product's sales."
          )}
        </div>

        {failure && <FieldError id="product-create-error" message={failure} />}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" onClick={onCancel} className="btn-ghost h-9 rounded-lg px-4 text-[13px]">
            Cancel
          </button>
          {merchant ? (
            <button
              type="submit"
              disabled={submitting}
              className="btn-primary inline-flex h-9 items-center justify-center gap-2 rounded-lg px-4 text-[13px] disabled:cursor-wait disabled:opacity-70"
            >
              {submitting ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Zap className="size-4" fill="currentColor" strokeWidth={1.5} aria-hidden />}
              {submitting ? "Creating…" : "Create product & Blink"}
            </button>
          ) : (
            <WalletButton align="end" side="top" label="Connect wallet to create" />
          )}
        </div>
      </div>

      <BlinkPreview
        info={preview}
        price={previewPrice.ok ? `${formatAmount(previewPrice.amount)} ${currency}` : null}
        networkLabel={network.label}
        host={origin ? new URL(origin).host : ""}
        className="order-first md:order-none"
      />
    </form>
  );
}

function ProductLive({ product, created, onDone }: { product: Product; created: boolean; onDone: () => void }) {
  const network = useNetwork();
  const origin = useOrigin();
  const price = `${formatAmount(product.amount)} ${assetSymbol(product.mint)}`;

  return (
    <div className="mt-6 grid gap-6 md:grid-cols-[minmax(0,1fr)_264px]">
      <div className="flex min-w-0 flex-col">
        <div className="rounded-lg border border-line bg-canvas p-4">
          {created ? (
            <p className="inline-flex items-center gap-1.5 text-xs text-success">
              <CircleCheck className="size-3.5" aria-hidden />
              Product created
            </p>
          ) : (
            <p className="eyebrow">On sale</p>
          )}
          <p className="mt-2.5 text-[15px] font-semibold text-ink">{product.title}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-2">
            <span className="inline-flex items-center gap-1.5 font-mono tabular-nums text-ink">
              <TokenIcon currency={product.mint === null ? "SOL" : "USDC"} className="size-3.5" />
              {price}
            </span>
            <span className="font-mono text-[11px] text-ink-3">{product.id}</span>
          </p>
        </div>

        <p className="eyebrow mt-5">Share its Blink</p>
        <div className="mt-2">
          <ProductShare product={product} />
        </div>

        <p className="eyebrow mt-5">Sell in person</p>
        <Link
          href={`/dashboard/pos?product=${encodeURIComponent(product.id)}`}
          className="btn-ghost mt-2 inline-flex h-9 items-center justify-center gap-2 rounded-lg px-3 text-[13px] font-medium"
        >
          <Store className="size-3.5" aria-hidden />
          Charge it at the counter (PoS)
        </Link>

        <button type="button" onClick={onDone} className="btn-primary mt-auto h-9 self-end rounded-lg px-4 text-[13px] md:mt-6">
          Done
        </button>
      </div>

      <BlinkPreview info={product} price={price} networkLabel={network.label} host={origin ? new URL(origin).host : ""} className="order-first md:order-none" />
    </div>
  );
}

function FormField({
  id,
  label,
  optional = false,
  error,
  hint,
  counter,
  children,
}: {
  id: string;
  label: string;
  optional?: boolean;
  error?: string;
  hint: string;
  counter?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-xs font-medium text-ink-2">
          {label} {optional && <span className="font-normal text-ink-3">(optional)</span>}
        </label>
        {counter && <span className="font-mono text-[11px] text-ink-3">{counter}</span>}
      </div>
      {children}
      {error ? (
        <FieldError id={`${id}-error`} message={error} />
      ) : (
        <p id={`${id}-hint`} className="mt-1.5 text-xs text-ink-3">
          {hint}
        </p>
      )}
    </div>
  );
}

function FieldError({ id, message }: { id: string; message: string }) {
  return (
    <p id={id} role="alert" className="mt-1.5 flex gap-1.5 text-xs text-danger">
      <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
      {message}
    </p>
  );
}
