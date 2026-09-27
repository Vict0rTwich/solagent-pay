import { AnchorProvider } from "@coral-xyz/anchor";
import { PROGRAM_ID, SolAgentPayClient, type AgentWalletStatus } from "@solagent-pay/sdk";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey, type Connection, type ParsedTransactionWithMeta } from "@solana/web3.js";

import { truncateAddress } from "./format";
import { balanceDelta } from "./invoice-payments";
import type { AgentWallet, Invoice, LedgerTx } from "./types";

// Reads the connected merchant's real data from the chain: USDC balance, recent USDC transfers,
// and agent wallets (through @solagent-pay/sdk). Invoice payments are checked in invoice-payments.ts.

export const LIVE_TIMEOUT_MS = 12_000;
/** Transfers listed in the ledger. */
export const LEDGER_LIMIT = 15;

// The public devnet RPC rate-limits getTransaction hard (a batch of 20 gets ~half rejected), so
// details are fetched a few at a time within a time budget; anything left over loads on the next refresh.
const PARSE_CONCURRENCY = 4;
const PARSE_BUDGET_MS = 6_000;
const PER_TX_TIMEOUT_MS = 4_000;

export class TimeoutError extends Error {}

export function withTimeout<T>(promise: Promise<T>, ms = LIVE_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(`The RPC didn't answer within ${ms / 1000} seconds.`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function describeError(error: unknown): string {
  if (error instanceof TimeoutError) return error.message;
  const message = error instanceof Error ? error.message : String(error);
  if (/429|too many requests/i.test(message)) return "The public RPC is rate-limiting requests. Try again in a moment.";
  if (/failed to fetch|network|ECONN/i.test(message)) return "Couldn't reach the RPC endpoint.";
  return message.length > 160 ? `${message.slice(0, 157)}…` : message;
}

/** SDK client for reads. Listing accounts never signs, so the wallet refuses to. */
export function readOnlyClient(connection: Connection, owner: PublicKey): SolAgentPayClient {
  const wallet = {
    publicKey: owner,
    signTransaction: () => Promise.reject(new Error("This client is read-only")),
    signAllTransactions: () => Promise.reject(new Error("This client is read-only")),
  };
  return new SolAgentPayClient(new AnchorProvider(connection, wallet, { commitment: "confirmed" }));
}

/** Decimal token string ("183.4") to cents. */
function toCents(amount: string): number {
  return Math.round(Number(amount) * 100);
}

/** Base units to cents for a mint with `decimals` decimals (6 for USDC). */
function baseUnitsToCents(amount: bigint, decimals: number): number {
  return decimals >= 2 ? Number(amount / 10n ** BigInt(decimals - 2)) : Number(amount * 10n ** BigInt(2 - decimals));
}

export function toAgentWallet(status: AgentWalletStatus): AgentWallet {
  return {
    id: status.address,
    name: `Agent ${truncateAddress(status.agent)}`,
    purpose: `Vault holds ${status.balance} USDC`,
    agent: status.agent,
    owner: status.owner,
    pda: status.address,
    dailyCapCents: toCents(status.dailyLimit),
    maxPerTxCents: toCents(status.maxPerTx),
    spentTodayCents: toCents(status.spentInWindow),
    status: status.paused ? "paused" : "active",
    createdAt: 0,
  };
}

/** USDC in the owner's associated token account, in cents. Zero if the account doesn't exist yet. */
export async function fetchUsdcBalanceCents(connection: Connection, owner: PublicKey, mint: PublicKey): Promise<number> {
  const ata = getAssociatedTokenAddressSync(mint, owner, true);
  const { value } = await connection.getParsedAccountInfo(ata, "confirmed");
  if (!value || !("parsed" in value.data)) return 0;
  const amount = value.data.parsed?.info?.tokenAmount as { amount?: string; decimals?: number } | undefined;
  return amount?.amount ? baseUnitsToCents(BigInt(amount.amount), amount.decimals ?? 6) : 0;
}


function memoOf(tx: ParsedTransactionWithMeta): string {
  for (const ix of tx.transaction.message.instructions) {
    if ("parsed" in ix && ix.program === "spl-memo" && typeof ix.parsed === "string") return ix.parsed;
  }
  return "";
}

/** One ledger row for a transaction that moved USDC in or out of `ata`, or null if it didn't. */
function toLedgerTx(
  tx: ParsedTransactionWithMeta,
  signature: string,
  ata: PublicKey,
  mint: PublicKey,
  invoices: readonly Invoice[],
): LedgerTx | null {
  const mintKey = mint.toBase58();
  const accountIndex = tx.transaction.message.accountKeys.findIndex((k) => k.pubkey.equals(ata));
  if (accountIndex < 0) return null;

  const delta = balanceDelta(tx, accountIndex, mintKey);
  const failed = tx.meta?.err != null;
  if (delta === 0n && !failed) return null; // e.g. only created the token account

  const decimals = tx.meta?.postTokenBalances?.find((b) => b.mint === mintKey)?.uiTokenAmount.decimals ?? 6;
  // Counterparty: the other account of this mint whose balance moved the opposite way.
  const counterparty =
    tx.meta?.postTokenBalances?.find(
      (b) => b.mint === mintKey && b.accountIndex !== accountIndex && balanceDelta(tx, b.accountIndex, mintKey) * delta < 0n,
    )?.owner ?? null;
  const viaProgram = tx.transaction.message.instructions.some((ix) => ix.programId.equals(PROGRAM_ID));
  const memo = memoOf(tx);
  const invoice = invoices.find((inv) => inv.id === memo);

  return {
    signature,
    createdAt: (tx.blockTime ?? Math.floor(Date.now() / 1000)) * 1000,
    // The address itself is shown on the wallet line, so the name describes the movement instead.
    senderName:
      invoice?.client || invoice?.product?.title || (delta < 0n ? "Outgoing transfer" : viaProgram ? "SolAgent agent" : "Incoming transfer"),
    wallet: counterparty,
    type: delta < 0n ? "payout" : viaProgram ? "agent" : invoice ? invoice.kind : "transfer",
    amountCents: baseUnitsToCents(delta, decimals),
    status: failed ? "failed" : "confirmed",
    memo:
      (invoice?.product && !invoice.client ? `Order ${invoice.id}` : invoice?.memo) || memo || (viaProgram ? "SolAgent agent payment" : "USDC transfer"),
    ...(invoice ? { invoiceId: invoice.id } : {}),
    ...(failed ? { failure: { code: "TransactionFailed", message: JSON.stringify(tx.meta?.err) } } : {}),
  };
}

/**
 * Latest USDC movements for the owner's token account, newest first. Parsed transactions are cached by
 * signature (null for ones that didn't move USDC), so a refresh only fetches what's new or still missing.
 */
export async function fetchLedger(
  connection: Connection,
  owner: PublicKey,
  mint: PublicKey,
  cache: Map<string, LedgerTx | null>,
  invoices: readonly Invoice[],
): Promise<LedgerTx[]> {
  const ata = getAssociatedTokenAddressSync(mint, owner, true);
  const signatures = await connection.getSignaturesForAddress(ata, { limit: LEDGER_LIMIT }, "confirmed");
  const missing = signatures.map((s) => s.signature).filter((sig) => !cache.has(sig));

  const deadline = Date.now() + PARSE_BUDGET_MS;
  for (let i = 0; i < missing.length && Date.now() < deadline; i += PARSE_CONCURRENCY) {
    const chunk = missing.slice(i, i + PARSE_CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map((signature) =>
        withTimeout(
          connection.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" }),
          PER_TX_TIMEOUT_MS,
        ),
      ),
    );
    results.forEach((result, j) => {
      const signature = chunk[j];
      // Rejected (rate limit, timeout) or not found yet: leave it uncached so the next refresh retries.
      if (signature && result.status === "fulfilled" && result.value) {
        cache.set(signature, toLedgerTx(result.value, signature, ata, mint, invoices));
      }
    });
  }

  return signatures.flatMap((s) => {
    const entry = cache.get(s.signature);
    return entry ? [entry] : [];
  });
}

