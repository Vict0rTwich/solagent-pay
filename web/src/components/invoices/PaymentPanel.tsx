"use client";

import { Ban, CircleAlert, CircleCheck, Clock, ExternalLink, LoaderCircle, TimerOff, TriangleAlert, Wallet, Zap } from "lucide-react";
import { useState } from "react";

import { PaymentModal } from "@/components/payments/PaymentModal";
import { ReceiptLine } from "@/components/receipts/ReceiptLine";
import { Badge } from "@/components/ui/Badge";
import { CopiedToast, CopyIcon } from "@/components/ui/CopiedToast";
import { Figure } from "@/components/ui/Figure";
import { PaymentQr } from "@/components/ui/PaymentQr";
import { TokenIcon } from "@/components/ui/TokenIcon";
import { useCheckoutLink, useOrigin } from "@/hooks/use-checkout-link";
import { useCopy } from "@/hooks/use-copy";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useNow } from "@/hooks/use-now";
import { actionUri, dialToUrl, isPublicOrigin } from "@/lib/blink";
import { cn } from "@/lib/cn";
import { currencyOfMint } from "@/lib/currency";
import { useDashboard } from "@/lib/dashboard-store";
import { formatDateTime, formatDuration, truncateAddress } from "@/lib/format";
import { describeApiError } from "@/lib/invoice-api";
import { invoiceStatus } from "@/lib/metrics";
import { txExplorer, type NetworkConfig } from "@/lib/network";
import { useNetwork } from "@/lib/settings";
import { assetSymbol, formatAmount } from "@/lib/solana-pay";
import type { Invoice, InvoiceStatus, PaymentIssue } from "@/lib/types";

interface PaymentPanelProps {
  invoice: Invoice;
  /** Set right after creating it, to confirm that worked. */
  created?: "invoice" | "link";
  /** Leaves the view. The invoice stays open, and the dashboard keeps checking for its payment. */
  onDismiss: () => void;
  dismissLabel?: string;
  /** Runs after "Cancel payment" voided the invoice. */
  onCanceled: () => void;
  qrSize?: number;
}

/**
 * One invoice's payment view: the checkout link and QR code for the client, "Pay with wallet" for a payer at this
 * computer, and "Cancel payment". Live invoices are watched and settled by the payment server; this view shows
 * what the server reports (the dashboard syncs it every few seconds).
 */
export function PaymentPanel({ invoice: opened, created, onDismiss, dismissLabel = "Done", onCanceled, qrSize }: PaymentPanelProps) {
  const { invoices, source, clock, cancelInvoice, syncInvoices } = useDashboard();
  const network = useNetwork();
  const now = useNow(5_000);
  const [canceling, setCanceling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  // The store's copy is current: it may have been paid, canceled or flagged since this view opened.
  const invoice = invoices.find((inv) => inv.reference === opened.reference) ?? opened;
  const live = source.mode === "live";
  // Demo data runs on its own fixed clock; live invoices expire in real time.
  const status = invoiceStatus(invoice, live ? now : clock.now);

  if (status === "paid") return <PaidView invoice={invoice} network={network} onDismiss={onDismiss} dismissLabel={dismissLabel} />;
  if (status !== "pending") return <ClosedView invoice={invoice} status={status} onDismiss={onDismiss} dismissLabel={dismissLabel} />;

  const cancel = async () => {
    setCanceling(true);
    setCancelError(null);
    try {
      await cancelInvoice(invoice);
      onCanceled();
    } catch (cancelFailure) {
      // Usually "already paid" or "already expired": fetch what the server has now.
      setCancelError(describeApiError(cancelFailure));
      syncInvoices();
    } finally {
      setCanceling(false);
    }
  };

  return (
    <div className="flex flex-col">
      <Summary invoice={invoice} label={created === "invoice" ? "Invoice created" : "Link created"} created={created !== undefined} />

      <div aria-live="polite" className="mt-3 space-y-3">
        <WatchStatus live={live} tracked={invoice.tracked === true} expiresIn={invoice.expiresAt - now} network={network} />
        {invoice.issue && <IssueNotice issue={invoice.issue} invoice={invoice} network={network} />}
      </div>

      <div className="mt-5">
        <PaymentQr url={invoice.paymentUrl} label={`Solana Pay QR code for ${invoice.id}`} size={qrSize} />
      </div>

      <PayActions invoice={invoice} live={live} />

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-4">
        <button
          type="button"
          onClick={() => void cancel()}
          disabled={canceling}
          title="Void this link and stop watching for its payment"
          className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[13px] text-ink-2 transition-colors hover:bg-danger-bg hover:text-danger disabled:cursor-wait disabled:opacity-60"
        >
          {canceling ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> : <Ban className="size-3.5" aria-hidden />}
          {canceling ? "Canceling…" : "Cancel payment"}
        </button>
        <button type="button" onClick={onDismiss} className="btn-ghost h-8 rounded-lg px-3 text-[13px] font-medium">
          {dismissLabel}
        </button>
      </div>
      {cancelError && (
        <p role="alert" className="mt-2 flex gap-1.5 text-xs text-danger">
          <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
          {cancelError}
        </p>
      )}
    </div>
  );
}

function Summary({ invoice, label, created }: { invoice: Invoice; label: string; created: boolean }) {
  return (
    <div className="rounded-lg border border-line bg-canvas p-4">
      <div className="flex items-center justify-between gap-2">
        <Badge tone="warning">Awaiting payment</Badge>
        {created && (
          <span className="inline-flex items-center gap-1 text-xs text-success">
            <CircleCheck className="size-3.5" aria-hidden />
            {label}
          </span>
        )}
      </div>
      <InvoiceAmount invoice={invoice} />
      <p className="mt-1 truncate text-[13px] text-ink-2">
        <span className="font-mono text-xs text-ink-3">{invoice.id}</span>
        {invoice.memo && ` · ${invoice.memo}`}
        {invoice.client && ` · ${invoice.client}`}
      </p>
    </div>
  );
}

function InvoiceAmount({ invoice, muted = false }: { invoice: Invoice; muted?: boolean }) {
  return (
    <p className="mt-3 flex items-baseline gap-2">
      <Figure
        value={formatAmount(invoice.amount)}
        className={cn("text-[1.625rem] font-medium leading-none tracking-[-0.04em]", muted ? "text-ink-2" : "text-ink")}
      />
      <span className="inline-flex items-center gap-1 font-mono text-xs text-ink-2">
        <TokenIcon currency={currencyOfMint(invoice.mint)} className="size-3.5" />
        {assetSymbol(invoice.mint)}
      </span>
    </p>
  );
}

function WatchStatus({ live, tracked, expiresIn, network }: { live: boolean; tracked: boolean; expiresIn: number; network: NetworkConfig }) {
  if (!live) {
    return (
      <p className="text-xs text-ink-3">Sample data: this link isn&rsquo;t watched on-chain. Switch to live data to take real payments.</p>
    );
  }
  if (!tracked) {
    return (
      <p className="flex gap-2 text-xs text-warning">
        <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
        This link was made before the payment server tracked invoices, so nothing confirms its payment. Create a new one.
      </p>
    );
  }
  return (
    <p className="flex gap-2 text-xs text-ink-3">
      <span aria-hidden className="mt-1 size-1.5 shrink-0 rounded-full bg-success" />
      <span>
        The payment server is watching {network.label} for this payment and marks it paid once it confirms.{" "}
        <span className="whitespace-nowrap text-ink-2">
          Expires in <span className="font-mono">{formatDuration(expiresIn)}</span>.
        </span>
      </span>
    </p>
  );
}

function IssueNotice({ issue, invoice, network }: { issue: PaymentIssue; invoice: Invoice; network: NetworkConfig }) {
  return (
    <div role="alert" className="rounded-lg border border-warning-line bg-warning-bg p-3 text-[13px]">
      <p className="flex gap-2 font-medium text-warning">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        {issue.message}
      </p>
      <p className="mt-1 pl-6 text-xs text-ink-2">
        Still waiting for {formatAmount(invoice.amount)} {assetSymbol(invoice.mint)} to{" "}
        <span className="font-mono">{truncateAddress(invoice.recipient)}</span>.{" "}
        <ExplorerLink signature={issue.signature} network={network} label="View that transaction" />
      </p>
    </div>
  );
}

/**
 * The shared link is the https checkout page: it works in any browser, where the `solana:` link only works in
 * wallet apps. Desktop browsers can't open `solana:` links, so a payer at this computer uses "Pay with wallet";
 * phones get "Open in wallet". The QR code stays the `solana:` link, which wallet apps scan directly.
 */
function PayActions({ invoice, live }: { invoice: Invoice; live: boolean }) {
  const { updateInvoice, syncInvoices, source } = useDashboard();
  const touch = useMediaQuery("(hover: none) and (pointer: coarse)");
  const checkoutLink = useCheckoutLink();
  const { copied, copy } = useCopy();
  const [paying, setPaying] = useState(false);
  const link = checkoutLink(invoice.paymentUrl);

  return (
    <>
      <p className="eyebrow mt-5">Checkout link</p>
      <p className="mt-2 max-h-24 select-all overflow-auto break-all rounded-lg border border-line bg-canvas px-3 py-2.5 font-mono text-[11px] leading-relaxed text-ink-2">
        {link}
      </p>
      <p className="mt-1.5 text-xs text-ink-3">Opens a checkout page where your client pays from any browser or phone.</p>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => void copy(link)}
          className="btn-primary relative inline-flex h-9 items-center justify-center gap-2 rounded-lg px-3 text-[13px]"
        >
          <CopyIcon copied={copied} className="size-3.5" />
          {copied ? "Copied" : "Copy link"}
          <CopiedToast show={copied} label="Checkout link copied" />
        </button>
        {touch ? (
          <a href={invoice.paymentUrl} className="btn-ghost inline-flex h-9 items-center justify-center gap-2 rounded-lg px-3 text-[13px] font-medium">
            <ExternalLink className="size-3.5" aria-hidden />
            Open in wallet
          </a>
        ) : (
          <button
            type="button"
            onClick={() => setPaying(true)}
            disabled={!live}
            aria-describedby={live ? undefined : `pay-demo-${invoice.id}`}
            className="btn-ghost inline-flex h-9 items-center justify-center gap-2 rounded-lg px-3 text-[13px] font-medium disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Wallet className="size-3.5" aria-hidden />
            Pay with wallet
          </button>
        )}
      </div>
      {!live && !touch && (
        <p id={`pay-demo-${invoice.id}`} className="mt-2 text-xs text-ink-3">
          Pay with wallet sends a real payment, so it&rsquo;s only available with live data.
        </p>
      )}
      {live && invoice.tracked && <ShareBlink invoice={invoice} />}

      <PaymentModal
        open={paying}
        onClose={() => setPaying(false)}
        paymentUrl={invoice.paymentUrl}
        title={invoice.id}
        invoice={invoice}
        onPaid={(payment) => {
          // Server-tracked invoices are only marked paid by the server: fetch its verdict. Older, untracked
          // ones have nothing else to record the payment.
          if (invoice.tracked) syncInvoices();
          else updateInvoice(invoice, { paidAt: payment.paidAt, signature: payment.signature, issue: undefined });
          source.refresh();
        }}
      />
    </>
  );
}

/**
 * "Share as Blink": copies the invoice's Solana Action as a dial.to link (a payable card in any browser), or as the
 * raw `solana-action:` URI for wallets. Only for invoices the payment server knows, since it serves the action.
 */
function ShareBlink({ invoice }: { invoice: Invoice }) {
  const origin = useOrigin();
  const network = useNetwork();
  const blink = useCopy();
  const uri = useCopy();
  if (!origin) return null;
  const reachable = isPublicOrigin(origin);

  return (
    <div className="mt-3">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void blink.copy(dialToUrl(origin, invoice.reference, network.id))}
          className="btn-ghost relative inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-lg px-3 text-[13px] font-medium"
        >
          {blink.copied ? <CopyIcon copied className="size-3.5 text-success" /> : <Zap className="size-3.5 text-ink-2" aria-hidden />}
          {blink.copied ? "Blink link copied" : "Share as Blink"}
          <CopiedToast show={blink.copied} label="dial.to link copied" />
        </button>
        <button
          type="button"
          onClick={() => void uri.copy(actionUri(origin, invoice.reference))}
          aria-label="Copy the solana-action: URI"
          title="Copy the solana-action: URI, for wallets"
          className="btn-ghost relative inline-flex h-9 items-center gap-1.5 rounded-lg px-3 font-mono text-[11px] text-ink-2"
        >
          <CopyIcon copied={uri.copied} className={cn("size-3.5", uri.copied && "text-success")} />
          solana-action:
          <CopiedToast show={uri.copied} label="Action URI copied" />
        </button>
      </div>
      <p className="mt-1.5 text-xs text-ink-3">
        {reachable
          ? "Unfurls as a payable card in Phantom, on dial.to and in blinks on X."
          : `Blink clients fetch the action over the internet, so it unfurls once this dashboard runs on a public https URL (this is ${new URL(origin).host}).`}
      </p>
    </div>
  );
}

function ExplorerLink({ signature, network, label }: { signature: string; network: NetworkConfig; label?: string }) {
  const explorer = txExplorer(signature, network);
  return (
    <a
      href={explorer.url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-xs link"
    >
      {label ?? `View on ${explorer.name}`}
      <ExternalLink className="size-3" aria-hidden />
    </a>
  );
}

function PaidView({
  invoice,
  network,
  onDismiss,
  dismissLabel,
}: {
  invoice: Invoice;
  network: NetworkConfig;
  onDismiss: () => void;
  dismissLabel: string;
}) {
  return (
    <div role="status" className="flex flex-col">
      <div className="rounded-lg border border-success-line bg-canvas p-4">
        <Badge tone="success">Paid</Badge>
        <InvoiceAmount invoice={invoice} />
        <p className="mt-1 truncate text-[13px] text-ink-2">
          <span className="font-mono text-xs text-ink-3">{invoice.id}</span>
          {invoice.memo && ` · ${invoice.memo}`}
        </p>
        {invoice.paidAt !== undefined && (
          <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-3 text-xs text-ink-3">
            Settled <span className="font-mono text-ink-2">{formatDateTime(invoice.paidAt)} UTC</span>
            {invoice.signature && <ExplorerLink signature={invoice.signature} network={network} />}
          </p>
        )}
        <ReceiptLine invoice={invoice} />
      </div>
      <button type="button" onClick={onDismiss} className="btn-primary mt-5 h-9 self-end rounded-lg px-4 text-[13px]">
        {dismissLabel}
      </button>
    </div>
  );
}

function ClosedView({
  invoice,
  status,
  onDismiss,
  dismissLabel,
}: {
  invoice: Invoice;
  status: Exclude<InvoiceStatus, "pending" | "paid">;
  onDismiss: () => void;
  dismissLabel: string;
}) {
  const canceled = status === "canceled";
  const Icon = canceled ? Ban : TimerOff;
  return (
    <div role="status" className="flex flex-col">
      <div className="rounded-lg border border-line bg-canvas p-4">
        <Badge tone="neutral" icon={Icon}>
          {canceled ? "Canceled" : "Expired"}
        </Badge>
        <InvoiceAmount invoice={invoice} muted />
        <p className="mt-2.5 text-xs leading-relaxed text-ink-3">
          {canceled
            ? "This link isn't watched anymore. If your client pays it anyway, the transfer still shows in Transactions."
            : "This link can't be paid anymore. Create a new one to bill your client again."}
        </p>
      </div>
      <button type="button" onClick={onDismiss} className="btn-primary mt-5 h-9 self-end rounded-lg px-4 text-[13px]">
        {dismissLabel}
      </button>
    </div>
  );
}
