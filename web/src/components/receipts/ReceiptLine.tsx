"use client";

import { LoaderCircle, RotateCcw } from "lucide-react";
import { useState } from "react";

import { useDashboard } from "@/lib/dashboard-store";
import { truncateAddress } from "@/lib/format";
import { describeApiError } from "@/lib/invoice-api";
import type { Invoice } from "@/lib/types";

import { ReceiptBadge } from "./ReceiptBadge";

/**
 * A paid invoice's buyer and their cNFT receipt, for the merchant's paid views. A failed receipt, or one only
 * simulated (no Underdog key at the time), can be minted again from here.
 */
export function ReceiptLine({ invoice }: { invoice: Invoice }) {
  const { mintReceipt } = useDashboard();
  const [minting, setMinting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const receipt = invoice.receipt;
  if (!invoice.payer && !receipt) return null;
  const retryable =
    invoice.tracked === true && (receipt ? receipt.status === "failed" || receipt.status === "simulated" : invoice.payer !== undefined);

  const mint = async () => {
    setMinting(true);
    setError(null);
    try {
      await mintReceipt(invoice);
    } catch (failure) {
      setError(describeApiError(failure));
    } finally {
      setMinting(false);
    }
  };

  return (
    <div className="mt-3 border-t border-line pt-3 text-xs text-ink-3">
      {invoice.payer && (
        <p>
          Paid by{" "}
          <span className="font-mono text-ink-2" title={invoice.payer}>
            {truncateAddress(invoice.payer, 6)}
          </span>
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {receipt ? <ReceiptBadge receipt={receipt} /> : <span>No cNFT receipt was issued for this payment.</span>}
        {retryable && (
          <button
            type="button"
            onClick={() => void mint()}
            disabled={minting}
            className="btn-ghost inline-flex h-6 items-center gap-1 rounded-md px-2 text-[11.5px] font-medium disabled:cursor-wait disabled:opacity-60"
          >
            {minting ? <LoaderCircle className="size-3 animate-spin" aria-hidden /> : <RotateCcw className="size-3" aria-hidden />}
            {receipt ? "Mint again" : "Mint receipt"}
          </button>
        )}
      </div>
      {receipt && receipt.status !== "minted" && receipt.note && <p className="mt-1.5 leading-relaxed">{receipt.note}</p>}
      {error && (
        <p role="alert" className="mt-1.5 text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
