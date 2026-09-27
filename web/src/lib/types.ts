import type { NetworkId } from "./network";

export type PaymentStatus = "paid" | "pending" | "failed";

/** How the money moved. `payout` is an outbound withdrawal; everything else is inbound. */
export type PaymentType = "agent" | "link" | "invoice" | "transfer" | "payout";

export type RangeDays = 7 | 30 | 90;

/**
 * A payment's amount. USDC is in cents, the ledger's unit (negative for payouts); SOL is a decimal string in SOL,
 * since it has no cents. Kept apart by type so SOL can never be added into USD totals by mistake.
 */
export type PaymentAmount = { currency: "USDC"; cents: number } | { currency: "SOL"; amount: string };

/** A row in the overview's recent activity: a ledger transaction, or an invoice still awaiting payment. */
export interface Payment {
  id: string;
  /** Unix ms, UTC. */
  createdAt: number;
  client: string;
  /** Payer wallet, or the payout destination. Null for a link that any wallet can pay. */
  wallet: string | null;
  /** Ledger rows are USDC; an open invoice is in whatever it asks for. */
  amount: PaymentAmount;
  type: PaymentType;
  status: PaymentStatus;
  memo: string;
  failureReason?: string;
  /** Transaction signature of a ledger row; null for a payout not submitted yet. Absent for open invoices. */
  signature?: string | null;
  /** Solana Pay transfer request, for invoices awaiting payment. */
  paymentUrl?: string;
  /** The buyer's cNFT proof-of-purchase, for a paid order that issues one. */
  receipt?: Receipt;
}

export type TxStatus = "confirmed" | "pending" | "failed";

/** A USDC movement into or out of the merchant wallet. */
export interface LedgerTx {
  /** Null for a payout requested here that hasn't been submitted yet. */
  signature: string | null;
  createdAt: number;
  senderName: string;
  /** Payer wallet, or the destination for payouts. */
  wallet: string | null;
  type: PaymentType;
  /** USDC in cents. Negative for payouts. */
  amountCents: number;
  status: TxStatus;
  memo: string;
  invoiceId?: string;
  /** Program error for failed payments, e.g. the payer agent's ExceedsDailyLimit. */
  failure?: { code: string; message: string };
}

export type InvoiceStatus = "pending" | "paid" | "expired" | "canceled";

/** Why a transaction carrying an invoice's reference didn't count as its payment. */
export type PaymentIssueReason = "token" | "recipient" | "amount" | "failed";

export interface PaymentIssue {
  reason: PaymentIssueReason;
  /** Shown as is, e.g. "Token mismatch: Invoice requires USDC." */
  message: string;
  signature: string;
}

export interface Invoice {
  id: string;
  kind: "invoice" | "link";
  /** Empty for a link that isn't addressed to anyone in particular. */
  client: string;
  memo: string;
  /** In the asset's own units, canonical: "49.99" USDC, "0.5" SOL. Exact, so no floating point. */
  amount: string;
  createdAt: number;
  expiresAt: number;
  paidAt?: number;
  signature?: string;
  /** Set when the merchant cancels the request; from then on nothing watches for its payment. */
  canceledAt?: number;
  /** The latest transaction that carried the reference but paid the wrong token, wallet or amount. */
  issue?: PaymentIssue;
  recipient: string;
  /** SPL mint the payer is asked to pay in (USDC on the invoice's network), or null for native SOL. */
  mint: string | null;
  /** Solana Pay reference key; the paying transaction includes it, which is how payment is detected. */
  reference: string;
  paymentUrl: string;
  /**
   * Live invoices the payment server created: it watches and settles them, and only the wallet they pay, signed
   * in, can cancel them.
   */
  tracked?: boolean;
  /** Set for an order of one of the merchant's products (a Blink purchase, or a sale at the PoS). */
  productId?: string;
  /** What the order sold, as the product read when it was ordered. */
  product?: ProductInfo;
  /** The wallet that paid, read from the settling transaction. */
  payer?: string;
  receipt?: Receipt;
}

/** What a product sells, as its Blink card, the PoS and the buyer's cNFT receipt show it. */
export interface ProductInfo {
  title: string;
  description: string;
  /** Absolute https URL of the product image; null shows the token's generated icon instead. */
  image: string | null;
}

/**
 * A product listing. Its Blink never expires and any number of people can buy from it: every purchase is an order
 * of its own (a fresh invoice with its own reference key), settled and receipted separately.
 */
export interface Product extends ProductInfo {
  id: string;
  network: NetworkId;
  /** The wallet its sales pay. */
  merchant: string;
  /** Price in the asset's own units, canonical: "49.99" USDC, "0.5" SOL. */
  amount: string;
  /** SPL mint it's priced in (USDC on its network), or null for native SOL. */
  mint: string | null;
  createdAt: number;
  /** Set once it's taken off sale: the Blink then shows it as unavailable. */
  archivedAt: number | null;
}

export type ReceiptStatus = "pending" | "minted" | "simulated" | "failed";

/** The compressed NFT a buyer gets as proof of purchase once their order settles (minted with Underdog Protocol). */
export interface Receipt {
  status: ReceiptStatus;
  /** The buyer's wallet: where the cNFT goes. */
  owner: string;
  /** The cNFT's asset address, once Underdog reports it. */
  mintAddress: string | null;
  mintedAt: number | null;
  /** Why the last attempt failed, or why no real cNFT was minted (no Underdog key on this server). */
  note: string | null;
}

/** Where the dashboard's numbers come from right now. */
export type DataMode = "live" | "demo";

export type AgentStatus = "active" | "paused";

/** One of the merchant's own agents and its on-chain spending policy (AgentWallet PDA). */
export interface AgentWallet {
  id: string;
  name: string;
  purpose: string;
  /** Key the agent signs payments with. */
  agent: string;
  owner: string;
  pda: string;
  dailyCapCents: number;
  maxPerTxCents: number;
  spentTodayCents: number;
  status: AgentStatus;
  createdAt: number;
}

export interface DailySettlement {
  /** UTC midnight, Unix ms. */
  day: number;
  volumeCents: number;
  count: number;
}
