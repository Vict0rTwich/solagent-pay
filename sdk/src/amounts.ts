import { BN } from "@coral-xyz/anchor";

/** Parses a decimal string like "1.25" into base units without going through floating point. */
export function toBaseUnits(amount: string, decimals: number): BN {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(amount.trim());
  if (!match) {
    throw new Error(`Invalid amount "${amount}": expected a non-negative decimal like "1.25"`);
  }
  const [, whole, fraction = ""] = match;
  if (fraction.length > decimals) {
    throw new Error(`Amount "${amount}" has more than ${decimals} decimal places`);
  }
  return new BN(whole + fraction.padEnd(decimals, "0"));
}

export function fromBaseUnits(amount: BN, decimals: number): string {
  const digits = amount.toString().padStart(decimals + 1, "0");
  if (decimals === 0) return digits;
  const whole = digits.slice(0, -decimals);
  const fraction = digits.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}
