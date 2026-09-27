"use client";

import { ArrowUpRight, Clock, ExternalLink, Plus } from "lucide-react";
import { useState } from "react";

import { Figure } from "@/components/ui/Figure";
import { TokenIcon } from "@/components/ui/TokenIcon";
import { useDashboard, useDashboardMetrics } from "@/lib/dashboard-store";
import { formatUsd, formatUsdc } from "@/lib/format";
import { explorerAddressUrl } from "@/lib/network";
import { useNetwork } from "@/lib/settings";

import { requestNewInvoice } from "./QuickInvoiceWidget";
import { SettlementRail } from "./SettlementRail";
import { WithdrawDialog } from "./WithdrawDialog";

const secondaryClass =
  "btn-ghost inline-flex h-9 min-w-[7.5rem] flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-3 text-[13px] font-medium";

export function BalanceCard() {
  const { balanceCents, pendingPayoutCents, source } = useDashboard();
  const { todaySettled, today, now } = useDashboardMetrics();
  const network = useNetwork();
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  // Live payments land straight in the connected wallet, so there's nothing to withdraw.
  const liveOwner = source.mode === "live" ? source.owner : null;

  return (
    <section aria-labelledby="balance-heading" className="card flex h-full flex-col p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 id="balance-heading" className="text-[13px] font-medium text-ink">
          Merchant balance
        </h2>
        <span className="inline-flex items-center gap-1.5 rounded-md border border-line bg-canvas px-1.5 py-0.5 font-mono text-[10.5px] text-ink-3">
          <TokenIcon currency="USDC" className="size-3" />
          USDC · SPL
        </span>
      </div>

      <p className="mt-4 text-[2.25rem] font-medium leading-none tracking-[-0.04em] text-ink">
        <Figure value={formatUsd(balanceCents)} />
      </p>
      <p className="mt-2.5 flex flex-wrap items-center gap-x-1.5 text-[13px] text-ink-2">
        {liveOwner ? `In your wallet on ${network.label}` : "Available to withdraw"}
        {pendingPayoutCents > 0 && (
          <span className="inline-flex items-center gap-1 text-warning">
            <span className="text-ink-3">·</span>
            <Clock className="size-3.5" aria-hidden />
            <span className="font-mono">{formatUsdc(pendingPayoutCents)}</span> payout pending
          </span>
        )}
      </p>

      <SettlementRail className="mt-6 border-t border-line pt-5" payments={todaySettled} dayStart={today} now={now} />

      <div className="mt-auto flex flex-wrap gap-2 pt-6">
        <button
          type="button"
          onClick={requestNewInvoice}
          className="btn-primary inline-flex h-9 min-w-[7.5rem] flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-3 text-[13px]"
        >
          <Plus className="size-4" strokeWidth={2.25} aria-hidden />
          Create invoice
        </button>
        {liveOwner ? (
          <a href={explorerAddressUrl(liveOwner, network)} target="_blank" rel="noopener noreferrer" className={secondaryClass}>
            <ExternalLink className="size-3.5" aria-hidden />
            View wallet
          </a>
        ) : (
          <button type="button" onClick={() => setWithdrawOpen(true)} className={secondaryClass}>
            <ArrowUpRight className="size-3.5" aria-hidden />
            Withdraw
          </button>
        )}
      </div>

      {!liveOwner && <WithdrawDialog open={withdrawOpen} onClose={() => setWithdrawOpen(false)} />}
    </section>
  );
}
