"use client";

import type { WalletName } from "@solana/wallet-adapter-base";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { SendTransactionError } from "@solana/web3.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useWalletError } from "@/components/providers/AppProviders";
import { invoiceApi } from "@/lib/invoice-api";
import { checkPayment, findPayment, requestTarget, type PaymentCheckCache, type PaymentTarget } from "@/lib/invoice-payments";
import { withTimeout } from "@/lib/live-data";
import { parseTransferRequest, type ParsedTransferRequest } from "@/lib/solana-pay";
import type { Invoice } from "@/lib/types";
import {
  PaymentError,
  assertLinkMatchesInvoice,
  broadcast,
  buildTransferTransaction,
  confirmTransfer,
  signTransfer,
  toPaymentError,
  transferStatus,
  type SignedTransfer,
} from "@/lib/wallet-payment";

/**
 * idle → (connecting) → preparing → signing → confirming → success. A failure returns to idle with `error` set.
 */
export type PaymentPhase = "idle" | "connecting" | "preparing" | "signing" | "confirming" | "success";

export interface CompletedPayment {
  signature: string;
  paidAt: number;
}

export interface WalletPayment {
  phase: PaymentPhase;
  error: PaymentError | null;
  request: ParsedTransferRequest | null;
  /** The transaction being confirmed, or the one that paid. */
  signature: string | null;
  completed: CompletedPayment | null;
  /** Opens the chosen wallet's connection prompt. */
  connect: (name: WalletName) => void;
  /** Settles any payment already made or in flight; otherwise builds, signs, sends and confirms a new one. */
  pay: () => void;
  /** Stops whatever is in progress and returns to a clean idle state. */
  reset: () => void;
}

const SEND_TIMEOUT_MS = 15_000;
/** Shorter than a blockhash's ~60–90 s lifetime, so a stuck confirmation surfaces as a Retry, not a long spinner. */
const CONFIRM_TIMEOUT_MS = 45_000;
/** Just after confirming, the RPC node may not serve the transaction yet. */
const FETCH_ATTEMPTS = 3;
const FETCH_RETRY_MS = 1_000;
/** About 9 s of asking the payment server for its verdict after a confirmation. */
const SERVER_VERDICT_ATTEMPTS = 6;
const SERVER_VERDICT_RETRY_MS = 1_500;

/**
 * Signed transfers that may still land, by reference key. Module-level so it outlives the modal: a payer who
 * closes the checkout while a payment confirms and then pays again gets the first one settled, never a
 * second one signed. Entries go once a transfer is confirmed, failed or expired.
 */
const inflight = new Map<string, SignedTransfer>();

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function parse(paymentUrl: string): ParsedTransferRequest | null {
  try {
    return parseTransferRequest(paymentUrl);
  } catch {
    return null;
  }
}

/**
 * "Pay with Connected Wallet" for one Solana Pay link. Every step checks it's still the current attempt, so
 * `reset()` (Cancel, ×, Escape) abandons it at once: a wallet prompt approved after that is never broadcast,
 * the confirmation wait is aborted, and later answers are dropped. `invoice`, when given, must match the link.
 */
export function useWalletPayment({
  paymentUrl,
  invoice,
  onPaid,
}: {
  paymentUrl: string;
  invoice?: Invoice;
  onPaid?: (payment: CompletedPayment) => void;
}): WalletPayment {
  const { connection } = useConnection();
  const { wallet, publicKey, connected, select, connect: connectSelected, signTransaction, sendTransaction } = useWallet();
  const { error: walletError, clearError } = useWalletError();
  const [phase, setPhase] = useState<Exclude<PaymentPhase, "connecting">>("idle");
  const [connectRequested, setConnectRequested] = useState(false);
  const [error, setError] = useState<PaymentError | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [completed, setCompleted] = useState<CompletedPayment | null>(null);
  const attempt = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const checks = useRef<PaymentCheckCache>(new Map());
  const onPaidRef = useRef(onPaid);
  useEffect(() => {
    onPaidRef.current = onPaid;
  });

  const request = useMemo(() => parse(paymentUrl), [paymentUrl]);
  const target = useMemo(() => (request ? requestTarget(request) : null), [request]);

  // Connecting is the wallet adapter's state; this only remembers that the payer asked for it here.
  if (connectRequested && connected) setConnectRequested(false);
  const connecting = connectRequested && !connected && !walletError;
  const connectError = useMemo(
    () => (connectRequested && !connected && walletError ? new PaymentError(walletError) : null),
    [connectRequested, connected, walletError],
  );

  const connect = useCallback(
    (name: WalletName) => {
      attempt.current++;
      clearError();
      setError(null);
      setConnectRequested(true);
      // Selecting a wallet opens its prompt (autoConnect). Re-selecting the same one changes nothing, so ask directly.
      if (wallet?.adapter.name === name) void connectSelected().catch(() => {});
      else select(name);
    },
    [wallet, select, connectSelected, clearError],
  );

  const reset = useCallback(() => {
    attempt.current++;
    abort.current?.abort();
    abort.current = null;
    setPhase("idle");
    setError(null);
    setSignature(null);
    setCompleted(null);
    setConnectRequested(false);
  }, []);

  const pay = useCallback(() => {
    const id = ++attempt.current;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    const current = () => attempt.current === id;
    setError(null);
    setConnectRequested(false);

    const succeed = (payment: CompletedPayment) => {
      setCompleted(payment);
      setSignature(payment.signature);
      setPhase("success");
      onPaidRef.current?.(payment);
    };

    // A confirmed transfer is validated like any other payment: exact token, recipient and amount.
    const validate = async (payTarget: PaymentTarget, sig: string): Promise<CompletedPayment> => {
      for (let i = 0; i < FETCH_ATTEMPTS; i++) {
        const check = await withTimeout(checkPayment(connection, sig, payTarget, checks.current));
        if (check) {
          if (!check.ok) throw new PaymentError(check.issue.message, "failed");
          return { signature: sig, paidAt: check.paidAt };
        }
        await sleep(FETCH_RETRY_MS);
      }
      // Confirmed, but this RPC node doesn't serve it yet. It's the transfer built here from the link, so it pays.
      return { signature: sig, paidAt: Date.now() };
    };

    const send = async (reference: string, signed: SignedTransfer) => {
      try {
        await withTimeout(broadcast(connection, signed), SEND_TIMEOUT_MS);
      } catch (sendError) {
        // The RPC simulated it and refused (e.g. funds moved meanwhile), so it was never forwarded and can't
        // land. A timeout or network error is different: it may have gone out, so it stays in `inflight`.
        if (sendError instanceof SendTransactionError) inflight.delete(reference);
        throw sendError;
      }
    };

    // Invoices the payment server tracks: its own on-chain check is the verdict. It may not have seen the
    // transaction yet (its RPC can trail the payer's by a few seconds), so ask a few times, then fall back to
    // checking the confirmed transaction here. The server's listener settles the invoice shortly either way.
    const serverVerdict = async (payTarget: PaymentTarget, sig: string, invoiceId: string): Promise<CompletedPayment> => {
      for (let i = 0; i < SERVER_VERDICT_ATTEMPTS; i++) {
        const verdict = await withTimeout(invoiceApi.verify(payTarget.reference, invoiceId)).catch(() => null);
        if (verdict?.status === "VERIFIED_PAID" && verdict.signature) {
          return { signature: verdict.signature, paidAt: (verdict.blockTime ?? Math.floor(Date.now() / 1000)) * 1000 };
        }
        if (verdict && verdict.status !== "PENDING" && verdict.signature === sig) {
          throw new PaymentError(verdict.message ?? "The payment server didn't accept this payment.", "failed");
        }
        await sleep(SERVER_VERDICT_RETRY_MS);
      }
      return validate(payTarget, sig);
    };

    const run = async (payTarget: PaymentTarget, payRequest: ParsedTransferRequest) => {
      if (!publicKey) throw new PaymentError("Connect a wallet to pay.");
      if (publicKey.equals(payRequest.recipient)) {
        throw new PaymentError("This wallet is the one being paid. Switch to another account in your wallet to pay from it.");
      }
      if (invoice) assertLinkMatchesInvoice(payRequest, invoice);

      setPhase("preparing");
      // The payment server is the authority on invoices it created. Unreachable counts as unknown: the chain
      // stays the record, and the server catches up when it's back.
      const tracked = await withTimeout(invoiceApi.get(payTarget.reference)).catch(() => null);
      if (!current()) return;
      const settle = (sig: string) => (tracked ? serverVerdict(payTarget, sig, tracked.id) : validate(payTarget, sig));

      // A transfer signed earlier may still land: settle it before ever signing another.
      const earlier = inflight.get(payTarget.reference);
      if (earlier) {
        setSignature(earlier.signature);
        setPhase("confirming");
        const status = await withTimeout(transferStatus(connection, earlier));
        if (!current()) return;
        if (status === "pending") {
          await send(payTarget.reference, earlier);
          await withTimeout(confirmTransfer(connection, earlier, controller.signal), CONFIRM_TIMEOUT_MS);
        }
        if (status === "pending" || status === "confirmed") {
          const payment = await settle(earlier.signature);
          inflight.delete(payTarget.reference);
          if (current()) succeed(payment);
          return;
        }
        // Failed or expired: it will never move funds, so a new payment is safe.
        inflight.delete(payTarget.reference);
        setSignature(null);
        setPhase("preparing");
      }

      if (tracked) {
        if (tracked.status === "paid" && tracked.signature) {
          succeed({ signature: tracked.signature, paidAt: tracked.paidAt ?? Date.now() });
          return;
        }
        if (tracked.status === "canceled") throw new PaymentError("This invoice was canceled, so it can't be paid. Ask for a new payment link.");
        if (tracked.status === "expired" || tracked.expiresAt <= Date.now()) {
          throw new PaymentError("This invoice expired before it was paid. Ask for a new payment link.");
        }
      } else {
        // Not a server invoice (a link made elsewhere). Paid already, e.g. from a phone? Then there's nothing to sign.
        const existing = await withTimeout(findPayment(connection, payTarget, checks.current));
        if (!current()) return;
        if (existing.status === "paid") {
          succeed({ signature: existing.signature, paidAt: existing.paidAt });
          return;
        }
      }

      const prepared = await withTimeout(buildTransferTransaction(connection, publicKey, payRequest));
      if (!current()) return;
      setPhase("signing");
      const signed = await signTransfer(connection, { publicKey, signTransaction, sendTransaction }, prepared);
      // Canceled while the wallet prompt was open: the signed transaction is dropped, never sent.
      if (!current()) return;

      inflight.set(payTarget.reference, signed);
      setSignature(signed.signature);
      setPhase("confirming");
      await send(payTarget.reference, signed);
      if (!current()) return;
      await withTimeout(confirmTransfer(connection, signed, controller.signal), CONFIRM_TIMEOUT_MS);
      if (!current()) return;
      const payment = await settle(signed.signature);
      inflight.delete(payTarget.reference);
      if (current()) succeed(payment);
    };

    void (async () => {
      try {
        if (!request) throw new PaymentError("This payment link isn't valid.");
        if (!target) throw new PaymentError("This link has no amount or reference, so its payment can't be confirmed here.");
        await run(target, request);
      } catch (payError) {
        // A signed transfer stays in `inflight` whatever went wrong: only its on-chain status (checked on the
        // next attempt) can say it will never land.
        if (!current()) return;
        setError(toPaymentError(payError));
        setPhase("idle");
      } finally {
        // Ends a confirmation wait that timed out, so its subscription doesn't linger.
        controller.abort();
      }
    })();
  }, [connection, publicKey, signTransaction, sendTransaction, invoice, request, target]);

  return {
    phase: connecting ? "connecting" : phase,
    error: error ?? connectError,
    request,
    signature,
    completed,
    connect,
    pay,
    reset,
  };
}
