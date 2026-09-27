import { ArrowDownLeft, ArrowUpRight, Bot, FileText, Link2, type LucideIcon } from "lucide-react";

import { Badge, type Tone } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";
import { formatUsdc } from "@/lib/format";
import { formatAmount } from "@/lib/solana-pay";
import type { InvoiceStatus, PaymentAmount, PaymentStatus, PaymentType, TxStatus } from "@/lib/types";

export const PAYMENT_TYPES: Record<PaymentType, { label: string; icon: LucideIcon }> = {
  agent: { label: "AI agent", icon: Bot },
  link: { label: "Payment link", icon: Link2 },
  invoice: { label: "Invoice", icon: FileText },
  transfer: { label: "Direct transfer", icon: ArrowDownLeft },
  payout: { label: "Payout", icon: ArrowUpRight },
};

/** A feed row's amount without its ticker: "1,250.00" USDC (−… for payouts), "0.75" SOL. */
export function formatPaymentAmount(amount: PaymentAmount): string {
  return amount.currency === "USDC" ? formatUsdc(amount.cents) : formatAmount(amount.amount);
}

interface StatusMeta {
  label: string;
  tone: Tone;
}

const PAYMENT_STATUSES: Record<PaymentStatus, StatusMeta> = {
  paid: { label: "Paid", tone: "success" },
  pending: { label: "Pending", tone: "warning" },
  failed: { label: "Failed", tone: "danger" },
};

const INVOICE_STATUSES: Record<InvoiceStatus, StatusMeta> = {
  paid: { label: "Paid", tone: "success" },
  pending: { label: "Pending", tone: "warning" },
  expired: { label: "Expired", tone: "neutral" },
  canceled: { label: "Canceled", tone: "neutral" },
};

const TX_STATUSES: Record<TxStatus, StatusMeta> = {
  confirmed: { label: "Confirmed", tone: "success" },
  pending: { label: "Pending", tone: "warning" },
  failed: { label: "Failed", tone: "danger" },
};

function MetaBadge({ meta }: { meta: StatusMeta }) {
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

export function StatusBadge({ status }: { status: PaymentStatus }) {
  return <MetaBadge meta={PAYMENT_STATUSES[status]} />;
}

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  return <MetaBadge meta={INVOICE_STATUSES[status]} />;
}

export function TxStatusBadge({ status }: { status: TxStatus }) {
  return <MetaBadge meta={TX_STATUSES[status]} />;
}

/** Payment type as plain text with its icon: a column value, not a status, so no pill. AI agents read brighter. */
export function TypeBadge({ type }: { type: PaymentType }) {
  const { label, icon: Icon } = PAYMENT_TYPES[type];
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap text-[13px]", type === "agent" ? "text-ink" : "text-ink-2")}>
      <Icon className="size-3.5 shrink-0 text-accent-ink" aria-hidden />
      {label}
    </span>
  );
}
