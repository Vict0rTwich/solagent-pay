import { PROGRAM_ID, findAgentWalletPda as findPda } from "@solagent-pay/sdk";
import { Keypair, PublicKey } from "@solana/web3.js";

/** Agent wallet PDA, derived by the SDK with the program's seeds: [AGENT_WALLET_SEED, owner, agent]. */
export function findAgentWalletPda(owner: string, agent: string): string {
  return findPda(new PublicKey(owner), new PublicKey(agent), PROGRAM_ID)[0].toBase58();
}

export function newAgentKey(): string {
  return Keypair.generate().publicKey.toBase58();
}

/** USDC cents to on-chain base units (6 decimals). */
export function toBaseUnits(cents: number): number {
  return cents * 10_000;
}

/** Mirrors the program's policy checks; returns the error to show, or null if the policy is valid. */
export function policyError(maxPerTxCents: number, dailyCapCents: number): string | null {
  if (dailyCapCents <= 0) return "The daily cap has to be more than $0.";
  if (maxPerTxCents <= 0) return "The per-payment limit has to be more than $0.";
  if (maxPerTxCents > dailyCapCents) return "InvalidPolicy: the per-payment limit can't be higher than the daily cap.";
  return null;
}
