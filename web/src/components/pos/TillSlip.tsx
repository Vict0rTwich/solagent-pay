"use client";

import { QrCode } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import { formatCountdown, formatDateTime, truncateAddress } from "@/lib/format";
import { assetSymbol, formatAmount } from "@/lib/solana-pay";
import type { Invoice, Receipt } from "@/lib/types";

// The customer's side of the register: a till slip printed for each sale, with the Solana Pay QR code on it. White
// paper and near-black ink in both themes, the contrast wallet scanners read best, and the one place the PoS is
// allowed to look like an object: a slot it prints from, a torn edge, and a stamp when the payment lands.

const PAPER = "#F7F8FB";
const INK = "#0B1121";

export type SlipView =
  | { kind: "idle"; preview: { amount: string; symbol: string } | null }
  | { kind: "charging"; invoice: Invoice; detected: boolean; note: string; expiresIn: number | null }
  | { kind: "paid"; invoice: Invoice; resetMs: number }
  | { kind: "closed"; invoice: Invoice; status: "expired" | "canceled" };

function itemName(invoice: Invoice): string {
  return invoice.product?.title || invoice.memo || "Counter sale";
}

function Rule() {
  return <div aria-hidden className="my-3.5 border-t border-dashed border-[#C3CBDB]" />;
}

function SolanaMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={className} fill="currentColor">
      <path d="M10 9.4h14.6l-2.6 2.9H7.4z" />
      <path d="M7.4 14.55H22l2.6 2.9H10z" />
      <path d="M10 19.7h14.6l-2.6 2.9H7.4z" />
    </svg>
  );
}

function receiptText(receipt: Receipt | undefined, payer: string | undefined): string {
  const to = receipt ? truncateAddress(receipt.owner, 4) : payer ? truncateAddress(payer, 4) : null;
  if (!receipt) return to ? `Paid by ${to}` : "Payment confirmed";
  if (receipt.status === "minted") return `cNFT receipt minted to ${to}`;
  if (receipt.status === "pending") return `Minting cNFT receipt to ${to}…`;
  if (receipt.status === "simulated") return `cNFT receipt simulated for ${to}`;
  return `cNFT receipt pending retry for ${to}`;
}

export function TillSlip({ view, networkLabel }: { view: SlipView; networkLabel: string }) {
  const invoice = view.kind === "idle" ? null : view.invoice;
  const amount = invoice ? formatAmount(invoice.amount) : view.kind === "idle" && view.preview ? view.preview.amount : "0.00";
  const symbol = invoice ? assetSymbol(invoice.mint) : view.kind === "idle" && view.preview ? view.preview.symbol : "USDC";
  const muted = view.kind === "idle" || view.kind === "closed";

  return (
    <div className="w-full max-w-[360px]">
      {/* The printer slot the slip comes out of. */}
      <div aria-hidden className="relative z-10 -mx-3 h-3 rounded-full border border-line-strong bg-[#04070f] shadow-[inset_0_2px_3px_rgb(0_0_0/0.6)]" />
      <div
        key={invoice?.reference ?? "idle"}
        className="slip slip-print relative -mt-1.5 px-6 pb-8 pt-5"
        style={{ background: PAPER, color: INK }}
        role="region"
        aria-label="Customer display"
        aria-live="polite"
      >
        <div className="flex items-baseline justify-between gap-3 font-mono text-[10.5px] uppercase tracking-[0.18em] text-[#4B5875]">
          <span>SolAgent Pay</span>
          <span className="tracking-[0.08em]">{invoice ? invoice.id : "Register"}</span>
        </div>
        <p className="mt-1 font-mono text-[10.5px] text-[#6B7894]">{invoice ? `${formatDateTime(invoice.createdAt)} UTC · ${networkLabel}` : networkLabel}</p>

        <Rule />

        {invoice && (
          <div className="flex items-baseline justify-between gap-4 text-[13px]">
            <span className="min-w-0 truncate">{itemName(invoice)}</span>
            <span className="shrink-0 font-mono tabular-nums">
              {amount} {symbol}
            </span>
          </div>
        )}
        <div className={cn("flex items-end justify-between gap-3", invoice && "mt-3")}>
          <span className="pb-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-[#4B5875]">Total</span>
          <span className={cn("min-w-0 text-right font-mono tabular-nums leading-none tracking-[-0.04em]", muted && "text-[#8A96AE]")}>
            <span className="text-[40px] font-medium">{amount}</span>
            <span className="ml-1.5 text-sm tracking-normal">{symbol}</span>
          </span>
        </div>

        <Rule />

        <div className="relative mx-auto aspect-square w-full max-w-[212px]">
          {view.kind === "idle" ? (
            <div className="grid size-full place-items-center rounded-lg border-2 border-dashed border-[#C3CBDB] text-[#8A96AE]">
              <div className="flex flex-col items-center gap-2 text-center">
                <QrCode className="size-8" strokeWidth={1.5} aria-hidden />
                <span className="px-6 text-xs">The QR code prints here when you charge</span>
              </div>
            </div>
          ) : view.kind === "closed" ? (
            <div className="grid size-full place-items-center rounded-lg border-2 border-dashed border-[#C3CBDB] px-6 text-center text-[13px] text-[#4B5875]">
              {view.status === "expired" ? "This charge expired before it was paid." : "This charge was canceled."}
            </div>
          ) : (
            <>
              <QRCodeSVG
                value={view.invoice.paymentUrl}
                size={472}
                level="M"
                marginSize={0}
                bgColor={PAPER}
                fgColor={INK}
                title={`Solana Pay QR code for ${view.invoice.id}`}
                className={cn("size-full transition-opacity duration-300", view.kind === "paid" && "opacity-[0.12]")}
              />
              {view.kind === "paid" && (
                <div className="stamp pointer-events-none rounded-md border-[3px] border-[#059669] px-5 py-1.5 font-mono text-[38px] font-bold uppercase leading-none tracking-[0.2em] text-[#059669] shadow-[inset_0_0_0_3px_#F7F8FB,inset_0_0_0_4.5px_#059669]">
                  Paid
                </div>
              )}
            </>
          )}
        </div>

        <div className="mt-3.5 min-h-[44px]">
          <SlipStatus view={view} />
        </div>

        <Rule />
        <p className="text-center font-mono text-[10.5px] leading-relaxed text-[#6B7894]">
          Scan with any Solana wallet
          <br />
          Phantom · Solflare · Backpack
        </p>
      </div>
    </div>
  );
}

function StatusRow({ dot, children, trailing }: { dot: string; children: ReactNode; trailing?: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 text-[13px]">
      <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", dot)} />
      <div className="min-w-0 flex-1">{children}</div>
      {trailing}
    </div>
  );
}

function SlipStatus({ view }: { view: SlipView }) {
  if (view.kind === "idle") {
    return (
      <StatusRow dot="bg-[#C3CBDB]">
        <p className="font-medium">Ready for the next sale</p>
        <p className="mt-0.5 text-xs text-[#6B7894]">Enter an amount or pick a product.</p>
      </StatusRow>
    );
  }
  if (view.kind === "closed") {
    return (
      <StatusRow dot="bg-[#8A96AE]">
        <p className="font-medium">{view.status === "expired" ? "Expired" : "Canceled"}</p>
        <p className="mt-0.5 text-xs text-[#6B7894]">Nothing was charged. Start a new sale.</p>
      </StatusRow>
    );
  }
  if (view.kind === "charging") {
    return (
      <StatusRow
        dot={view.detected ? "bg-[#D97706] motion-safe:animate-pulse" : "bg-[#2563EB] motion-safe:animate-pulse"}
        trailing={
          view.expiresIn !== null && (
            <span className="shrink-0 font-mono text-xs tabular-nums text-[#4B5875]" title="Time left to pay">
              {formatCountdown(view.expiresIn)}
            </span>
          )
        }
      >
        <p className="font-medium">{view.detected ? "Payment detected, confirming…" : "Waiting for customer scan…"}</p>
        <p className="mt-0.5 text-xs text-[#6B7894]">{view.note}</p>
      </StatusRow>
    );
  }

  const { invoice } = view;
  return (
    <div>
      <StatusRow dot="bg-[#059669]">
        <p className="font-medium text-[#047857]">
          Paid{invoice.paidAt !== undefined && <span className="font-mono text-xs font-normal text-[#4B5875]"> · {formatDateTime(invoice.paidAt)} UTC</span>}
        </p>
        <p className="mt-0.5 flex items-center gap-1 text-xs text-[#6D28D9]">
          <SolanaMark className="size-3 shrink-0" />
          {receiptText(invoice.receipt, invoice.payer)}
        </p>
      </StatusRow>
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-[#DDE3EE]" aria-hidden>
        <div className="drain h-full rounded-full bg-[#059669]" style={{ animationDuration: `${view.resetMs}ms` }} />
      </div>
    </div>
  );
}
