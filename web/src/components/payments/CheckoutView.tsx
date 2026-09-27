"use client";

import { Ban, Check, CircleAlert, Clock, ExternalLink, QrCode, ShieldCheck, TimerOff, TriangleAlert, Wallet } from "lucide-react";
import { useCallback, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { BrandMark } from "@/components/dashboard/BrandMark";
import { NetworkScope } from "@/components/providers/NetworkScope";
import { ReceiptBadge } from "@/components/receipts/ReceiptBadge";
import { Badge } from "@/components/ui/Badge";
import { CopyButton } from "@/components/ui/CopyButton";
import { Figure } from "@/components/ui/Figure";
import { PaymentQr } from "@/components/ui/PaymentQr";
import { TokenIcon } from "@/components/ui/TokenIcon";
import { useCelebratePayments } from "@/hooks/use-celebrate";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useNow } from "@/hooks/use-now";
import { usePaymentWatch } from "@/hooks/use-payment-watch";
import { useServerInvoice } from "@/hooks/use-server-invoice";
import type { CompletedPayment } from "@/hooks/use-wallet-payment";
import { cn } from "@/lib/cn";
import { NETWORK_FEE_SOL, currencyOfMint, transferInstructions } from "@/lib/currency";
import { formatCountdown, formatDateTime, truncateAddress } from "@/lib/format";
import { requestTarget, type PaymentLookup } from "@/lib/invoice-payments";
import { DEFAULT_NETWORK, NETWORKS, isNetworkId, txExplorer, type NetworkConfig } from "@/lib/network";
import { useNetwork } from "@/lib/settings";
import { assetSymbol, formatAmount, parseTransferRequest, paymentUrlFromCheckout, type ParsedTransferRequest } from "@/lib/solana-pay";
import type { PaymentIssue, Receipt } from "@/lib/types";

import { PaymentModal } from "./PaymentModal";

/** Under this much time left, the expiry badge turns amber. */
const EXPIRY_WARNING_MS = 10 * 60_000;

/**
 * The payer's side of an invoice: the page a checkout link opens. The query is the Solana Pay transfer request
 * plus the network it's on, and everything here runs on that network, whatever this browser's Settings say.
 */
export function CheckoutView({ query }: { query: string }) {
  const params = useMemo(() => new URLSearchParams(query), [query]);
  const cluster = params.get("cluster");
  const network = NETWORKS[isNetworkId(cluster) ? cluster : DEFAULT_NETWORK];
  const paymentUrl = useMemo(() => paymentUrlFromCheckout(params), [params]);
  const request = useMemo(() => {
    try {
      return paymentUrl ? parseTransferRequest(paymentUrl) : null;
    } catch {
      return null;
    }
  }, [paymentUrl]);

  return (
    <NetworkScope network={network}>
      <div className="min-h-dvh px-4 py-8 sm:py-14">
        <main className="mx-auto w-full max-w-[880px]">
          <header className="mb-5 flex items-center justify-between gap-3">
            <BrandMark href={null} />
            <span className="inline-flex h-6 items-center gap-1.5 rounded-full border border-line bg-panel px-2.5 font-mono text-[11px] text-ink-2">
              <span aria-hidden className="size-1.5 rounded-full bg-success" />
              {network.label}
            </span>
          </header>

          {paymentUrl && request?.amount && requestTarget(request) ? (
            <Checkout paymentUrl={paymentUrl} request={request} amount={request.amount} />
          ) : (
            <div role="alert" className="card mx-auto flex max-w-md gap-3 p-5 text-[13px] text-ink-2">
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
              <div>
                <p className="font-medium text-ink">This payment link isn&rsquo;t complete</p>
                <p className="mt-1">It&rsquo;s missing the recipient, amount or reference. Ask the sender for a new link.</p>
              </div>
            </div>
          )}

          <p className="mt-6 flex items-start justify-center gap-1.5 text-center text-xs text-ink-3">
            <ShieldCheck className="mt-px size-3.5 shrink-0 text-accent-ink" aria-hidden />
            Payments go straight from your wallet to the recipient on Solana. No one here ever asks for your recovery phrase.
          </p>
        </main>
      </div>
    </NetworkScope>
  );
}

function Checkout({ paymentUrl, request, amount }: { paymentUrl: string; request: ParsedTransferRequest; amount: string }) {
  const network = useNetwork();
  const touch = useMediaQuery("(hover: none) and (pointer: coarse)");
  const [paying, setPaying] = useState(false);
  const [localPaid, setLocalPaid] = useState<CompletedPayment | null>(null);
  const [localIssue, setLocalIssue] = useState<PaymentIssue | null>(null);
  const target = useMemo(() => requestTarget(request), [request]);
  const server = useServerInvoice(target?.reference ?? null);
  const now = useNow(1_000);
  const mint = request.splToken?.toBase58() ?? null;
  const symbol = assetSymbol(mint);
  const title = request.memo ?? "invoice";

  // A link this server made: the server's record decides (paid, expired, canceled). Any other link: this page
  // watches the chain itself. Either way a payment made anywhere (a phone scanning the QR code) shows here too.
  const tracked = server.known ? server.invoice : null;
  const serverPaid = tracked?.status === "paid" && tracked.signature ? { signature: tracked.signature, paidAt: tracked.paidAt ?? tracked.createdAt } : null;
  const paid = serverPaid ?? localPaid;
  const issue = tracked ? tracked.issue : localIssue;
  const closed = paid || !tracked ? null : tracked.status === "canceled" ? "canceled" : tracked.status === "expired" || tracked.expiresAt <= now ? "expired" : null;

  // A server invoice flipping to paid while this page is open (paid here, or from a phone): confetti and a chime.
  // Left out until the server has answered, so opening an invoice that's already paid doesn't set it off.
  const celebration = useMemo(
    () => (server.known && target ? [{ key: target.reference, paid: serverPaid !== null }] : []),
    [server.known, target, serverPaid],
  );
  useCelebratePayments(celebration);

  const onLookup = useCallback((lookup: PaymentLookup) => {
    if (lookup.status === "paid") setLocalPaid({ signature: lookup.signature, paidAt: lookup.paidAt });
    else if (lookup.status === "issue") setLocalIssue(lookup.issue);
  }, []);
  usePaymentWatch(server.known === false && !localPaid ? target : null, onLookup);

  const expiresIn = tracked && !paid && !closed ? tracked.expiresAt - now : null;

  return (
    <section aria-labelledby="checkout-heading" className="card grid overflow-hidden md:grid-cols-[minmax(0,1fr)_360px]">
      <InvoiceSummary request={request} amount={amount} mint={mint} symbol={symbol} network={network} paid={paid !== null} />

      <div className="flex flex-col border-t border-line bg-canvas p-5 sm:p-6 md:border-l md:border-t-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {paid ? (
            <Badge tone="success">Paid</Badge>
          ) : closed ? (
            <Badge tone="neutral">{closed === "expired" ? "Expired" : "Canceled"}</Badge>
          ) : (
            <Badge tone="warning">Awaiting payment</Badge>
          )}
          {expiresIn !== null && (
            <span
              className={cn(
                "inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 font-mono text-[11px]",
                expiresIn < EXPIRY_WARNING_MS ? "border-warning-line bg-warning-bg text-warning" : "border-line bg-panel text-ink-2",
              )}
              title="Time left to pay this link"
            >
              <Clock className="size-3" aria-hidden />
              <span className="sr-only">Expires in </span>
              <span aria-live="off">{formatCountdown(expiresIn)}</span>
            </span>
          )}
        </div>

        {paid ? (
          <Settled paid={paid} amount={amount} symbol={symbol} mint={mint} network={network} receipt={tracked?.receipt ?? null} />
        ) : closed ? (
          <div role="status" className="mt-8 flex flex-1 flex-col items-center text-center">
            <span className="grid size-10 place-items-center rounded-full border border-idle-line bg-idle-bg text-idle">
              {closed === "expired" ? <TimerOff className="size-4" aria-hidden /> : <Ban className="size-4" aria-hidden />}
            </span>
            <p className="mt-4 text-[15px] font-medium text-ink">{closed === "expired" ? "This payment link expired" : "This payment request was canceled"}</p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">
              Don&rsquo;t send a payment to it: nothing would match it to this invoice. Ask the sender for a new link.
            </p>
          </div>
        ) : (
          <>
            {issue && (
              <p role="alert" className="mt-4 flex gap-2 rounded-lg border border-warning-line bg-warning-bg p-3 text-[13px] text-warning">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  {issue.message} Still due: {formatAmount(amount)} {symbol}.
                </span>
              </p>
            )}
            <PayMethods
              paymentUrl={paymentUrl}
              amount={amount}
              symbol={symbol}
              title={title}
              touch={touch}
              onPayWithWallet={() => setPaying(true)}
            />
            <p className="mt-auto pt-5 text-[11.5px] leading-relaxed text-ink-3">{transferInstructions(mint, amount)}</p>
          </>
        )}
      </div>

      <PaymentModal
        open={paying}
        onClose={() => setPaying(false)}
        paymentUrl={paymentUrl}
        title={title}
        onPaid={(payment) => {
          setLocalPaid(payment);
          server.refresh();
        }}
      />
    </section>
  );
}

/** Left pane: the invoice as a document. Amount due, a line-item breakdown, then who and where it pays. */
function InvoiceSummary({
  request,
  amount,
  mint,
  symbol,
  network,
  paid,
}: {
  request: ParsedTransferRequest;
  amount: string;
  mint: string | null;
  symbol: string;
  network: NetworkConfig;
  paid: boolean;
}) {
  const recipient = request.recipient.toBase58();
  const shown = formatAmount(amount);
  return (
    <div className="p-5 sm:p-8">
      <p className="eyebrow">{request.label ?? "Payment request"}</p>
      <p className="mt-6 text-[13px] text-ink-2">{paid ? "Amount paid" : "Amount due"}</p>
      <h1 id="checkout-heading" className="mt-1.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <Figure value={shown} className="text-[2.5rem] font-medium leading-none tracking-[-0.04em] text-ink" />
        <span className="inline-flex items-center gap-1.5 font-mono text-sm text-ink-2">
          <TokenIcon currency={currencyOfMint(mint)} className="size-4" />
          {symbol}
        </span>
      </h1>
      {request.message && <p className="mt-3 text-[13px] text-ink-2">{request.message}</p>}

      <dl className="mt-8 text-[13px]">
        <Row label={request.memo ? `Invoice ${request.memo}` : "Payment"} value={`${shown} ${symbol}`} />
        <Row
          label="Network fee"
          hint={mint === null ? "Paid in SOL, on top" : "Paid in SOL, separately"}
          value={`≈ ${NETWORK_FEE_SOL} SOL`}
          muted
        />
        <div className="mt-1 flex items-baseline justify-between gap-4 border-t border-line-strong pt-3">
          <dt className="font-medium text-ink">Total due</dt>
          <dd className="font-mono font-medium text-ink">
            {shown} {symbol}
          </dd>
        </div>
      </dl>

      <dl className="mt-8 grid grid-cols-[88px_minmax(0,1fr)] gap-x-4 gap-y-2 border-t border-line pt-5 text-xs">
        <dt className="text-ink-3">Pay to</dt>
        <dd className="flex min-w-0 items-center gap-1">
          <span className="truncate font-mono text-ink-2" title={recipient}>
            {truncateAddress(recipient, 6)}
          </span>
          <CopyButton text={recipient} label="Copy recipient address" copiedLabel="Address copied" className="size-6" />
        </dd>
        {request.memo && (
          <>
            <dt className="text-ink-3">Reference</dt>
            <dd className="truncate font-mono text-ink-2">{request.memo}</dd>
          </>
        )}
        <dt className="text-ink-3">Network</dt>
        <dd className="text-ink-2">{network.label}</dd>
        <dt className="text-ink-3">Asset</dt>
        <dd className="text-ink-2">{mint === null ? "SOL (native)" : `${symbol} (SPL token)`}</dd>
      </dl>
    </div>
  );
}

function Row({ label, hint, value, muted = false }: { label: string; hint?: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className={cn("min-w-0", muted ? "text-ink-3" : "text-ink-2")}>
        {label}
        {hint && <span className="mt-0.5 block text-[11px] text-ink-3 sm:ml-2 sm:mt-0 sm:inline">{hint}</span>}
      </dt>
      <dd className={cn("shrink-0 font-mono", muted ? "text-ink-3" : "text-ink")}>{value}</dd>
    </div>
  );
}

type Method = "wallet" | "qr";

/** Right pane: pay from a browser wallet, or scan the Solana Pay QR code with a phone. ARIA tabs, arrow keys move. */
function PayMethods({
  paymentUrl,
  amount,
  symbol,
  title,
  touch,
  onPayWithWallet,
}: {
  paymentUrl: string;
  amount: string;
  symbol: string;
  title: string;
  touch: boolean;
  onPayWithWallet: () => void;
}) {
  const [method, setMethod] = useState<Method>("wallet");
  const tabs = useRef(new Map<Method, HTMLButtonElement>());
  const methods: ReadonlyArray<{ id: Method; label: string; icon: typeof Wallet }> = [
    { id: "wallet", label: "Wallet", icon: Wallet },
    { id: "qr", label: "QR code", icon: QrCode },
  ];

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next: Method = method === "wallet" ? "qr" : "wallet";
    setMethod(next);
    tabs.current.get(next)?.focus();
  };

  return (
    <div className="mt-6">
      <p className="text-xs font-medium text-ink-2">Pay with</p>
      <div role="tablist" aria-label="Payment method" onKeyDown={onKeyDown} className="mt-2 grid grid-cols-2 gap-0.5 rounded-lg border border-line bg-panel p-0.5">
        {methods.map(({ id, label, icon: Icon }) => {
          const selected = method === id;
          return (
            <button
              key={id}
              ref={(node) => {
                if (node) tabs.current.set(id, node);
                else tabs.current.delete(id);
              }}
              type="button"
              role="tab"
              id={`pay-tab-${id}`}
              aria-selected={selected}
              aria-controls={`pay-panel-${id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setMethod(id)}
              className={cn(
                "inline-flex h-8 items-center justify-center gap-1.5 rounded-md border text-[13px] transition-colors",
                selected ? "border-accent-line bg-accent-soft font-medium text-accent-ink" : "border-transparent text-ink-3 hover:text-ink-2",
              )}
            >
              <Icon className="size-3.5" aria-hidden />
              {label}
            </button>
          );
        })}
      </div>

      {method === "wallet" ? (
        <TabPanel id="wallet">
          <button
            type="button"
            onClick={onPayWithWallet}
            className="btn-primary inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg px-4 text-sm"
          >
            <Wallet className="size-4" aria-hidden />
            Pay {formatAmount(amount)} {symbol}
          </button>
          {touch && (
            <a href={paymentUrl} className="btn-ghost mt-2 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg px-4 text-[13px] font-medium">
              <ExternalLink className="size-3.5" aria-hidden />
              Open in wallet app
            </a>
          )}
          <p className="mt-3 text-center text-xs text-ink-3">Phantom, Solflare, Backpack and other Solana browser wallets.</p>
        </TabPanel>
      ) : (
        <TabPanel id="qr">
          <PaymentQr url={paymentUrl} label={`Solana Pay QR code for ${title}`} size={176} caption="Scan with a Solana Pay wallet on your phone" />
          {touch && (
            <a href={paymentUrl} className="link mt-3 block text-center text-xs">
              Open in wallet app instead
            </a>
          )}
        </TabPanel>
      )}
    </div>
  );
}

function TabPanel({ id, children }: { id: Method; children: ReactNode }) {
  return (
    <div role="tabpanel" id={`pay-panel-${id}`} aria-labelledby={`pay-tab-${id}`} className="mt-4">
      {children}
    </div>
  );
}

/** What a buyer is told about their cNFT receipt. */
function receiptMessage(receipt: Receipt): string {
  const wallet = truncateAddress(receipt.owner, 5);
  if (receipt.status === "minted") return `A proof-of-purchase cNFT is on its way to your wallet ${wallet}. It can take a minute to show up.`;
  if (receipt.status === "pending") return `Minting your proof-of-purchase cNFT to ${wallet}…`;
  if (receipt.status === "simulated") return "This shop hasn't turned on cNFT receipts yet, so none was minted for this payment.";
  return "Your cNFT receipt couldn't be minted yet. The seller can issue it again; your payment is complete either way.";
}

/** The receipt, once the payment has confirmed on-chain, and the buyer's cNFT proof-of-purchase when the shop issues one. */
function Settled({
  paid,
  amount,
  symbol,
  mint,
  network,
  receipt,
}: {
  paid: CompletedPayment;
  amount: string;
  symbol: string;
  mint: string | null;
  network: NetworkConfig;
  receipt: Receipt | null;
}) {
  const explorer = txExplorer(paid.signature, network);
  return (
    <div role="status" className="mt-8 flex flex-1 flex-col">
      <span className="grid size-10 place-items-center rounded-full border border-success-line bg-success-bg text-success">
        <Check className="size-5" strokeWidth={2.5} aria-hidden />
      </span>
      <p className="mt-4 text-[15px] font-medium text-ink">Payment received</p>
      <p className="mt-1 text-[13px] text-ink-2">Confirmed on {network.label}. You can close this page.</p>

      <dl className="mt-6 grid grid-cols-[80px_minmax(0,1fr)] gap-x-4 gap-y-2 border-t border-line pt-4 text-xs">
        <dt className="text-ink-3">Amount</dt>
        <dd className="flex items-center gap-1.5 font-mono text-ink">
          <TokenIcon currency={currencyOfMint(mint)} className="size-3.5" />
          {formatAmount(amount)} {symbol}
        </dd>
        <dt className="text-ink-3">Confirmed</dt>
        <dd className="font-mono tabular-nums text-ink-2">{formatDateTime(paid.paidAt)} UTC</dd>
        <dt className="text-ink-3">Signature</dt>
        <dd className="flex min-w-0 items-center gap-1">
          <span className="truncate font-mono tabular-nums text-ink-2" title={paid.signature}>
            {truncateAddress(paid.signature, 8)}
          </span>
          <CopyButton text={paid.signature} label="Copy transaction signature" copiedLabel="Signature copied" className="size-6" />
        </dd>
        {receipt && (
          <>
            <dt className="self-center text-ink-3">Receipt</dt>
            <dd>
              <ReceiptBadge receipt={receipt} />
            </dd>
          </>
        )}
      </dl>
      {receipt && <p className="mt-2.5 text-xs leading-relaxed text-ink-3">{receiptMessage(receipt)}</p>}

      <a
        href={explorer.url}
        target="_blank"
        rel="noopener noreferrer"
        className="btn-ghost mt-6 inline-flex h-9 items-center justify-center gap-2 rounded-lg px-3 text-[13px] font-medium"
      >
        View on {explorer.name}
        <ExternalLink className="size-3.5" aria-hidden />
      </a>
    </div>
  );
}
