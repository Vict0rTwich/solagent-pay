"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { ArrowLeft, Ban, CircleAlert, Grid2x2, LoaderCircle, Maximize2, Minimize2, PackagePlus, ShoppingBag, Volume2, VolumeX, Zap } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { WalletButton } from "@/components/dashboard/WalletButton";
import { ProductThumb } from "@/components/products/ProductThumb";
import { CurrencyToggle } from "@/components/ui/CurrencyToggle";
import { toast } from "@/components/ui/Toaster";
import { useCelebrate } from "@/hooks/use-celebrate";
import { useEngineStream } from "@/hooks/use-engine-stream";
import { useMerchantSession } from "@/hooks/use-merchant-session";
import { useNow } from "@/hooks/use-now";
import { randomBase58 } from "@/lib/base58";
import { cn } from "@/lib/cn";
import { parseAmount, type Currency } from "@/lib/currency";
import { useDashboard } from "@/lib/dashboard-store";
import { DEMO_MERCHANT } from "@/lib/demo-data";
import { describeApiError } from "@/lib/invoice-api";
import { invoiceStatus } from "@/lib/metrics";
import { useNetwork, useSettings } from "@/lib/settings";
import { assetSymbol, formatAmount } from "@/lib/solana-pay";
import type { Invoice, Product } from "@/lib/types";

import { Keypad, pressKey, trimDecimals, type KeypadKey } from "./Keypad";
import { TillSlip, type SlipView } from "./TillSlip";

/** How long the paid slip stays up before the register clears for the next sale. */
const RESET_MS = 3_000;
/** Decimals the keypad takes: cents for USDC; SOL stops at 4, plenty at a counter. */
const KEYPAD_DECIMALS: Record<Currency, number> = { USDC: 2, SOL: 4 };
const NOTE_MAX = 60;

type Tab = "keypad" | "products";

const tabClass = (selected: boolean) =>
  cn(
    "inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-[13px] transition-colors",
    selected ? "border-accent-line bg-accent-soft font-medium text-accent-ink" : "border-transparent text-ink-3 hover:text-ink-2",
  );

const iconButton =
  "grid size-8 shrink-0 place-items-center rounded-lg border border-line text-ink-2 transition-colors hover:border-line-strong hover:bg-raised hover:text-ink";

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

/**
 * The fullscreen register for a shop counter: key in an amount (or tap a product), and the customer display prints a
 * slip with the Solana Pay QR code. The payment server watches the chain; the moment the sale settles, the slip is
 * stamped paid, the chime plays, and the register clears itself for the next customer.
 */
export function PosRegister() {
  const highlight = useSearchParams().get("product");
  const { publicKey } = useWallet();
  const network = useNetwork();
  const [settings, updateSettings] = useSettings();
  const { status: sessionStatus, signIn } = useMerchantSession();
  const {
    source,
    clock,
    invoices,
    products,
    productsLoaded,
    productsError,
    reloadProducts,
    createInvoice,
    createProductOrder,
    cancelInvoice,
    updateInvoice,
    syncInvoices,
  } = useDashboard();
  const live = source.mode === "live";
  const now = useNow(1_000);
  const celebrateNow = useCelebrate();
  const stream = useEngineStream(live && sessionStatus === "signed-in");

  const [tab, setTab] = useState<Tab>(highlight ? "products" : "keypad");
  const [currency, setCurrency] = useState<Currency>("USDC");
  const [entry, setEntry] = useState("");
  const [note, setNote] = useState("");
  const [opened, setOpened] = useState<Invoice | null>(null);
  const [creating, setCreating] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The store's copy is current: the payment server settles it and the dashboard syncs it every few seconds.
  const charge = opened ? (invoices.find((inv) => inv.reference === opened.reference) ?? opened) : null;
  const status = charge ? invoiceStatus(charge, live ? now : clock.now) : null;
  // Sample data works without a wallet: its charges pay the demo merchant, and nothing is watched.
  const recipient = publicKey?.toBase58() ?? (live ? null : DEMO_MERCHANT);
  const parsed = parseAmount(entry, currency);

  const reset = useCallback(() => {
    setOpened(null);
    setEntry("");
    setNote("");
    setError(null);
  }, []);

  // This charge in the engine's live log: a transaction carrying its reference (the customer's wallet sent it), and
  // the settlement, which is fetched at once rather than at the next sync.
  const events = charge ? stream.events.filter((event) => event.reference === charge.reference) : [];
  const detected = events.some((event) => event.type === "TX_DETECTED" && !event.data.failed);
  const settledEvent = events.find((event) => event.type === "STATUS_UPDATED")?.id;
  useEffect(() => {
    if (settledEvent) syncInvoices();
  }, [settledEvent, syncInvoices]);

  // Paid: confetti and the chime, then a clean register.
  const paidReference = status === "paid" ? charge?.reference : undefined;
  useEffect(() => {
    if (!paidReference) return;
    celebrateNow(paidReference);
    const timer = setTimeout(reset, RESET_MS);
    return () => clearTimeout(timer);
  }, [paidReference, celebrateNow, reset]);

  const begin = async (make: () => Promise<Invoice>) => {
    if (creating || charge) return;
    setCreating(true);
    setError(null);
    try {
      setOpened(await make());
    } catch (failure) {
      setError(describeApiError(failure));
    } finally {
      setCreating(false);
    }
  };

  const chargeAmount = () => {
    if (!parsed.ok) {
      setError(entry ? parsed.error : "Key in the amount to charge.");
      return;
    }
    if (!recipient) {
      setError("Connect the wallet that receives the payment.");
      return;
    }
    const memo = note.trim() || "Counter sale";
    void begin(() => createInvoice({ kind: "link", currency, amount: parsed.amount, memo, client: "", recipient }));
  };

  const chargeProduct = (product: Product) => void begin(() => createProductOrder(product));

  const press = (key: KeypadKey) => {
    setEntry((current) => pressKey(current, key, KEYPAD_DECIMALS[currency]));
    setError(null);
  };

  const switchCurrency = (next: Currency) => {
    setCurrency(next);
    setEntry((current) => trimDecimals(current, KEYPAD_DECIMALS[next]));
    setError(null);
  };

  const cancel = async () => {
    if (!charge) return;
    setCanceling(true);
    try {
      await cancelInvoice(charge);
      reset();
    } catch (failure) {
      // Usually "already paid": the next sync shows it.
      toast(describeApiError(failure), "error");
      syncInvoices();
    } finally {
      setCanceling(false);
    }
  };

  /** Sample data only: marks the charge paid, as a scan would, so the whole flow can be tried without a wallet. */
  const simulate = () => {
    if (!charge) return;
    const payer = randomBase58(32);
    const at = Date.now();
    updateInvoice(charge, {
      paidAt: at,
      signature: randomBase58(64),
      payer,
      receipt: { status: "simulated", owner: payer, mintAddress: null, mintedAt: at, note: "Sample data: no cNFT was minted." },
    });
  };

  // Typing works like the keypad: digits, the decimal point, Backspace; Enter charges and Escape clears.
  useEffect(() => {
    if (tab !== "keypad" || charge) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return;
      const key: KeypadKey | null = /^[0-9]$/.test(event.key)
        ? (event.key as KeypadKey)
        : event.key === "." || event.key === ","
          ? "."
          : event.key === "Backspace"
            ? "back"
            : null;
      if (key) {
        event.preventDefault();
        press(key);
      } else if (event.key === "Enter" && !(event.target instanceof HTMLButtonElement)) {
        event.preventDefault();
        chargeAmount();
      } else if (event.key === "Escape") {
        setEntry("");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const socket = stream.sockets[network.id];
  const watchNote = !live
    ? "Sample data: nothing is watched on-chain. Use Simulate payment to try the flow."
    : socket === "open"
      ? `The payment server is watching ${network.label} over a live websocket.`
      : `The payment server is checking ${network.label} every few seconds.`;

  const view: SlipView = !charge
    ? { kind: "idle", preview: tab === "keypad" && entry ? { amount: parsed.ok ? formatAmount(parsed.amount) : entry, symbol: currency } : null }
    : status === "paid"
      ? { kind: "paid", invoice: charge, resetMs: RESET_MS }
      : status === "pending"
        ? { kind: "charging", invoice: charge, detected, note: watchNote, expiresIn: live ? charge.expiresAt - now : null }
        : { kind: "closed", invoice: charge, status: status === "canceled" ? "canceled" : "expired" };

  const busy = Boolean(charge) || creating;

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b border-line bg-canvas px-3 sm:gap-3 sm:px-5">
        <Link
          href="/dashboard"
          className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[13px] text-ink-2 transition-colors hover:bg-raised hover:text-ink"
        >
          <ArrowLeft className="size-4" aria-hidden />
          <span className="hidden sm:inline">Dashboard</span>
        </Link>
        <span aria-hidden className="h-5 w-px bg-line" />
        <h1 className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.02em] text-ink">
          <span aria-hidden className="grid size-6 place-items-center rounded-md bg-accent text-accent-fg">
            <Zap className="size-3.5" fill="currentColor" strokeWidth={1.5} />
          </span>
          Point of sale
        </h1>
        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <ConnectionChip live={live} socket={socket} networkLabel={network.shortLabel} />
          <button
            type="button"
            onClick={() => updateSettings({ sounds: !settings.sounds })}
            aria-pressed={settings.sounds}
            aria-label="Payment chime"
            title={settings.sounds ? "Chime on" : "Chime off"}
            className={iconButton}
          >
            {settings.sounds ? <Volume2 className="size-4" aria-hidden /> : <VolumeX className="size-4" aria-hidden />}
          </button>
          <FullscreenButton />
          <WalletButton compact collapseLabel />
        </div>
      </header>

      <div className="grid flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(440px,0.85fr)]">
        <section aria-label="New sale" className={cn("flex-col px-4 py-5 sm:px-8 sm:py-7", charge ? "hidden lg:flex" : "flex")}>
          <div className="mx-auto flex w-full max-w-[520px] flex-1 flex-col">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div role="tablist" aria-label="Charge by" className="inline-flex gap-0.5 rounded-lg border border-line bg-panel p-0.5">
                <button type="button" role="tab" aria-selected={tab === "keypad"} onClick={() => setTab("keypad")} className={tabClass(tab === "keypad")}>
                  <Grid2x2 className="size-3.5" aria-hidden />
                  Keypad
                </button>
                <button type="button" role="tab" aria-selected={tab === "products"} onClick={() => setTab("products")} className={tabClass(tab === "products")}>
                  <ShoppingBag className="size-3.5" aria-hidden />
                  Products
                  <span className="font-mono text-[11px] tabular-nums text-ink-3">{products.length}</span>
                </button>
              </div>
              {tab === "keypad" && <CurrencyToggle value={currency} onChange={switchCurrency} label="Charge in" disabled={busy} />}
            </div>

            {tab === "keypad" ? (
              <>
                <div className="mt-6 flex flex-1 flex-col justify-end sm:mt-8">
                  <div className="flex items-center justify-between">
                    <p className="eyebrow">Amount</p>
                    {entry && !busy && (
                      <button type="button" onClick={() => setEntry("")} className="text-xs text-ink-3 transition-colors hover:text-ink">
                        Clear
                      </button>
                    )}
                  </div>
                  <AmountDisplay entry={entry} currency={currency} />
                  <label htmlFor="pos-note" className="sr-only">
                    What the sale is for (optional)
                  </label>
                  <input
                    id="pos-note"
                    value={note}
                    maxLength={NOTE_MAX}
                    autoComplete="off"
                    disabled={busy}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="What's it for? (optional, shown in the customer's wallet)"
                    className="mt-4 h-10 w-full rounded-lg border border-line bg-panel px-3 text-[13px] text-ink outline-none transition-colors placeholder:text-ink-3 hover:border-line-strong focus:border-accent disabled:opacity-60"
                  />
                </div>
                <Keypad onKey={press} disabled={busy} className="mt-4" />
                <button
                  type="button"
                  onClick={chargeAmount}
                  disabled={busy}
                  className="btn-primary mt-3 inline-flex h-14 w-full items-center justify-center gap-2 rounded-xl text-base disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {creating ? <LoaderCircle className="size-5 animate-spin" aria-hidden /> : <Zap className="size-5" fill="currentColor" strokeWidth={1.5} aria-hidden />}
                  {creating ? "Creating charge…" : parsed.ok ? `Charge ${formatAmount(parsed.amount)} ${currency}` : "Charge"}
                </button>
              </>
            ) : (
              <ProductGrid
                products={products}
                waiting={
                  !live || productsLoaded
                    ? null
                    : productsError
                      ? { text: `Your products didn't load: ${productsError}`, action: { label: "Try again", run: () => void reloadProducts() } }
                      : sessionStatus === "signed-in"
                        ? { text: "Loading your products…", action: null }
                        : sessionStatus === "signing-in"
                          ? { text: "Waiting for your wallet's signature…", action: null }
                          : { text: "Sign in with your merchant wallet to load your products.", action: { label: "Sign in", run: () => void signIn().catch(() => {}) } }
                }
                highlight={highlight}
                disabled={busy}
                onCharge={chargeProduct}
              />
            )}

            {error && (
              <p role="alert" className="mt-3 flex gap-1.5 text-[13px] text-danger">
                <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                {error}
              </p>
            )}
          </div>
        </section>

        {/* Always dark, like a customer-facing screen, whichever theme the dashboard uses: the white slip reads best on it.
            Pinned to the viewport on wide screens, so a long product list never scrolls the slip out of the customer's view. */}
        <section
          data-theme="dark"
          aria-label="Customer display"
          className={cn(
            "flex-col items-center justify-center gap-3 bg-console px-4 py-5 sm:px-8 lg:sticky lg:top-14 lg:h-[calc(100dvh-3.5rem)] lg:self-start lg:overflow-y-auto lg:border-l lg:border-line",
            charge ? "flex" : "hidden lg:flex",
          )}
        >
          <TillSlip view={view} networkLabel={network.label} />

          <div className="flex w-full max-w-[360px] gap-2">
            {status === "pending" && (
              <>
                <button
                  type="button"
                  onClick={() => void cancel()}
                  disabled={canceling}
                  className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-line-strong text-[13px] text-ink-2 transition-colors hover:border-danger-line hover:bg-danger-bg hover:text-danger disabled:cursor-wait disabled:opacity-60"
                >
                  {canceling ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Ban className="size-4" aria-hidden />}
                  {canceling ? "Canceling…" : "Cancel charge"}
                </button>
                {!live && (
                  <button type="button" onClick={simulate} className="btn-ghost h-11 flex-1 rounded-xl text-[13px] font-medium">
                    Simulate payment
                  </button>
                )}
              </>
            )}
            {status === "paid" && (
              <button type="button" onClick={reset} className="btn-ghost h-11 flex-1 rounded-xl text-[13px] font-medium">
                Next sale now
              </button>
            )}
            {(status === "expired" || status === "canceled") && (
              <button type="button" onClick={reset} className="btn-primary h-11 flex-1 rounded-xl text-[13px]">
                New sale
              </button>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

/** The typed amount, large: grouped whole digits, and for USDC the cents still to come shown faintly. */
function AmountDisplay({ entry, currency }: { entry: string; currency: Currency }) {
  const [whole = "", fraction] = entry.split(".");
  const grouped = whole ? Number(whole).toLocaleString("en-US") : "0";
  const ghost = currency === "USDC" ? (fraction === undefined ? ".00" : "0".repeat(Math.max(0, 2 - fraction.length))) : "";
  return (
    <p className="mt-2 flex items-baseline justify-end gap-2 overflow-hidden text-right font-mono tabular-nums leading-none tracking-[-0.04em]">
      <span className="min-w-0 truncate text-[52px] sm:text-[64px]">
        <span className={entry ? "text-ink" : "text-ink-3"}>{grouped}</span>
        {fraction !== undefined && <span className="text-ink">.{fraction}</span>}
        {ghost && <span className="text-ink-3/50">{ghost}</span>}
      </span>
      <span className="shrink-0 text-lg tracking-normal text-ink-3">{currency}</span>
    </p>
  );
}

function ProductGrid({
  products,
  waiting,
  highlight,
  disabled,
  onCharge,
}: {
  products: readonly Product[];
  /** Live products that haven't loaded: what to say, and what the merchant can do about it. */
  waiting: { text: string; action: { label: string; run: () => void } | null } | null;
  highlight: string | null;
  disabled: boolean;
  onCharge: (product: Product) => void;
}) {
  if (waiting) {
    return (
      <div className="mt-10 flex flex-1 flex-col items-center gap-3 text-center">
        <p className="max-w-xs text-[13px] text-ink-2">{waiting.text}</p>
        {waiting.action && (
          <button type="button" onClick={waiting.action.run} className="btn-primary h-9 rounded-lg px-4 text-[13px]">
            {waiting.action.label}
          </button>
        )}
      </div>
    );
  }
  if (products.length === 0) {
    return (
      <div className="mt-10 flex flex-1 flex-col items-center gap-3 text-center">
        <span className="grid size-10 place-items-center rounded-full border border-accent-line bg-accent-soft text-accent-ink">
          <PackagePlus className="size-4" aria-hidden />
        </span>
        <p className="max-w-xs text-[13px] text-ink-2">No products yet. Create one and it&rsquo;s a tap away here, and shareable as a Blink.</p>
        <Link href="/dashboard/invoices" className="btn-ghost inline-flex h-9 items-center rounded-lg px-4 text-[13px] font-medium">
          Create a product
        </Link>
      </div>
    );
  }
  return (
    <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
      {products.map((product) => (
        <li key={product.id}>
          <button
            type="button"
            onClick={() => onCharge(product)}
            disabled={disabled}
            aria-label={`Charge ${product.title}, ${formatAmount(product.amount)} ${assetSymbol(product.mint)}`}
            className={cn(
              "flex w-full flex-col overflow-hidden rounded-xl border bg-panel text-left transition-colors hover:border-line-strong active:bg-raised disabled:cursor-not-allowed disabled:opacity-50",
              product.id === highlight ? "border-accent" : "border-line",
            )}
          >
            <ProductThumb title={product.title} image={product.image} className="aspect-square w-full border-b text-3xl" />
            <span className="block p-3">
              <span className="block truncate text-[13px] font-medium text-ink">{product.title}</span>
              <span className="mt-1 block font-mono text-sm tabular-nums text-ink">
                {formatAmount(product.amount)} <span className="text-xs text-ink-3">{assetSymbol(product.mint)}</span>
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Where payments are detected from: the live websocket, polling, or nowhere (sample data). */
function ConnectionChip({ live, socket, networkLabel }: { live: boolean; socket: string | undefined; networkLabel: string }) {
  const state = !live
    ? { dot: "bg-idle", text: "Sample data", title: "Sample data: no payment is watched on-chain." }
    : socket === "open"
      ? { dot: "bg-success motion-safe:animate-pulse", text: `${networkLabel} · live`, title: "Payments are detected over the payment server's websocket." }
      : { dot: "bg-warning", text: `${networkLabel} · polling`, title: "Payments are detected by the payment server's polling." };
  return (
    <span title={state.title} className="hidden h-7 items-center gap-1.5 rounded-full border border-line bg-panel px-2.5 font-mono text-[11px] text-ink-2 sm:inline-flex">
      <span aria-hidden className={cn("size-1.5 rounded-full", state.dot)} />
      {state.text}
    </span>
  );
}

/** Full screen, for a tablet on the counter. Hidden where the browser can't do it (iPhone Safari). */
function FullscreenButton() {
  const [supported, setSupported] = useState(false);
  const [full, setFull] = useState(false);
  useEffect(() => {
    setSupported(typeof document.documentElement.requestFullscreen === "function");
    const onChange = () => setFull(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  if (!supported) return null;
  const toggle = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void document.documentElement.requestFullscreen().catch(() => {});
  };
  return (
    <button type="button" onClick={toggle} aria-label={full ? "Exit full screen" : "Full screen"} title={full ? "Exit full screen" : "Full screen"} className={iconButton}>
      {full ? <Minimize2 className="size-4" aria-hidden /> : <Maximize2 className="size-4" aria-hidden />}
    </button>
  );
}
