import { PublicKey } from "@solana/web3.js";

import { randomBase58 } from "./base58";
import { truncateAddress } from "./format";
import { USDC_MINT_DEVNET, USDC_MINT_MAINNET, USDT_MINT_MAINNET, type NetworkId } from "./network";

/** Native SOL has 9 decimals (lamports). */
export const SOL_DECIMALS = 9;

/**
 * Parses a USDC amount typed by a person ("250", "49.99") into cents.
 * Returns null for anything that isn't a positive amount with at most two decimals.
 */
export function parseUsdcCents(input: string): number | null {
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(input.trim().replace(/,/g, ""));
  if (!match) return null;
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? "").padEnd(2, "0"));
  const cents = whole * 100 + fraction;
  return cents > 0 ? cents : null;
}

/** 25000 -> "250", 4999 -> "49.99", 5 -> "0.05" (Solana Pay wants no trailing zeros or exponent). */
export function centsToAmount(cents: number): string {
  const whole = Math.floor(cents / 100);
  const fraction = String(cents % 100).padStart(2, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

/** "25.5" at 6 decimals -> 25_500_000n. Exact, with no floating point; throws past the token's precision. */
export function amountToBaseUnits(amount: string, decimals: number): bigint {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(amount);
  if (!match) throw new Error(`"${amount}" isn't a valid amount.`);
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) throw new Error(`${amount} has more than ${decimals} decimal places.`);
  return BigInt(`${match[1]}${fraction.padEnd(decimals, "0")}`);
}

/** 25_500_000n at 6 decimals -> "25.50": at least two decimals, and no trailing zeros past them. */
export function formatBaseUnits(units: bigint, decimals: number): string {
  const digits = (units < 0n ? -units : units).toString().padStart(decimals + 1, "0");
  const whole = BigInt(digits.slice(0, digits.length - decimals)).toLocaleString("en-US");
  const fraction = digits.slice(digits.length - decimals).replace(/0+$/, "").padEnd(Math.min(2, decimals), "0");
  return `${units < 0n ? "−" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

/** A link's amount for display: "1250.5" -> "1,250.50". */
export function formatAmount(amount: string): string {
  const decimals = Math.max(2, amount.split(".")[1]?.length ?? 0);
  return formatBaseUnits(amountToBaseUnits(amount, decimals), decimals);
}

/** Ticker for a payment asset; `null` is native SOL. */
export function assetSymbol(mint: string | null): string {
  if (mint === null) return "SOL";
  if (mint === USDC_MINT_DEVNET || mint === USDC_MINT_MAINNET) return "USDC";
  if (mint === USDT_MINT_MAINNET) return "USDT";
  return `token ${truncateAddress(mint)}`;
}

/** A fresh reference key; the payer's transaction includes it so the payment can be found on-chain. */
export function createReference(): string {
  return randomBase58(32);
}

export interface TransferRequest {
  recipient: string;
  /** In the asset's own units, canonical ("0.5", "49.99"): no exponent, no trailing zeros. */
  amount: string;
  /** SPL mint to pay in (the network's USDC), or null for native SOL. */
  splToken: string | null;
  reference: string;
  label: string;
  /** Shown to the payer in their wallet. */
  message?: string;
  /** Written on-chain in an SPL Memo, so keep it free of private details. */
  memo?: string;
}

/** Builds a Solana Pay transfer request URL. Throws if the recipient, token or reference isn't a valid address. */
export function buildTransferRequest(request: TransferRequest): string {
  if (!/^\d+(\.\d+)?$/.test(request.amount)) throw new Error(`"${request.amount}" isn't a Solana Pay amount.`);
  const recipient = new PublicKey(request.recipient).toBase58();
  const params = [`amount=${request.amount}`];
  // No spl-token means native SOL, per the Solana Pay spec.
  if (request.splToken !== null) params.push(`spl-token=${new PublicKey(request.splToken).toBase58()}`);
  params.push(`reference=${new PublicKey(request.reference).toBase58()}`, `label=${encodeURIComponent(request.label)}`);
  if (request.message) params.push(`message=${encodeURIComponent(request.message)}`);
  if (request.memo) params.push(`memo=${encodeURIComponent(request.memo)}`);
  return `solana:${recipient}?${params.join("&")}`;
}

/** Path of the hosted checkout page; its query is the transfer request plus `cluster`. */
export const CHECKOUT_PATH = "/pay";

/**
 * The https link to share: it opens the checkout page, where a payer at a computer pays with their browser
 * wallet and a phone can open the `solana:` link in a wallet app. Desktop browsers can't open `solana:` links.
 */
export function buildCheckoutUrl(origin: string, paymentUrl: string, network: NetworkId): string {
  const rest = paymentUrl.slice("solana:".length);
  const queryStart = rest.indexOf("?");
  const recipient = queryStart < 0 ? rest : rest.slice(0, queryStart);
  const query = queryStart < 0 ? "" : `&${rest.slice(queryStart + 1)}`;
  return `${origin}${CHECKOUT_PATH}?recipient=${recipient}${query}&cluster=${network}`;
}

/** The `solana:` transfer request a checkout page's query describes, or null without a recipient. */
export function paymentUrlFromCheckout(params: URLSearchParams): string | null {
  const recipient = params.get("recipient");
  if (!recipient) return null;
  // Percent-encoding (not URLSearchParams' "+" for spaces), which is what wallets expect in a Solana Pay URL.
  const query = [...params.entries()]
    .filter(([key]) => key !== "recipient" && key !== "cluster")
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");
  return `solana:${encodeURIComponent(recipient)}${query ? `?${query}` : ""}`;
}

/** A Solana Pay transfer request, as a wallet reads it from the link. */
export interface ParsedTransferRequest {
  recipient: PublicKey;
  /** In the asset's own units ("25.5"); null when the payer chooses. */
  amount: string | null;
  /** SPL mint to pay in; null means native SOL. */
  splToken: PublicKey | null;
  references: PublicKey[];
  label: string | null;
  message: string | null;
  memo: string | null;
}

/**
 * Reads a `solana:<recipient>?amount=…&spl-token=…&reference=…` transfer request.
 * Throws for anything else, including transaction requests (`solana:https://…`).
 */
export function parseTransferRequest(url: string): ParsedTransferRequest {
  if (!url.startsWith("solana:")) throw new Error("This isn't a Solana Pay link.");
  const rest = url.slice("solana:".length);
  const queryStart = rest.indexOf("?");
  const path = decodeURIComponent(queryStart < 0 ? rest : rest.slice(0, queryStart));
  const params = new URLSearchParams(queryStart < 0 ? "" : rest.slice(queryStart + 1));

  const address = (value: string, what: string): PublicKey => {
    try {
      return new PublicKey(value);
    } catch {
      throw new Error(`The link's ${what} isn't a valid Solana address.`);
    }
  };

  const amount = params.get("amount");
  if (amount !== null && !/^\d+(\.\d+)?$/.test(amount)) throw new Error("The link's amount isn't a valid number.");
  const splToken = params.get("spl-token");

  return {
    recipient: address(path, "recipient"),
    amount,
    splToken: splToken ? address(splToken, "token") : null,
    references: params.getAll("reference").map((reference) => address(reference, "reference")),
    label: params.get("label"),
    message: params.get("message"),
    memo: params.get("memo"),
  };
}
