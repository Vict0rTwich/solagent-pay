"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { CircleAlert, Link2, LoaderCircle, QrCode, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { InvoiceModal } from "@/components/invoices/InvoiceModal";
import { CopiedToast, CopyIcon } from "@/components/ui/CopiedToast";
import { CurrencyToggle } from "@/components/ui/CurrencyToggle";
import { PaymentQr } from "@/components/ui/PaymentQr";
import { TokenIcon } from "@/components/ui/TokenIcon";
import { useCheckoutLink } from "@/hooks/use-checkout-link";
import { useCopy } from "@/hooks/use-copy";
import { useNow } from "@/hooks/use-now";
import { cn } from "@/lib/cn";
import { CURRENCIES, parseAmount, type Currency } from "@/lib/currency";
import { useDashboard } from "@/lib/dashboard-store";
import { truncateAddress } from "@/lib/format";
import { describeApiError } from "@/lib/invoice-api";
import { invoiceStatus } from "@/lib/metrics";
import { useNetwork } from "@/lib/settings";
import { formatAmount } from "@/lib/solana-pay";
import type { Invoice } from "@/lib/types";

import { InvoiceStatusBadge } from "./payment-meta";
import { WalletButton } from "./WalletButton";

const NEW_INVOICE_EVENT = "solagent:new-invoice";
const AMOUNT_ID = "quick-invoice-amount";
const LINK_ID = "quick-invoice-link";
const MEMO_MAX = 80;

const fieldClass =
  "w-full rounded-lg border border-line bg-canvas text-ink outline-none transition-colors placeholder:text-ink-3 hover:border-line-strong focus:border-accent focus-visible:outline-none disabled:cursor-not-allowed disabled:text-ink-2 disabled:hover:border-line";

/** A preset as a chip shows it: "1,000", "0.5". */
function presetLabel(amount: string): string {
  return formatAmount(amount).replace(/\.00$/, "").replace(/(\.\d*?)0+$/, "$1");
}

/** Brings the widget back to a blank form and focuses the amount. Used by "Create invoice". */
export function requestNewInvoice(): void {
  window.dispatchEvent(new Event(NEW_INVOICE_EVENT));
}

/**
 * Bill a client in a few keystrokes: amount, then "Create payment link", and the link's real checkout URL fills the
 * field under the amount, with Copy and an inline QR code. While a link is shown the fields that made it are locked,
 * so what's on screen always matches what the link bills; "New link" starts over.
 */
export function QuickInvoiceWidget() {
  const { publicKey } = useWallet();
  const network = useNetwork();
  const { createInvoice, invoices, source, clock } = useDashboard();
  const checkoutLink = useCheckoutLink();
  const linkCopy = useCopy();
  const now = useNow(5_000);
  const [currency, setCurrency] = useState<Currency>("USDC");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Invoice | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [managing, setManaging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const sectionRef = useRef<HTMLElement>(null);
  const copyRef = useRef<HTMLButtonElement>(null);

  // The store's copy is current: the link may have been paid, canceled or flagged since it was made.
  const current = created ? (invoices.find((inv) => inv.reference === created.reference) ?? created) : null;
  // Demo data runs on its own fixed clock; live links expire in real time.
  const status = current ? invoiceStatus(current, source.mode === "live" ? now : clock.now) : null;
  const link = current ? checkoutLink(current.paymentUrl) : "";
  const locked = current !== null;

  useEffect(() => {
    const onRequest = () => {
      setCreated(null);
      setShowQr(false);
      setFocusRequest((n) => n + 1);
    };
    window.addEventListener(NEW_INVOICE_EVENT, onRequest);
    return () => window.removeEventListener(NEW_INVOICE_EVENT, onRequest);
  }, []);

  useEffect(() => {
    if (focusRequest === 0) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    sectionRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
    document.getElementById(AMOUNT_ID)?.focus({ preventScroll: true });
  }, [focusRequest]);

  // A fresh link is ready to copy: one keystroke away.
  useEffect(() => {
    if (created) copyRef.current?.focus();
  }, [created]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting || locked) return;
    const parsed = parseAmount(amount, currency);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    if (!publicKey) {
      setError("Connect the wallet that should receive this payment.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      setCreated(
        await createInvoice({
          kind: "link",
          currency,
          amount: parsed.amount,
          memo: memo.trim(),
          client: "",
          recipient: publicKey.toBase58(),
        }),
      );
    } catch (createError) {
      setError(describeApiError(createError));
    } finally {
      setSubmitting(false);
    }
  };

  const startOver = () => {
    setCreated(null);
    setShowQr(false);
    setAmount("");
    setMemo("");
    setFocusRequest((n) => n + 1);
  };

  return (
    <section ref={sectionRef} aria-labelledby="quick-invoice-heading" className="card flex h-full flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="quick-invoice-heading" className="text-[13px] font-medium text-ink">
            Quick payment link
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-ink-3">Bill a client in {currency}. They pay by opening or scanning the link in any Solana wallet.</p>
        </div>
        <span className="eyebrow shrink-0 rounded-md border border-accent-line bg-accent-soft px-1.5 py-0.5 text-[10px] text-accent-ink">Solana Pay</span>
      </div>

      <form onSubmit={(event) => void submit(event)} noValidate className="mt-5 flex flex-1 flex-col">
        <fieldset disabled={locked} className="contents">
          <legend className="sr-only">Link amount</legend>
          <div className="flex items-center justify-between gap-3">
            <label htmlFor={AMOUNT_ID} className="text-xs font-medium text-ink-2">
              Amount
            </label>
            <CurrencyToggle
              value={currency}
              onChange={(next) => {
                setCurrency(next);
                setError(null);
              }}
              label="Link currency"
            />
          </div>
          <div className="relative mt-2">
            <input
              id={AMOUNT_ID}
              inputMode="decimal"
              autoComplete="off"
              placeholder={currency === "SOL" ? "0.000" : "0.00"}
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setError(null);
              }}
              aria-invalid={error !== null}
              aria-describedby={error ? "quick-invoice-error" : undefined}
              className={cn(fieldClass, "h-11 pl-3 pr-20 font-mono text-lg tabular-nums tracking-[-0.02em] aria-[invalid=true]:border-danger-line")}
            />
            <span className="pointer-events-none absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1.5 font-mono text-xs text-ink-3">
              <TokenIcon currency={currency} className="size-3.5" />
              {currency}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {CURRENCIES[currency].presets.map((preset) => (
              <button
                key={`${currency}:${preset}`}
                type="button"
                onClick={() => {
                  setAmount(preset);
                  setError(null);
                }}
                aria-label={`${presetLabel(preset)} ${currency}`}
                className="h-6 rounded-md border border-line px-2 font-mono text-[11px] tabular-nums text-ink-2 transition-colors hover:border-accent-line hover:bg-accent-soft hover:text-accent-ink disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-line disabled:hover:bg-transparent disabled:hover:text-ink-2"
              >
                {presetLabel(preset)}
              </button>
            ))}
          </div>
        </fieldset>

        {/* The link itself: the real checkout URL once it exists. Nothing to copy before that, so no stand-in URL. */}
        <div className="mt-4 rounded-lg border border-line bg-canvas p-3">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor={LINK_ID} className="text-xs font-medium text-ink-2">
              Checkout link
            </label>
            {status && (
              <span className="flex items-center gap-2">
                <InvoiceStatusBadge status={status} />
                <button type="button" onClick={() => setManaging(true)} className="link text-xs">
                  Manage
                </button>
              </span>
            )}
          </div>
          <div className="mt-2 flex gap-1.5">
            <input
              id={LINK_ID}
              readOnly
              value={link.replace(/^https?:\/\//, "")}
              placeholder="Appears when you create the link"
              title={link || undefined}
              onFocus={(e) => e.currentTarget.select()}
              className="h-8 min-w-0 flex-1 text-ellipsis rounded-lg border border-line bg-panel px-2.5 font-mono text-[11px] tabular-nums text-ink-2 outline-none transition-colors placeholder:font-sans placeholder:text-ink-3 focus:border-accent"
            />
            <button
              ref={copyRef}
              type="button"
              onClick={() => void linkCopy.copy(link)}
              disabled={!current}
              className="btn-primary relative inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs disabled:cursor-not-allowed disabled:opacity-40"
            >
              <CopyIcon copied={linkCopy.copied} className="size-3.5" />
              {linkCopy.copied ? "Copied" : "Copy"}
              <CopiedToast show={linkCopy.copied} label="Checkout link copied" />
            </button>
            <button
              type="button"
              onClick={() => setShowQr((open) => !open)}
              disabled={!current}
              aria-pressed={showQr}
              aria-controls="quick-invoice-qr"
              aria-label={showQr ? "Hide QR code" : "Show QR code"}
              title={showQr ? "Hide QR code" : "Show QR code"}
              className={cn(
                "grid size-8 shrink-0 place-items-center rounded-lg border text-accent-ink transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                showQr ? "border-accent bg-accent-soft-hover" : "border-accent-line bg-accent-soft hover:bg-accent-soft-hover",
              )}
            >
              <QrCode className="size-4" aria-hidden />
            </button>
          </div>
          {current && showQr && (
            <div id="quick-invoice-qr" className="reveal mt-3 flex justify-center">
              <PaymentQr url={current.paymentUrl} label={`Solana Pay QR code for ${current.id}`} size={152} />
            </div>
          )}
        </div>

        <fieldset disabled={locked} className="contents">
          <legend className="sr-only">Memo</legend>
          <div className="mt-4 flex items-baseline justify-between">
            <label htmlFor="quick-invoice-memo" className="text-xs font-medium text-ink-2">
              Client memo
            </label>
            <span className="font-mono text-[11px] tabular-nums text-ink-3">
              {memo.length}/{MEMO_MAX}
            </span>
          </div>
          <input
            id="quick-invoice-memo"
            maxLength={MEMO_MAX}
            autoComplete="off"
            placeholder="Brand refresh — milestone 2"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            className={cn(fieldClass, "mt-2 h-9 px-3 text-[13px]")}
          />
          <p className="mt-1.5 text-xs text-ink-3">Shown to your client in their wallet before they pay.</p>
        </fieldset>

        {error && (
          <p id="quick-invoice-error" role="alert" className="mt-4 flex gap-2 text-[13px] text-danger">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            {error}
          </p>
        )}

        <div className="pt-5">
          {!publicKey ? (
            <WalletButton fullWidth align="start" side="top" label="Connect wallet to get paid" />
          ) : locked ? (
            <button type="button" onClick={startOver} className="btn-ghost inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg px-4 text-[13px] font-medium">
              <RotateCcw className="size-3.5" aria-hidden />
              New link
            </button>
          ) : (
            <button
              type="submit"
              disabled={submitting}
              className="btn-primary inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg px-4 text-[13px] disabled:cursor-wait disabled:opacity-70"
            >
              {submitting ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Link2 className="size-4" aria-hidden />}
              {submitting ? "Creating…" : "Create payment link"}
            </button>
          )}
          <p className="mt-3 text-xs text-ink-3">
            {publicKey ? (
              <>
                Pays <span className="font-mono tabular-nums text-ink-2">{truncateAddress(publicKey.toBase58())}</span> in {currency} on{" "}
                {network.label}
              </>
            ) : (
              "Payments go straight to the wallet you connect."
            )}
          </p>
        </div>
      </form>

      {/* Pay with wallet, share as Blink, or cancel: the full payment view for the link. */}
      <InvoiceModal invoice={managing ? current : null} onClose={() => setManaging(false)} />
    </section>
  );
}
