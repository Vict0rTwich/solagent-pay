import { PublicKey, type Connection, type ParsedTransactionWithMeta, type TokenBalance } from "@solana/web3.js";

import { truncateAddress } from "./format";
import {
  amountToBaseUnits,
  assetSymbol,
  formatBaseUnits,
  SOL_DECIMALS,
  type ParsedTransferRequest,
} from "./solana-pay";
import type { Invoice, PaymentIssue } from "./types";

// Solana Pay payment detection. The payer's transaction carries the invoice's reference key, so the
// reference's signatures lead to every payment attempt; each one is then checked strictly: the exact asset,
// the exact recipient wallet, and at least the invoice amount in base units.
//
// This is @solana/pay's findReference + validateTransfer, reimplemented on web3.js v1 (the current @solana/pay
// is built on @solana/kit). It also differs where the original leaves invoices stuck in pending:
// - it looks at every attempt, not only the oldest, so a failed or wrong-token attempt can't hide a later payment;
// - it reads balance changes, not instruction order, so wallets that add their own instructions still validate,
//   and so does a first payment that creates the recipient's token account;
// - a wrong payment comes back as an issue ("Token mismatch: Invoice requires USDC.") instead of a bare throw.

/** What a payment must do: the fields of a Solana Pay transfer request. */
export interface TransferFields {
  recipient: string;
  /** In the asset's own units, e.g. "25.5". */
  amount: string;
  /** SPL mint; null for native SOL. */
  splToken: string | null;
}

/** A payment to look for: its reference key and what the transfer must do. */
export interface PaymentTarget {
  reference: string;
  fields: TransferFields;
}

/** What reached the recipient against what was due, in base units (lamports, or the token's), as decimal strings. */
export interface TransferDelta {
  expected: string;
  received: string;
  decimals: number;
}

/**
 * `delta` is there whenever some of the requested asset reached the recipient. `payer` is the wallet the money came
 * from, when the transaction shows it: where a buyer's cNFT receipt goes.
 */
export type TransferCheck = ({ ok: true; payer: string | null } | { ok: false; issue: PaymentIssue }) & { delta?: TransferDelta };

/** Transactions already checked against a target. A confirmed outcome doesn't change. */
export type PaymentCheckCache = Map<string, TransferCheck & { paidAt: number }>;

export type PaymentLookup =
  | { status: "paid"; signature: string; paidAt: number }
  | { status: "issue"; issue: PaymentIssue }
  | { status: "none" };

/** How many recent transactions carrying a reference are examined. */
const REFERENCE_LOOKBACK = 10;

export function invoiceTarget(invoice: Invoice): PaymentTarget {
  return {
    reference: invoice.reference,
    fields: { recipient: invoice.recipient, amount: invoice.amount, splToken: invoice.mint },
  };
}

/** For a link on its own (the checkout page). Null when it has no amount or reference to check against. */
export function requestTarget(request: ParsedTransferRequest): PaymentTarget | null {
  const reference = request.references[0];
  if (!reference || request.amount === null) return null;
  return {
    reference: reference.toBase58(),
    fields: { recipient: request.recipient.toBase58(), amount: request.amount, splToken: request.splToken?.toBase58() ?? null },
  };
}

function tokenAmount(balances: TokenBalance[] | null | undefined, accountIndex: number, mint: string): bigint {
  const balance = balances?.find((b) => b.accountIndex === accountIndex && b.mint === mint);
  return balance ? BigInt(balance.uiTokenAmount.amount) : 0n;
}

/** Change in `mint` held by token account `accountIndex` over the transaction, in base units. */
export function balanceDelta(tx: ParsedTransactionWithMeta, accountIndex: number, mint: string): bigint {
  return tokenAmount(tx.meta?.postTokenBalances, accountIndex, mint) - tokenAmount(tx.meta?.preTokenBalances, accountIndex, mint);
}

/** Change in native SOL held by `owner` over the transaction, in lamports. */
function lamportDelta(tx: ParsedTransactionWithMeta, owner: string): bigint {
  const index = tx.transaction.message.accountKeys.findIndex((k) => k.pubkey.toBase58() === owner);
  if (index < 0 || !tx.meta) return 0n;
  return BigInt((tx.meta.postBalances[index] ?? 0) - (tx.meta.preBalances[index] ?? 0));
}

/** Net change per token account, with its owner and mint. Token accounts created in the transaction start at zero. */
function tokenChanges(tx: ParsedTransactionWithMeta): { owner: string; mint: string; delta: bigint; decimals: number }[] {
  const seen = new Set<number>();
  return [...(tx.meta?.postTokenBalances ?? []), ...(tx.meta?.preTokenBalances ?? [])].flatMap((balance) => {
    if (seen.has(balance.accountIndex) || !balance.owner) return [];
    seen.add(balance.accountIndex);
    return [
      {
        owner: balance.owner,
        mint: balance.mint,
        delta: balanceDelta(tx, balance.accountIndex, balance.mint),
        decimals: balance.uiTokenAmount.decimals,
      },
    ];
  });
}

/**
 * The wallet that paid: whoever's balance of the requested asset dropped the most, other than the recipient. That's
 * the buyer even when someone else paid the fee (a relayer). Null when nothing but the recipient's balance moved.
 */
function payerOf(tx: ParsedTransactionWithMeta, fields: TransferFields): string | null {
  let payer: string | null = null;
  let largest = 0n;
  if (fields.splToken === null) {
    const { accountKeys } = tx.transaction.message;
    for (let index = 0; index < accountKeys.length; index++) {
      const owner = accountKeys[index]?.pubkey.toBase58();
      const drop = BigInt((tx.meta?.preBalances[index] ?? 0) - (tx.meta?.postBalances[index] ?? 0));
      if (owner && owner !== fields.recipient && drop > largest) {
        largest = drop;
        payer = owner;
      }
    }
    return payer;
  }
  for (const change of tokenChanges(tx)) {
    if (change.mint !== fields.splToken || change.owner === fields.recipient || -change.delta <= largest) continue;
    largest = -change.delta;
    payer = change.owner;
  }
  return payer;
}

/** Checks one transaction against a transfer request. */
export function validateTransfer(tx: ParsedTransactionWithMeta, signature: string, fields: TransferFields): TransferCheck {
  const symbol = assetSymbol(fields.splToken);
  const fail = (reason: PaymentIssue["reason"], message: string, delta?: TransferDelta): TransferCheck => ({
    ok: false,
    issue: { reason, message, signature },
    ...(delta ? { delta } : {}),
  });

  if (!tx.meta || tx.meta.err) return fail("failed", "A payment attempt failed on-chain, so nothing was transferred.");

  const tokens = tokenChanges(tx);
  const toRecipient = tokens.filter((t) => t.owner === fields.recipient && t.delta > 0n);

  let received: bigint;
  let decimals: number;
  if (fields.splToken === null) {
    received = lamportDelta(tx, fields.recipient);
    decimals = SOL_DECIMALS;
  } else {
    const matching = toRecipient.filter((t) => t.mint === fields.splToken);
    received = matching.reduce((sum, t) => sum + t.delta, 0n);
    decimals = matching[0]?.decimals ?? 0;
  }

  if (received > 0n) {
    const expected = amountToBaseUnits(fields.amount, decimals);
    const delta: TransferDelta = { expected: expected.toString(), received: received.toString(), decimals };
    if (received >= expected) return { ok: true, payer: payerOf(tx, fields), delta };
    return fail(
      "amount",
      `Underpaid: received ${formatBaseUnits(received, decimals)} of ${formatBaseUnits(expected, decimals)} ${symbol}.`,
      delta,
    );
  }

  // None of the requested asset reached the recipient. Say what happened instead.
  const otherAsset =
    toRecipient.some((t) => t.mint !== fields.splToken) || (fields.splToken !== null && lamportDelta(tx, fields.recipient) > 0n);
  if (otherAsset) return fail("token", `Token mismatch: Invoice requires ${symbol}.`);

  const elsewhere = fields.splToken !== null && tokens.find((t) => t.mint === fields.splToken && t.delta > 0n);
  if (elsewhere) {
    return fail("recipient", `Wrong recipient: the ${symbol} went to ${truncateAddress(elsewhere.owner)}, not this invoice's wallet.`);
  }
  return fail("amount", `No ${symbol} reached this invoice's wallet in that transaction.`);
}

/**
 * Checks one transaction that carries the target's reference. Null when the RPC doesn't have it yet
 * (it's re-fetched next time); otherwise the outcome is cached.
 */
export async function checkPayment(
  connection: Connection,
  signature: string,
  target: PaymentTarget,
  cache: PaymentCheckCache,
): Promise<(TransferCheck & { paidAt: number }) | null> {
  // The outcome depends on what the payment must do, not just which transaction it is.
  const { recipient, splToken, amount } = target.fields;
  const key = `${signature}|${target.reference}|${recipient}|${splToken ?? "SOL"}|${amount}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const tx = await connection.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
  if (!tx) return null;
  const result = { ...validateTransfer(tx, signature, target.fields), paidAt: (tx.blockTime ?? Math.floor(Date.now() / 1000)) * 1000 };
  cache.set(key, result);
  return result;
}

export function toLookup(signature: string, check: TransferCheck & { paidAt: number }): PaymentLookup {
  return check.ok ? { status: "paid", signature, paidAt: check.paidAt } : { status: "issue", issue: check.issue };
}

/**
 * Finds the target's payment by its reference key, at "confirmed" commitment. A valid payment wins over any
 * number of bad attempts; otherwise the newest bad attempt is reported so the UI can say what went wrong.
 */
export async function findPayment(connection: Connection, target: PaymentTarget, cache: PaymentCheckCache): Promise<PaymentLookup> {
  const signatures = await connection.getSignaturesForAddress(
    new PublicKey(target.reference),
    { limit: REFERENCE_LOOKBACK },
    "confirmed",
  );

  let newestIssue: PaymentIssue | null = null;
  for (const { signature, err } of signatures) {
    if (err) {
      // The signature list already says it failed; no need to fetch the transaction.
      newestIssue ??= { reason: "failed", message: "A payment attempt failed on-chain, so nothing was transferred.", signature };
      continue;
    }
    const check = await checkPayment(connection, signature, target, cache);
    if (!check) continue;
    if (check.ok) return { status: "paid", signature, paidAt: check.paidAt };
    newestIssue ??= check.issue;
  }
  return newestIssue ? { status: "issue", issue: newestIssue } : { status: "none" };
}
