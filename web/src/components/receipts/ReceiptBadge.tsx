"use client";

import { ExternalLink } from "lucide-react";

import { cn } from "@/lib/cn";
import { truncateAddress } from "@/lib/format";
import { assetExplorer } from "@/lib/network";
import { useNetwork } from "@/lib/settings";
import type { Receipt } from "@/lib/types";

/** Solana's three bars, drawn in the badge's own color. */
function SolanaMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("shrink-0", className)} fill="currentColor">
      <path d="M10 9.4h14.6l-2.6 2.9H7.4z" />
      <path d="M7.4 14.55H22l2.6 2.9H10z" />
      <path d="M10 19.7h14.6l-2.6 2.9H7.4z" />
    </svg>
  );
}

// Receipts take the purple of links and orders (the Active links card); simulated and failed ones step back to slate
// and red, since they aren't a cNFT anyone holds.
const TONES: Record<Receipt["status"], string> = {
  minted: "border-purple-500/30 bg-purple-500/10 text-purple-300 light:border-purple-200 light:bg-purple-50 light:text-purple-700",
  pending: "border-purple-500/20 bg-purple-500/5 text-purple-300/80 light:border-purple-200 light:bg-purple-50/60 light:text-purple-700/80",
  simulated: "border-idle-line bg-idle-bg text-idle",
  failed: "border-danger-line bg-danger-bg text-danger",
};

const LABELS: Record<Receipt["status"], { short: string; long: string }> = {
  minted: { short: "cNFT minted", long: "cNFT receipt minted" },
  pending: { short: "cNFT minting", long: "Minting cNFT receipt" },
  simulated: { short: "cNFT simulated", long: "cNFT receipt simulated" },
  failed: { short: "cNFT failed", long: "cNFT receipt failed" },
};

function describe(receipt: Receipt): string {
  const to = `to ${truncateAddress(receipt.owner, 5)}`;
  if (receipt.status === "minted") return `Proof-of-purchase cNFT minted on Solana ${to}${receipt.mintAddress ? `. Asset ${receipt.mintAddress}` : ""}`;
  if (receipt.status === "pending") return `The buyer's proof-of-purchase cNFT is being minted ${to}.`;
  return receipt.note ?? `No cNFT was minted ${to}.`;
}

/**
 * The buyer's cNFT proof-of-purchase: "cNFT minted · Solana", linked to the asset on Solscan once Underdog reports
 * its address. `compact` is the table's size. The tooltip names the buyer's wallet and the asset.
 */
export function ReceiptBadge({ receipt, compact = false, className }: { receipt: Receipt; compact?: boolean; className?: string }) {
  const network = useNetwork();
  const label = LABELS[receipt.status];
  const explorer = receipt.status === "minted" && receipt.mintAddress ? assetExplorer(receipt.mintAddress, network) : null;
  const classes = cn(
    "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded border font-mono font-medium leading-none",
    compact ? "h-[18px] px-1.5 text-[10.5px]" : "h-6 px-2 text-[11.5px]",
    TONES[receipt.status],
    explorer && "transition-colors hover:border-purple-400/60 hover:text-purple-200 light:hover:text-purple-800",
    className,
  );
  const content = (
    <>
      <SolanaMark className={compact ? "size-2.5" : "size-3"} />
      {compact ? label.short : label.long}
      {receipt.status === "pending" && <span aria-hidden className="size-1 rounded-full bg-current motion-safe:animate-pulse" />}
      {!compact && receipt.status === "minted" && <span className="font-normal opacity-70">· Solana</span>}
      {explorer && <ExternalLink className={compact ? "size-2.5" : "size-3"} aria-hidden />}
    </>
  );

  const title = describe(receipt);
  return explorer ? (
    <a href={explorer.url} target="_blank" rel="noopener noreferrer" title={`${title} · open on ${explorer.name}`} aria-label={`${label.long} on Solana: open on ${explorer.name} (new tab)`} className={classes}>
      {content}
    </a>
  ) : (
    <span title={title} className={classes}>
      {content}
    </span>
  );
}
