import {
  ACCOUNT_SIZE,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  unpackAccount,
  unpackMint,
} from "@solana/spl-token";
import type { SendTransactionOptions } from "@solana/wallet-adapter-base";
import {
  PublicKey,
  SendTransactionError,
  SystemProgram,
  Transaction,
  TransactionExpiredBlockheightExceededError,
  TransactionInstruction,
  type AccountInfo,
  type Connection,
  type TransactionSignature,
  type VersionedTransaction,
} from "@solana/web3.js";

import { encodeBase58 } from "./base58";
import { sameAmount } from "./currency";
import { TimeoutError, describeError } from "./live-data";
import {
  amountToBaseUnits,
  assetSymbol,
  formatBaseUnits,
  SOL_DECIMALS,
  type ParsedTransferRequest,
} from "./solana-pay";
import type { Invoice } from "./types";

// "Pay with Connected Wallet": builds the transfer a mobile wallet would build from the Solana Pay link, here
// in the browser, and has the connected extension wallet (Phantom, Solflare, Backpack, …) sign it. Desktop
// browsers can't open `solana:` links, so this is how a payer at a computer pays.

/** SPL Memo v2. */
const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
/** Base fee for a single-signature transaction. */
export const SIGNATURE_FEE_LAMPORTS = 5_000n;

/**
 * - rejected: the payer declined in their wallet.
 * - insufficient: not enough of the token, or of SOL for fees.
 * - timeout / network: the RPC didn't answer or refused (rate limit); trying again can work.
 * - failed: the transaction ran and failed on-chain.
 * - invalid: the link or setup is wrong; trying again won't help.
 */
export type PaymentErrorKind = "rejected" | "insufficient" | "timeout" | "network" | "failed" | "invalid";

/** A payment problem in words the payer can act on; the message is shown as is. */
export class PaymentError extends Error {
  constructor(
    message: string,
    readonly kind: PaymentErrorKind = "invalid",
  ) {
    super(message);
  }

  /** Network trouble, where the same attempt can simply be retried. */
  get retryable(): boolean {
    return this.kind === "timeout" || this.kind === "network";
  }
}

export interface PreparedTransfer {
  transaction: Transaction;
  blockhash: string;
  lastValidBlockHeight: number;
}

/** A transfer the wallet has signed. `wire` is null when the wallet sent it itself. */
export interface SignedTransfer extends PreparedTransfer {
  signature: string;
  wire: Uint8Array | null;
}

/** The parts of `useWallet()` that pay. */
export interface PayingWallet {
  publicKey: PublicKey;
  signTransaction?: <T extends Transaction | VersionedTransaction>(transaction: T) => Promise<T>;
  sendTransaction: (
    transaction: Transaction | VersionedTransaction,
    connection: Connection,
    options?: SendTransactionOptions,
  ) => Promise<TransactionSignature>;
}

/**
 * Refuses to pay a link that doesn't say exactly what the invoice says: the same recipient, token, amount and
 * reference. The link is what gets paid, so this keeps a mismatched link from ever leaving the browser.
 */
export function assertLinkMatchesInvoice(request: ParsedTransferRequest, invoice: Invoice): void {
  const symbol = assetSymbol(invoice.mint);
  // Both null for native SOL; a link with an spl-token can't pay a SOL invoice, nor the reverse.
  if ((request.splToken?.toBase58() ?? null) !== invoice.mint) throw new PaymentError(`Token mismatch: Invoice requires ${symbol}.`);
  if (request.recipient.toBase58() !== invoice.recipient) throw new PaymentError("This link pays a different wallet than the invoice.");
  if (request.amount === null || !sameAmount(request.amount, invoice.amount)) throw new PaymentError("This link's amount doesn't match the invoice.");
  if (!request.references.some((r) => r.toBase58() === invoice.reference)) {
    throw new PaymentError("This link is missing the invoice's reference, so its payment couldn't be matched.");
  }
}

function toBaseUnits(amount: string, decimals: number, symbol: string): bigint {
  try {
    return amountToBaseUnits(amount, decimals);
  } catch {
    throw new PaymentError(`${amount} ${symbol} is more precise than ${symbol} allows.`);
  }
}

function tokenProgramOf(account: AccountInfo<Buffer> | null): PublicKey | null {
  const owner = account?.owner;
  return owner && (owner.equals(TOKEN_PROGRAM_ID) || owner.equals(TOKEN_2022_PROGRAM_ID)) ? owner : null;
}

export interface PayerBalances {
  lamports: bigint;
  /** The requested token's balance; null for a SOL payment. Zero when the payer has no account for it yet. */
  token: { amount: bigint; decimals: number } | null;
}

/** What the payer holds of SOL and of the token they're asked to pay in. */
export async function fetchPayerBalances(connection: Connection, payer: PublicKey, mint: PublicKey | null): Promise<PayerBalances> {
  const lamports = BigInt(await connection.getBalance(payer, "confirmed"));
  if (!mint) return { lamports, token: null };

  const mintAccount = await connection.getAccountInfo(mint, "confirmed");
  const programId = tokenProgramOf(mintAccount);
  if (!mintAccount || !programId) return { lamports, token: null };
  const { decimals } = unpackMint(mint, mintAccount, programId);
  const ata = getAssociatedTokenAddressSync(mint, payer, true, programId);
  const account = await connection.getAccountInfo(ata, "confirmed");
  return { lamports, token: { amount: account ? unpackAccount(ata, account, programId).amount : 0n, decimals } };
}

/**
 * The Solana Pay transfer for `request`, paid by `payer`:
 * [create the recipient's token account if it's missing] → [memo] → transfer, with the reference keys on the
 * transfer. The memo sits right before the transfer and the transfer goes last, as the Solana Pay spec lays out.
 * Balances are checked first so the payer gets a plain answer instead of a failed simulation.
 */
export async function buildTransferTransaction(
  connection: Connection,
  payer: PublicKey,
  request: ParsedTransferRequest,
): Promise<PreparedTransfer> {
  if (request.amount === null) throw new PaymentError("This link doesn't set an amount.");
  const mint = request.splToken;
  const symbol = assetSymbol(mint?.toBase58() ?? null);

  const instructions: TransactionInstruction[] = [];
  let transfer: TransactionInstruction;
  let lamportsNeeded = SIGNATURE_FEE_LAMPORTS;

  if (mint) {
    const mintAccount = await connection.getAccountInfo(mint, "confirmed");
    const programId = tokenProgramOf(mintAccount);
    if (!mintAccount || !programId) {
      throw new PaymentError(`${symbol} doesn't exist on this network. Check that the link and your wallet are on the same network.`);
    }
    const { decimals } = unpackMint(mint, mintAccount, programId);
    const units = toBaseUnits(request.amount, decimals, symbol);

    const source = getAssociatedTokenAddressSync(mint, payer, true, programId);
    const destination = getAssociatedTokenAddressSync(mint, request.recipient, true, programId);
    const [sourceAccount, destinationAccount] = await connection.getMultipleAccountsInfo([source, destination], "confirmed");
    const balance = sourceAccount ? unpackAccount(source, sourceAccount, programId).amount : 0n;
    if (balance < units) {
      throw new PaymentError(
        `Insufficient balance: You need ${formatBaseUnits(units, decimals)} ${symbol} to complete this payment. ` +
          `This wallet has ${formatBaseUnits(balance, decimals)} ${symbol}.`,
        "insufficient",
      );
    }
    if (!destinationAccount) {
      // First payment to this recipient in this token: the payer opens their token account, as wallets do.
      // The idempotent form still succeeds if someone else creates it first.
      instructions.push(createAssociatedTokenAccountIdempotentInstruction(payer, destination, request.recipient, mint, programId));
      lamportsNeeded += BigInt(await connection.getMinimumBalanceForRentExemption(ACCOUNT_SIZE, "confirmed"));
    }
    // TransferChecked pins the mint and decimals, so the token program itself rejects any other token.
    transfer = createTransferCheckedInstruction(source, mint, destination, payer, units, decimals, [], programId);
  } else {
    const lamports = toBaseUnits(request.amount, SOL_DECIMALS, symbol);
    lamportsNeeded += lamports;
    transfer = SystemProgram.transfer({ fromPubkey: payer, toPubkey: request.recipient, lamports });
  }

  const lamports = BigInt(await connection.getBalance(payer, "confirmed"));
  if (lamports < lamportsNeeded) {
    const needed = formatBaseUnits(lamportsNeeded, SOL_DECIMALS);
    const has = formatBaseUnits(lamports, SOL_DECIMALS);
    throw new PaymentError(
      mint
        ? `Insufficient balance: You need ${needed} SOL for network fees to complete this payment. This wallet has ${has} SOL.`
        : `Insufficient balance: You need ${needed} SOL to complete this payment, including the network fee. This wallet has ${has} SOL.`,
      "insufficient",
    );
  }

  if (request.memo) {
    instructions.push(new TransactionInstruction({ programId: MEMO_PROGRAM_ID, keys: [], data: Buffer.from(request.memo, "utf8") }));
  }
  // Reference keys ride on the transfer as read-only, non-signer accounts: that's how the payment is found.
  for (const reference of request.references) {
    transfer.keys.push({ pubkey: reference, isSigner: false, isWritable: false });
  }
  instructions.push(transfer);

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  return {
    transaction: new Transaction({ feePayer: payer, blockhash, lastValidBlockHeight }).add(...instructions),
    blockhash,
    lastValidBlockHeight,
  };
}

/**
 * Opens the wallet's approval prompt. Signing only, so nothing reaches the network until `broadcast`: a payer
 * who closes the checkout while the prompt is open and approves afterwards pays nothing. It also sends the
 * payment through the checkout's own RPC, on the invoice's network, instead of whichever network the wallet
 * infers. Wallets that can't sign without sending fall back to sendTransaction, which can't be taken back.
 */
export async function signTransfer(connection: Connection, wallet: PayingWallet, prepared: PreparedTransfer): Promise<SignedTransfer> {
  if (wallet.signTransaction) {
    const signed = await wallet.signTransaction(prepared.transaction);
    if (!signed.signature) throw new PaymentError("The wallet returned the transaction without signing it.", "failed");
    return { ...prepared, transaction: signed, signature: encodeBase58(signed.signature), wire: signed.serialize() };
  }
  const signature = await wallet.sendTransaction(prepared.transaction, connection, { preflightCommitment: "confirmed", maxRetries: 5 });
  return { ...prepared, signature, wire: null };
}

/** Sends a signed transfer. Sending the same signed bytes again is harmless: the network keeps one copy. */
export async function broadcast(connection: Connection, signed: SignedTransfer): Promise<void> {
  if (signed.wire) await connection.sendRawTransaction(signed.wire, { preflightCommitment: "confirmed", maxRetries: 5 });
}

/** Waits for "confirmed" commitment (about a second) rather than "finalized". `signal` stops the wait. */
export async function confirmTransfer(connection: Connection, signed: SignedTransfer, signal: AbortSignal): Promise<void> {
  const { value } = await connection.confirmTransaction(
    { signature: signed.signature, blockhash: signed.blockhash, lastValidBlockHeight: signed.lastValidBlockHeight, abortSignal: signal },
    "confirmed",
  );
  if (value.err) throw new PaymentError("The payment failed on-chain, so nothing was transferred.", "failed");
}

/**
 * Where a signed transfer stands. "pending" means it can still land, so another payment must not be signed
 * yet; "expired" means its blockhash is too old for it ever to land, so paying again is safe.
 */
export async function transferStatus(connection: Connection, signed: SignedTransfer): Promise<"confirmed" | "failed" | "pending" | "expired"> {
  const {
    value: [status],
  } = await connection.getSignatureStatuses([signed.signature], { searchTransactionHistory: true });
  if (status?.err) return "failed";
  if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") return "confirmed";
  const height = await connection.getBlockHeight("confirmed");
  return height > signed.lastValidBlockHeight ? "expired" : "pending";
}

/** Any failure from building, signing, sending or confirming, as a PaymentError. */
export function toPaymentError(error: unknown): PaymentError {
  if (error instanceof PaymentError) return error;
  if (error instanceof TimeoutError) return new PaymentError("The network didn't answer in time.", "timeout");
  if (error instanceof TransactionExpiredBlockheightExceededError) {
    return new PaymentError("The payment wasn't confirmed before its transaction expired.", "timeout");
  }

  const cause = error instanceof Error && "error" in error ? (error as { error?: unknown }).error : undefined;
  const logs = error instanceof SendTransactionError ? (error.logs ?? []).join("\n") : "";
  const text = [error instanceof Error ? error.message : String(error), cause instanceof Error ? cause.message : "", logs].join("\n");

  if (/reject|denied|declined|cancel/i.test(text)) return new PaymentError("Transaction canceled by user.", "rejected");
  if (/blockhash not found|block height exceeded/i.test(text)) {
    return new PaymentError("The transaction expired before the network accepted it.", "timeout");
  }
  if (/no record of a prior credit|insufficient lamports/i.test(text)) {
    return new PaymentError("Insufficient balance: You need a little SOL for network fees to complete this payment.", "insufficient");
  }
  if (/insufficient funds/i.test(text)) {
    return new PaymentError("Insufficient balance: this wallet doesn't hold enough of the token to complete this payment.", "insufficient");
  }
  if (/429|too many requests|failed to fetch|network ?error|ECONN|timed? ?out/i.test(text)) {
    return new PaymentError(describeError(error), "network");
  }
  return new PaymentError(describeError(error), "failed");
}
