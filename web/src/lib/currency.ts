import { formatCount } from "./format";
import { USDC_MINT_DEVNET, USDC_MINT_MAINNET, type NetworkConfig } from "./network";
import { amountToBaseUnits, assetSymbol, formatAmount } from "./solana-pay";

// What an invoice can be paid in, and how an amount in each is written. Shared by the invoice forms and the
// payment server, so a form never accepts an amount the server would refuse, or the other way round.

export type Currency = "USDC" | "SOL";

export interface CurrencySpec {
  code: Currency;
  /** How it moves on-chain, in words for payers. */
  kind: string;
  /** Most decimal places an amount can have. */
  decimals: number;
  /** Decimals of the asset on-chain: base units per whole (lamports for SOL). */
  chainDecimals: number;
  /** What its base units are called, for logs. */
  baseUnit: string;
  /** Smallest and largest amount an invoice can ask for, in the currency's own units. */
  min: string;
  max: string;
  /** For hints: "like 250 or 49.99". */
  examples: readonly [string, string];
  /** One-tap amounts for the quick payment link. */
  presets: readonly string[];
}

export const CURRENCIES: Record<Currency, CurrencySpec> = {
  USDC: {
    code: "USDC",
    kind: "SPL token",
    decimals: 2,
    chainDecimals: 6,
    baseUnit: "USDC base units",
    min: "0.01",
    max: "1000000",
    examples: ["250", "49.99"],
    presets: ["25", "100", "250", "1000"],
  },
  SOL: {
    code: "SOL",
    kind: "native SOL",
    // Lamport precision is 9 decimals; nothing below a millionth of a SOL is worth an invoice.
    decimals: 9,
    chainDecimals: 9,
    baseUnit: "lamports",
    min: "0.000001",
    max: "10000",
    examples: ["0.5", "0.001"],
    presets: ["0.1", "0.5", "1", "5"],
  },
};

/** In the order the forms offer them. */
export const CURRENCY_CODES: readonly Currency[] = ["USDC", "SOL"];

export function isCurrency(value: unknown): value is Currency {
  return value === "USDC" || value === "SOL";
}

/** The mint an invoice in `currency` asks for on `network`: its USDC, or null for native SOL. */
export function currencyMint(currency: Currency, network: NetworkConfig): string | null {
  return currency === "SOL" ? null : network.usdcMint;
}

/** The currency a mint is: null is native SOL. Null for any other token (a link made elsewhere, e.g. USDT). */
export function currencyOfMint(mint: string | null): Currency | null {
  if (mint === null) return "SOL";
  return mint === USDC_MINT_DEVNET || mint === USDC_MINT_MAINNET ? "USDC" : null;
}

/** Base fee of the one-signature transfer a checkout builds, in SOL, for payer-facing copy. */
export const NETWORK_FEE_SOL = "0.000005";

/** What the payer's wallet will do, in a sentence: which kind of transfer, and what it costs on top. */
export function transferInstructions(mint: string | null, amount: string): string {
  const shown = `${formatAmount(amount)} ${assetSymbol(mint)}`;
  if (mint === null) return `A native SOL transfer: your wallet sends exactly ${shown}, plus a network fee of about ${NETWORK_FEE_SOL} SOL.`;
  return `An SPL token transfer: your wallet sends ${shown} and needs a little SOL (about ${NETWORK_FEE_SOL}) for the network fee.`;
}

/** An invoice amount in the asset's base units ("0.5" SOL -> "500000000" lamports), for logs. Null for unknown tokens. */
export function baseUnits(amount: string, mint: string | null): { units: string; unit: string } | null {
  const currency = currencyOfMint(mint);
  if (!currency) return null;
  const spec = CURRENCIES[currency];
  return { units: amountToBaseUnits(amount, spec.chainDecimals).toString(), unit: spec.baseUnit };
}

export type AmountCheck = { ok: true; amount: string } | { ok: false; error: string };

/**
 * Reads an amount a person typed ("1,250.5", ".001") for `currency`. On success `amount` is canonical: no
 * separators, no leading or trailing zeros, which is how Solana Pay links and the payment server want it.
 */
export function parseAmount(input: string, currency: Currency): AmountCheck {
  const spec = CURRENCIES[currency];
  const fail = (error: string): AmountCheck => ({ ok: false, error });
  const match = /^(\d{0,9})(?:\.(\d*))?$/.exec(input.trim().replace(/,/g, ""));
  if (!match || (!match[1] && !match[2])) return fail(`Enter an amount in ${currency}, like ${spec.examples[0]} or ${spec.examples[1]}.`);

  const fraction = (match[2] ?? "").replace(/0+$/, "");
  if (fraction.length > spec.decimals) {
    return fail(`${currency} amounts go to ${spec.decimals} decimal places at most, like ${spec.examples[1]}.`);
  }
  const whole = (match[1] || "0").replace(/^0+(?=\d)/, "");
  const amount = fraction ? `${whole}.${fraction}` : whole;

  const units = amountToBaseUnits(amount, spec.decimals);
  if (units < amountToBaseUnits(spec.min, spec.decimals)) return fail(`The smallest ${currency} amount is ${spec.min}.`);
  if (units > amountToBaseUnits(spec.max, spec.decimals)) return fail(`Invoices go up to ${formatCount(Number(spec.max))} ${currency}.`);
  return { ok: true, amount };
}

/** Whether two amounts are the same number, however they're written ("1.50" and "1.5"). */
export function sameAmount(a: string, b: string): boolean {
  const decimals = Math.max(a.split(".")[1]?.length ?? 0, b.split(".")[1]?.length ?? 0);
  try {
    return amountToBaseUnits(a, decimals) === amountToBaseUnits(b, decimals);
  } catch {
    return false;
  }
}
