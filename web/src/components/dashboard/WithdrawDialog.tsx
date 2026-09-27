"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { CircleAlert, Wallet } from "lucide-react";
import { useRef, useState, type FormEvent, type RefObject } from "react";

import { Modal } from "@/components/ui/Modal";
import { useDashboard } from "@/lib/dashboard-store";
import { formatUsdc } from "@/lib/format";
import { useNetwork } from "@/lib/settings";
import { centsToAmount, parseUsdcCents } from "@/lib/solana-pay";

import { WalletButton } from "./WalletButton";

export function WithdrawDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { balanceCents } = useDashboard();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Withdraw USDC"
      initialFocus={inputRef}
      description={
        <>
          Available: <span className="font-mono text-ink">{formatUsdc(balanceCents)}</span> USDC
        </>
      }
    >
      <WithdrawForm inputRef={inputRef} onDone={onClose} />
    </Modal>
  );
}

function WithdrawForm({ inputRef, onDone }: { inputRef: RefObject<HTMLInputElement | null>; onDone: () => void }) {
  const { balanceCents, requestPayout } = useDashboard();
  const { publicKey } = useWallet();
  const network = useNetwork();
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const cents = parseUsdcCents(amount);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!cents) {
      setError("Enter an amount in USDC, like 250 or 99.50.");
      return;
    }
    if (cents > balanceCents) {
      setError(`You can withdraw up to ${formatUsdc(balanceCents)} USDC.`);
      return;
    }
    if (!publicKey) {
      setError("Connect the wallet that should receive the payout.");
      return;
    }
    requestPayout({ amountCents: cents, destination: publicKey.toBase58() });
    onDone();
  };

  return (
    <form onSubmit={submit} noValidate>
      <label htmlFor="withdraw-amount" className="mt-6 block text-xs font-medium text-ink-2">
        Amount
      </label>
      <div className="relative mt-2">
        <input
          ref={inputRef}
          id="withdraw-amount"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0.00"
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            setError(null);
          }}
          aria-invalid={error !== null}
          aria-describedby={error ? "withdraw-error" : undefined}
          className="h-10 w-full rounded-lg border border-line bg-canvas pl-3 pr-28 font-mono text-[15px] tabular-nums text-ink outline-none transition-colors placeholder:text-ink-3 hover:border-line-strong focus:border-accent focus-visible:outline-none"
        />
        <div className="absolute inset-y-0 right-2 flex items-center gap-2">
          <span className="font-mono text-xs text-ink-3">USDC</span>
          <button
            type="button"
            onClick={() => {
              setAmount(centsToAmount(balanceCents));
              setError(null);
            }}
            className="h-6 rounded-md border border-line px-2 font-mono text-[11px] text-ink-2 transition-colors hover:border-accent-line hover:bg-accent-soft hover:text-accent-ink"
          >
            Max
          </button>
        </div>
      </div>

      <p className="mt-5 text-xs font-medium text-ink-2">Send to</p>
      {publicKey ? (
        <div className="mt-2 flex items-start gap-3 rounded-lg border border-line bg-canvas px-3 py-2.5">
          <Wallet className="mt-0.5 size-4 shrink-0 text-accent-ink" aria-hidden />
          <div className="min-w-0">
            <p className="break-all font-mono text-xs text-ink">{publicKey.toBase58()}</p>
            <p className="mt-0.5 text-xs text-ink-3">Your connected wallet · {network.label}</p>
          </div>
        </div>
      ) : (
        <div className="mt-2">
          <WalletButton fullWidth align="start" side="top" label="Connect the receiving wallet" />
        </div>
      )}

      {error && (
        <p id="withdraw-error" role="alert" className="mt-4 flex gap-2 text-[13px] text-danger">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </p>
      )}

      <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <button type="button" onClick={onDone} className="btn-ghost h-9 rounded-lg px-4 text-[13px]">
          Cancel
        </button>
        <button type="submit" className="btn-primary h-9 rounded-lg px-4 text-[13px]">
          {cents ? `Withdraw ${formatUsdc(cents)} USDC` : "Withdraw"}
        </button>
      </div>
    </form>
  );
}
