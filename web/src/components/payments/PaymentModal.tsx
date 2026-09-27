"use client";

import { WalletReadyState, type WalletName } from "@solana/wallet-adapter-base";
import { useWallet } from "@solana/wallet-adapter-react";
import { Check, CircleAlert, ExternalLink, LoaderCircle, RefreshCw, TriangleAlert, Wallet } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { Figure } from "@/components/ui/Figure";
import { Modal } from "@/components/ui/Modal";
import { TokenIcon } from "@/components/ui/TokenIcon";
import { useCelebrate } from "@/hooks/use-celebrate";
import { useDetectedWallets } from "@/hooks/use-detected-wallets";
import { usePayerBalances, type PayerBalanceState } from "@/hooks/use-payer-balances";
import { useWalletPayment, type CompletedPayment, type PaymentPhase, type WalletPayment } from "@/hooks/use-wallet-payment";
import { cn } from "@/lib/cn";
import { NETWORK_FEE_SOL, currencyOfMint, transferInstructions } from "@/lib/currency";
import { formatDateTime, truncateAddress } from "@/lib/format";
import { txExplorer, type NetworkConfig } from "@/lib/network";
import { useNetwork } from "@/lib/settings";
import { amountToBaseUnits, assetSymbol, formatAmount, formatBaseUnits, SOL_DECIMALS, type ParsedTransferRequest } from "@/lib/solana-pay";
import type { Invoice } from "@/lib/types";
import { SIGNATURE_FEE_LAMPORTS, type PaymentError } from "@/lib/wallet-payment";

interface PaymentModalProps {
  open: boolean;
  onClose: () => void;
  /** The Solana Pay link to pay (`solana:…`). */
  paymentUrl: string;
  /** What's being paid, e.g. the invoice number. */
  title: string;
  /** When paying one of the dashboard's invoices: the link must match it exactly. */
  invoice?: Invoice;
  onPaid?: (payment: CompletedPayment) => void;
}

/**
 * "Pay with Connected Wallet" checkout: connects a browser wallet if needed, shows which account pays and what
 * it holds, then builds the transfer, has the wallet sign it and confirms it. Cancel, × and Escape close it at
 * once and abandon whatever was in progress; it opens clean next time.
 */
export function PaymentModal({ open, onClose, paymentUrl, title, invoice, onPaid }: PaymentModalProps) {
  const payment = useWalletPayment({ paymentUrl, invoice, onPaid });
  const close = () => {
    payment.reset();
    onClose();
  };

  return (
    <Modal open={open} onClose={close} title={`Pay ${title}`} description={payment.request?.message ?? undefined}>
      <div className="mt-5">
        {payment.request?.amount ? (
          <Checkout payment={payment} request={payment.request} amount={payment.request.amount} onClose={close} />
        ) : (
          <p role="alert" className="flex gap-2 text-sm text-danger">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            This payment link is incomplete, so it can&rsquo;t be paid here.
          </p>
        )}
      </div>
    </Modal>
  );
}

const BUSY: readonly PaymentPhase[] = ["preparing", "signing", "confirming"];

function Checkout({
  payment,
  request,
  amount,
  onClose,
}: {
  payment: WalletPayment;
  request: ParsedTransferRequest;
  amount: string;
  onClose: () => void;
}) {
  const network = useNetwork();
  const { wallet, publicKey, connected, disconnect } = useWallet();
  const detected = useDetectedWallets();
  const [choosing, setChoosing] = useState(false);

  const mint = request.splToken?.toBase58() ?? null;
  const symbol = assetSymbol(mint);
  const payer = connected && publicKey ? publicKey.toBase58() : null;
  const balances = usePayerBalances(payer, mint, payment.completed?.signature ?? "");
  const { phase } = payment;
  const busy = BUSY.includes(phase);
  const selfPay = payer === request.recipient.toBase58();
  const walletName = wallet?.adapter.name ?? "your wallet";
  const celebrate = useCelebrate();
  const completed = phase === "success" ? payment.completed : null;
  const celebrationKey = request.references[0]?.toBase58() ?? completed?.signature;
  // Keyed by the reference, so the checkout page or dashboard seeing the same payment settle doesn't go off again.
  useEffect(() => {
    if (completed && celebrationKey) celebrate(celebrationKey);
  }, [completed, celebrationKey, celebrate]);

  if (phase === "success" && payment.completed) {
    return <Complete completed={payment.completed} request={request} amount={amount} network={network} onDone={onClose} />;
  }

  // One wallet installed (the usual case): connect it straight away. Several: let the payer pick.
  const startConnect = () => {
    const only = detected.length === 1 ? detected[0] : undefined;
    if (only) payment.connect(only.adapter.name);
    else setChoosing(true);
  };

  return (
    <div className="flex flex-col">
      <Summary request={request} amount={amount} mint={mint} symbol={symbol} network={network} />

      <section aria-labelledby="pay-from-heading" className="mt-5">
        <p id="pay-from-heading" className="eyebrow">
          Pay from
        </p>
        {payer ? (
          <PayerCard
            payer={payer}
            walletName={walletName}
            walletIcon={wallet?.adapter.icon}
            balances={balances}
            mint={mint}
            symbol={symbol}
            amount={amount}
            selfPay={selfPay}
            disabled={busy}
            onChange={() => {
              setChoosing(true);
              void disconnect();
            }}
          />
        ) : choosing || phase === "connecting" ? (
          <WalletChoices
            connectingTo={phase === "connecting" ? wallet?.adapter.name : undefined}
            onChoose={(name) => payment.connect(name)}
          />
        ) : (
          <p className="mt-2 rounded-lg border border-dashed border-line-strong px-3 py-3 text-[13px] text-ink-3">
            No wallet connected. Connect Phantom, Solflare or another Solana wallet to pay from this browser.
          </p>
        )}
      </section>

      <div aria-live="polite" className="mt-4 space-y-3 empty:hidden">
        <Progress phase={phase} signature={payment.signature} network={network} walletName={walletName} />
        {payment.error && <ErrorNotice error={payment.error} onRetry={payment.pay} />}
      </div>

      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row">
        <button type="button" onClick={onClose} className="btn-ghost h-10 rounded-lg px-4 text-[13px] font-medium">
          Cancel
        </button>
        {payer ? (
          <button
            type="button"
            onClick={payment.pay}
            disabled={busy || selfPay}
            className="btn-primary inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-[13px] disabled:cursor-not-allowed disabled:opacity-60 sm:flex-1"
          >
            {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Wallet className="size-4" aria-hidden />}
            {phase === "preparing"
              ? "Preparing…"
              : phase === "signing"
                ? `Approve in ${walletName}…`
                : phase === "confirming"
                  ? "Confirming…"
                  : `Approve & Pay ${formatAmount(amount)} ${symbol}`}
          </button>
        ) : (
          <button
            type="button"
            onClick={startConnect}
            disabled={phase === "connecting"}
            className="btn-primary inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-[13px] disabled:cursor-wait disabled:opacity-70 sm:flex-1"
          >
            {phase === "connecting" ? (
              <LoaderCircle className="size-4 animate-spin" aria-hidden />
            ) : (
              <Wallet className="size-4" aria-hidden />
            )}
            {phase === "connecting" ? "Connecting…" : "Pay with Connected Wallet"}
          </button>
        )}
      </div>
    </div>
  );
}

function Summary({
  request,
  amount,
  mint,
  symbol,
  network,
}: {
  request: ParsedTransferRequest;
  amount: string;
  mint: string | null;
  symbol: string;
  network: NetworkConfig;
}) {
  const recipient = request.recipient.toBase58();
  return (
    <div className="rounded-lg border border-line bg-canvas p-4">
      <p className="eyebrow">Amount due</p>
      <p className="mt-2 flex items-baseline gap-2">
        <Figure value={formatAmount(amount)} className="text-[1.75rem] font-medium leading-none tracking-[-0.04em] text-ink" />
        <span className="inline-flex items-center gap-1.5 font-mono text-[13px] text-ink-2">
          <TokenIcon currency={currencyOfMint(mint)} />
          {symbol}
        </span>
      </p>
      <p className="mt-2.5 text-xs leading-relaxed text-ink-3">{transferInstructions(mint, amount)}</p>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 border-t border-line pt-3 text-xs">
        <dt className="text-ink-3">To</dt>
        <dd className="truncate font-mono text-ink-2" title={recipient}>
          {truncateAddress(recipient, 6)}
        </dd>
        {request.memo && (
          <>
            <dt className="text-ink-3">Reference</dt>
            <dd className="truncate font-mono text-ink-2">{request.memo}</dd>
          </>
        )}
        <dt className="text-ink-3">Network</dt>
        <dd className="text-ink-2">{network.label}</dd>
      </dl>
    </div>
  );
}

/**
 * Balances are truncated (never rounded up) to four decimals, or as many as the amount due has (0.000001 SOL):
 * enough to see whether they cover the payment.
 */
function shortBalance(units: bigint, decimals: number, amount: string): string {
  const places = Math.min(decimals, Math.max(4, amount.split(".")[1]?.length ?? 0));
  const [whole = "0", fraction = ""] = formatBaseUnits(units, decimals).split(".");
  return `${whole}.${fraction.slice(0, places).replace(/0+$/, "").padEnd(2, "0")}`;
}

/** Base units of `amount`, or null when it's more precise than the asset allows (paying reports that). */
function unitsOf(amount: string, decimals: number): bigint | null {
  try {
    return amountToBaseUnits(amount, decimals);
  } catch {
    return null;
  }
}

function PayerCard({
  payer,
  walletName,
  walletIcon,
  balances,
  mint,
  symbol,
  amount,
  selfPay,
  disabled,
  onChange,
}: {
  payer: string;
  walletName: string;
  walletIcon: string | undefined;
  balances: PayerBalanceState;
  mint: string | null;
  symbol: string;
  amount: string;
  selfPay: boolean;
  disabled: boolean;
  onChange: () => void;
}) {
  const held = balances.balances;
  // The asset the invoice asks for: native SOL (the amount plus the fee, from one balance), or the token's
  // account, with SOL only for the fee. The payment re-checks all of it, including rent for a new token account.
  let short = false;
  let feeShort = false;
  if (held && mint === null) {
    const due = unitsOf(amount, SOL_DECIMALS);
    short = due !== null && held.lamports < due + SIGNATURE_FEE_LAMPORTS;
  } else if (held?.token) {
    const due = unitsOf(amount, held.token.decimals);
    short = due !== null && held.token.amount < due;
    feeShort = held.lamports < SIGNATURE_FEE_LAMPORTS;
  }

  return (
    <div className="mt-2 rounded-lg border border-line p-3">
      <div className="flex items-center gap-3">
        {walletIcon ? (
          <img src={walletIcon} alt="" className="size-8 shrink-0 rounded-md" />
        ) : (
          <Wallet className="size-8 shrink-0 rounded-md bg-accent-soft p-1.5 text-accent-ink" aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink">{walletName}</p>
          <p className="truncate font-mono text-xs text-ink-2" title={payer}>
            {truncateAddress(payer, 6)}
          </p>
        </div>
        <button
          type="button"
          onClick={onChange}
          disabled={disabled}
          className="btn-ghost h-7 rounded-md px-2 text-xs disabled:cursor-not-allowed disabled:opacity-50"
        >
          Change
        </button>
      </div>

      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 border-t border-line pt-3 text-xs">
        <BalanceItem label="SOL" warn={mint === null ? short : feeShort}>
          {held ? shortBalance(held.lamports, SOL_DECIMALS, mint === null ? amount : "0") : balances.failed ? "—" : <BalanceSkeleton />}
        </BalanceItem>
        {mint && (
          <BalanceItem label={symbol} warn={short}>
            {held?.token ? shortBalance(held.token.amount, held.token.decimals, amount) : balances.failed || held ? "—" : <BalanceSkeleton />}
          </BalanceItem>
        )}
      </dl>

      {selfPay ? (
        <p className="mt-3 flex gap-1.5 text-xs text-warning">
          <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
          This is the wallet being paid. Switch to another account in {walletName} to pay from it.
        </p>
      ) : short || feeShort ? (
        <p className="mt-3 flex gap-1.5 text-xs text-warning">
          <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
          {short && mint === null
            ? `Insufficient balance: You need ${formatAmount(amount)} SOL plus about ${NETWORK_FEE_SOL} SOL for the network fee to complete this payment.`
            : short
              ? `Insufficient balance: You need ${formatAmount(amount)} ${symbol} to complete this payment.`
              : `Insufficient balance: You need a little SOL (about ${NETWORK_FEE_SOL}) for the network fee to complete this payment.`}
        </p>
      ) : null}
    </div>
  );
}

function BalanceItem({ label, warn = false, children }: { label: string; warn?: boolean; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-ink-3">{label}</dt>
      <dd className={cn("font-mono tabular-nums", warn ? "text-warning" : "text-ink")}>{children}</dd>
    </div>
  );
}

function BalanceSkeleton() {
  return <span className="inline-block h-3 w-12 animate-pulse rounded bg-raised align-middle" aria-label="Loading balance" />;
}

function WalletChoices({ connectingTo, onChoose }: { connectingTo: string | undefined; onChoose: (name: WalletName) => void }) {
  const detected = useDetectedWallets();
  return (
    <div className="mt-2 rounded-lg border border-line p-1.5">
      <p className="px-2 pb-1 pt-1 text-xs text-ink-3">Choose a wallet</p>
      {detected.length > 0 ? (
        detected.map((w) => (
          <button
            key={w.adapter.name}
            type="button"
            onClick={() => onChoose(w.adapter.name)}
            disabled={connectingTo !== undefined}
            className="flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-[13px] text-ink-2 transition-colors hover:bg-raised hover:text-ink disabled:cursor-wait disabled:hover:bg-transparent"
          >
            <img src={w.adapter.icon} alt="" className="size-5 rounded" />
            <span className="flex-1 text-left">{w.adapter.name}</span>
            {connectingTo === w.adapter.name ? (
              <LoaderCircle className="size-4 animate-spin text-ink-2" aria-label="Connecting" />
            ) : (
              <span className="text-[11px] text-ink-3">{w.readyState === WalletReadyState.Installed ? "Detected" : "Available"}</span>
            )}
          </button>
        ))
      ) : (
        <p className="px-2.5 pb-2 text-sm text-ink-2">
          No Solana wallet found in this browser. Install{" "}
          <a href="https://phantom.com" target="_blank" rel="noopener noreferrer" className="link">
            Phantom
          </a>{" "}
          or{" "}
          <a href="https://solflare.com" target="_blank" rel="noopener noreferrer" className="link">
            Solflare
          </a>
          , then reload this page.
        </p>
      )}
    </div>
  );
}

function Progress({ phase, signature, network, walletName }: { phase: PaymentPhase; signature: string | null; network: NetworkConfig; walletName: string }) {
  const line = (text: string, extra?: ReactNode) => (
    <div className="text-[13px] text-ink">
      <p className="flex items-center gap-2">
        <LoaderCircle className="size-4 shrink-0 animate-spin text-ink-2" aria-hidden />
        {text}
      </p>
      {extra}
    </div>
  );

  if (phase === "connecting") return line(`Approve the connection in ${walletName}…`);
  if (phase === "preparing") return line("Checking balances and building the transaction…");
  if (phase === "signing") return line(`Approve the payment in ${walletName}…`);
  if (phase === "confirming") {
    return line(
      `Sent. Confirming on ${network.label}…`,
      <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 pl-6 text-xs text-ink-3">
        Closing this won&rsquo;t stop the payment.
        {signature && <ExplorerLink signature={signature} network={network} />}
      </p>,
    );
  }
  return null;
}

function ErrorNotice({ error, onRetry }: { error: PaymentError; onRetry: () => void }) {
  const declined = error.kind === "rejected";
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-2 rounded-lg border p-3 text-[13px]",
        declined ? "border-warning-line bg-warning-bg text-warning" : "border-danger-line bg-danger-bg text-danger",
      )}
    >
      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p className="flex-1">{error.message}</p>
      {error.retryable && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-current/40 px-2.5 text-xs font-medium transition-colors hover:bg-current/10"
        >
          <RefreshCw className="size-3.5" aria-hidden />
          Retry
        </button>
      )}
    </div>
  );
}

function ExplorerLink({ signature, network }: { signature: string; network: NetworkConfig }) {
  const explorer = txExplorer(signature, network);
  return (
    <a
      href={explorer.url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-xs link"
    >
      View on {explorer.name}
      <ExternalLink className="size-3" aria-hidden />
    </a>
  );
}

function Complete({
  completed,
  request,
  amount,
  network,
  onDone,
}: {
  completed: CompletedPayment;
  request: ParsedTransferRequest;
  amount: string;
  network: NetworkConfig;
  onDone: () => void;
}) {
  return (
    <div role="status" className="flex flex-col items-center pb-1 pt-3 text-center">
      <span className="grid size-11 place-items-center rounded-full border border-success-line bg-success-bg text-success">
        <Check className="size-5" strokeWidth={2.5} aria-hidden />
      </span>
      <p className="mt-4 text-base font-medium text-ink">Payment complete</p>
      <p className="mt-1 text-[13px] text-ink-2">
        {formatAmount(amount)} {assetSymbol(request.splToken?.toBase58() ?? null)} paid to{" "}
        <span className="font-mono">{truncateAddress(request.recipient.toBase58())}</span>
      </p>
      <p className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-ink-3">
        Confirmed {formatDateTime(completed.paidAt)} UTC
        <ExplorerLink signature={completed.signature} network={network} />
      </p>
      <button type="button" onClick={onDone} className="btn-primary mt-6 h-10 w-full rounded-lg text-[13px]">
        Done
      </button>
    </div>
  );
}
