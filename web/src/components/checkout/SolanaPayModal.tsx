"use client";

import { Ban, Check, ExternalLink, Smartphone, TimerOff } from "lucide-react";
import { useState } from "react";

import { InvoiceStatusBadge } from "@/components/dashboard/payment-meta";
import { ReceiptBadge } from "@/components/receipts/ReceiptBadge";
import { CopyButton } from "@/components/ui/CopyButton";
import { segmentClass, segmentGroupClass } from "@/components/ui/FilterTabs";
import { Figure } from "@/components/ui/Figure";
import { Modal } from "@/components/ui/Modal";
import { PaymentQr } from "@/components/ui/PaymentQr";
import { TokenIcon } from "@/components/ui/TokenIcon";
import { useCheckoutLink, useOrigin } from "@/hooks/use-checkout-link";
import { useNow } from "@/hooks/use-now";
import { actionUrl, isPublicOrigin } from "@/lib/blink";
import { cn } from "@/lib/cn";
import { currencyOfMint } from "@/lib/currency";
import { useDashboard } from "@/lib/dashboard-store";
import { formatCountdown, formatDateTime, truncateAddress } from "@/lib/format";
import { invoiceStatus } from "@/lib/metrics";
import { txExplorer } from "@/lib/network";
import { usePriceQuote, type PriceQuote } from "@/lib/price";
import { useNetwork } from "@/lib/settings";
import { assetSymbol, formatAmount } from "@/lib/solana-pay";
import type { Invoice } from "@/lib/types";

/**
 * Wallets that open a URL in their in-app browser from a universal link (each wallet's documented "browse"
 * deeplink). The checkout page then runs inside the wallet, with the wallet connected: tap, approve, done.
 */
const WALLETS = [
  { name: "Phantom", browse: (url: string, ref: string) => `https://phantom.app/ul/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(ref)}` },
  { name: "Solflare", browse: (url: string, ref: string) => `https://solflare.com/ul/v1/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(ref)}` },
  { name: "Backpack", browse: (url: string, ref: string) => `https://backpack.app/ul/v1/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(ref)}` },
] as const;

type QrMode = "transfer" | "transaction";

/**
 * Solana Pay for one invoice: a high-contrast QR code for a phone wallet, one-tap links that open the checkout in
 * Phantom, Solflare or Backpack, what the amount is worth in the other asset (Pyth), and whether the payment has
 * landed. The dialog is a native <dialog>: focus stays inside while it's open and Escape closes it.
 */
export function SolanaPayModal({ invoice, onClose }: { invoice: Invoice | null; onClose: () => void }) {
  return (
    <Modal
      open={invoice !== null}
      onClose={onClose}
      title={invoice ? `Pay ${invoice.id}` : "Solana Pay"}
      description="Scan with any Solana wallet, or open the checkout in a wallet on this phone."
    >
      {invoice && <SolanaPayView opened={invoice} />}
    </Modal>
  );
}

function SolanaPayView({ opened }: { opened: Invoice }) {
  const { invoices, source, clock } = useDashboard();
  const network = useNetwork();
  const origin = useOrigin();
  const checkoutLink = useCheckoutLink();
  const now = useNow(1_000);
  const [mode, setMode] = useState<QrMode>("transfer");
  const { quote, error: priceError } = usePriceQuote(true);

  // The store's copy is current: it may have been paid, canceled or flagged since the dialog opened.
  const invoice = invoices.find((inv) => inv.reference === opened.reference) ?? opened;
  const live = source.mode === "live";
  const status = invoiceStatus(invoice, live ? now : clock.now);
  const reachable = isPublicOrigin(origin);
  // A transaction request (`solana:https://…`) makes the wallet fetch the transaction from this server: it needs a
  // public URL and an invoice the server knows. A transfer request works everywhere, so it's the default.
  const transactionReason = !live
    ? "Sample data has no server-side action to fetch."
    : !invoice.tracked
      ? "This link was made before the payment server tracked invoices."
      : !reachable
        ? `Wallets fetch the transaction from this server, so it needs a public https URL (this is ${origin ? new URL(origin).host : "a local address"}).`
        : null;
  const qrValue = mode === "transaction" && transactionReason === null ? `solana:${actionUrl(origin, invoice.reference)}` : invoice.paymentUrl;
  const checkout = checkoutLink(invoice.paymentUrl);
  const symbol = assetSymbol(invoice.mint);

  return (
    <div className="mt-5 flex flex-col">
      <div className="rounded-lg border border-line bg-canvas p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="eyebrow">Amount due</p>
          <InvoiceStatusBadge status={status} />
        </div>
        <p className="mt-2 flex items-baseline gap-2">
          <Figure value={formatAmount(invoice.amount)} className="text-[1.75rem] font-medium leading-none tracking-[-0.04em] text-ink" />
          <span className="inline-flex items-center gap-1.5 font-mono text-[13px] text-ink-2">
            <TokenIcon currency={currencyOfMint(invoice.mint)} />
            {symbol}
          </span>
        </p>
        <Conversion amount={invoice.amount} symbol={symbol} quote={quote} error={priceError} now={now} />
      </div>

      {status === "pending" && (
        <>
          <div className="mt-4 flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-ink-2">QR code</p>
            <div role="group" aria-label="What the QR code encodes" className={segmentGroupClass}>
              <button type="button" aria-pressed={mode === "transfer"} onClick={() => setMode("transfer")} className={segmentClass(mode === "transfer")}>
                Transfer
              </button>
              <button
                type="button"
                aria-pressed={mode === "transaction"}
                onClick={() => setMode("transaction")}
                disabled={transactionReason !== null}
                title={transactionReason ?? "solana:https://… transaction request, fetched from this server"}
                className={cn(segmentClass(mode === "transaction"), "disabled:cursor-not-allowed disabled:opacity-40")}
              >
                Transaction
              </button>
            </div>
          </div>
          <div className="mt-3 flex flex-col items-center">
            <PaymentQr url={qrValue} label={`Solana Pay QR code for ${invoice.id}`} size={184} caption={null} />
            <div className="mt-2.5 flex w-full min-w-0 items-center gap-1 rounded-lg border border-line bg-canvas py-1 pl-2.5 pr-1">
              <code className="min-w-0 flex-1 truncate font-mono text-[11px] tabular-nums text-ink-2" title={qrValue}>
                {qrValue}
              </code>
              <CopyButton text={qrValue} label="Copy the solana: link" copiedLabel="Link copied" className="size-7" />
            </div>
            <p className="mt-1.5 self-start text-[11px] text-ink-3">
              {mode === "transaction" && transactionReason === null
                ? "Transaction request: the wallet fetches a ready-made transaction from this server."
                : "Transfer request: the wallet builds the payment itself. Works with any Solana Pay wallet."}
            </p>
          </div>

          <p className="mt-4 text-xs font-medium text-ink-2">Open on this phone</p>
          <div className="mt-2 grid grid-cols-3 gap-1.5">
            {WALLETS.map((wallet) =>
              reachable ? (
                <a
                  key={wallet.name}
                  href={wallet.browse(checkout, origin)}
                  className="btn-ghost inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-2 text-[13px] font-medium"
                >
                  <Smartphone className="size-3.5" aria-hidden />
                  {wallet.name}
                </a>
              ) : (
                <span
                  key={wallet.name}
                  aria-disabled="true"
                  className="btn-ghost inline-flex h-9 cursor-not-allowed items-center justify-center gap-1.5 rounded-lg px-2 text-[13px] font-medium opacity-40"
                >
                  <Smartphone className="size-3.5" aria-hidden />
                  {wallet.name}
                </span>
              ),
            )}
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-ink-3">
            {reachable
              ? "Opens this checkout inside the wallet's browser, already connected."
              : "These open the checkout inside the wallet on a phone, which can't reach a local address. They work once the dashboard runs on a public https URL; scan the QR code meanwhile."}
          </p>
        </>
      )}

      <div className="mt-4 flex items-center gap-1 rounded-lg border border-line bg-canvas py-1 pl-2.5 pr-1">
        <span className="shrink-0 text-xs text-ink-3">Checkout</span>
        <code className="min-w-0 flex-1 truncate font-mono text-[11px] tabular-nums text-ink-2" title={checkout}>
          {checkout.replace(/^https?:\/\//, "")}
        </code>
        <CopyButton text={checkout} label="Copy the checkout link" copiedLabel="Checkout link copied" className="size-7" />
      </div>

      <SettlementStatus invoice={invoice} status={status} live={live} now={live ? now : clock.now} networkLabel={network.label} />
    </div>
  );
}

/** What the amount is worth in the other asset, from Pyth. Indicative: the invoice is paid in its own asset. */
function Conversion({ amount, symbol, quote, error, now }: { amount: string; symbol: string; quote: PriceQuote | null; error: boolean; now: number }) {
  if (!quote) {
    return <p className="mt-2 text-xs text-ink-3">{error ? "Live SOL price unavailable right now." : "Loading the live SOL price…"}</p>;
  }
  const value = Number(amount);
  const usd = symbol === "SOL" ? value * quote.solUsd : value * quote.usdcUsd;
  const other = symbol === "SOL" ? `$${usd.toFixed(2)}` : `${(usd / quote.solUsd).toFixed(usd / quote.solUsd < 1 ? 4 : 2)} SOL`;
  const ageSeconds = Math.max(0, Math.round((now - quote.publishTime) / 1000));
  return (
    <div className="mt-2.5 border-t border-line pt-2.5">
      <p className="font-mono text-xs tabular-nums text-ink-2">
        {symbol === "SOL" ? `${formatAmount(amount)} SOL` : `$${formatAmount(amount)} USDC`} <span className="text-ink-3">≈</span>{" "}
        <span className="text-accent-ink">{other}</span>
      </p>
      <p className="mt-0.5 text-[11px] text-ink-3" title={`${quote.source}. SOL/USD ± $${quote.solUsdConfidence.toFixed(2)}.`}>
        Pyth SOL/USD <span className="font-mono tabular-nums text-ink-2">${quote.solUsd.toFixed(2)}</span> ·{" "}
        <span className="font-mono tabular-nums">{ageSeconds}s</span> ago · indicative, you pay in {symbol}
      </p>
    </div>
  );
}

/** Where the payment stands. It only says it's listening when the payment server really is watching the chain. */
function SettlementStatus({
  invoice,
  status,
  live,
  now,
  networkLabel,
}: {
  invoice: Invoice;
  status: ReturnType<typeof invoiceStatus>;
  live: boolean;
  now: number;
  networkLabel: string;
}) {
  const network = useNetwork();
  const base = "mt-4 flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-[13px]";

  if (status === "paid") {
    const explorer = invoice.signature ? txExplorer(invoice.signature, network) : null;
    return (
      <div role="status" className={cn(base, "border-success-line bg-success-bg")}>
        <Check className="mt-0.5 size-4 shrink-0 text-success" strokeWidth={2.5} aria-hidden />
        <div className="min-w-0">
          <p className="font-medium text-success">Settled on {networkLabel}</p>
          <p className="mt-0.5 text-xs text-ink-2">
            {invoice.paidAt !== undefined && <span className="font-mono tabular-nums">{formatDateTime(invoice.paidAt)} UTC</span>}
            {invoice.signature && explorer && (
              <>
                {" · "}
                <a href={explorer.url} target="_blank" rel="noopener noreferrer" className="link inline-flex items-center gap-1 font-mono tabular-nums">
                  {truncateAddress(invoice.signature, 6)}
                  <ExternalLink className="size-3" aria-hidden />
                </a>
              </>
            )}
          </p>
          {invoice.receipt && <ReceiptBadge receipt={invoice.receipt} className="mt-2" />}
        </div>
      </div>
    );
  }
  if (status === "expired" || status === "canceled") {
    const Icon = status === "expired" ? TimerOff : Ban;
    return (
      <div role="status" className={cn(base, "border-idle-line bg-idle-bg text-ink-2")}>
        <Icon className="mt-0.5 size-4 shrink-0 text-idle" aria-hidden />
        {status === "expired" ? "This link expired, so it can't be paid anymore." : "This payment was canceled; nothing watches for it."}
      </div>
    );
  }

  const watched = live && invoice.tracked === true;
  return (
    <div role="status" aria-live="polite" className={cn(base, "border-line bg-canvas")}>
      <span
        aria-hidden
        className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", watched ? "bg-accent-ink motion-safe:animate-pulse" : "bg-ink-3")}
      />
      <div className="min-w-0 flex-1">
        <p className="text-ink">{watched ? "Waiting for on-chain settlement…" : "Awaiting payment"}</p>
        <p className="mt-0.5 text-xs text-ink-3">
          {watched
            ? `The payment server is watching ${networkLabel} and settles it once the transfer confirms.`
            : live
              ? "This link isn't tracked by the payment server, so nothing marks it paid here."
              : "Sample data: this link isn't watched on-chain."}
        </p>
      </div>
      <span className="shrink-0 font-mono text-xs tabular-nums text-ink-2" title="Time left to pay">
        {formatCountdown(invoice.expiresAt - now)}
      </span>
    </div>
  );
}
