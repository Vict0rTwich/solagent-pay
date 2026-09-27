import { AnchorProvider, BN, Program, Wallet, type IdlAccounts } from "@coral-xyz/anchor";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  unpackMint,
} from "@solana/spl-token";
import { Connection, Keypair, PublicKey, type TransactionSignature } from "@solana/web3.js";

import { fromBaseUnits, toBaseUnits } from "./amounts.js";
import idl from "./idl/solagent_pay.json";
import type { SolagentPay } from "./idl/solagent_pay.js";
import { findAgentWalletPda } from "./pda.js";

export type AgentWalletAccount = IdlAccounts<SolagentPay>["agentWallet"];

/** The program this SDK was built against (the IDL's address). */
export const PROGRAM_ID = new PublicKey(idl.address);

/** Readable view of an agent wallet. Token amounts are decimal strings in whole-token units. */
export interface AgentWalletStatus {
  address: string;
  owner: string;
  agent: string;
  mint: string;
  vault: string;
  decimals: number;
  paused: boolean;
  balance: string;
  maxPerTx: string;
  dailyLimit: string;
  /** Spent in the current window; "0" once the window has expired. */
  spentInWindow: string;
  remainingToday: string;
  /** ISO time the current spending window ends, or null if no window is active. */
  windowResetsAt: string | null;
}

// Mirrors SPEND_WINDOW_SECS in programs/solagent-pay/src/constants.rs.
const SPEND_WINDOW_SECS = 24 * 60 * 60;

interface MintInfo {
  decimals: number;
  tokenProgram: PublicKey;
}

/**
 * Wraps the SolAgent Pay program. The provider's wallet signs every call: it acts as the
 * owner for create/update/withdraw and as the agent for `pay`.
 */
export class SolAgentPayClient {
  readonly program: Program<SolagentPay>;
  private readonly mints = new Map<string, MintInfo>();

  constructor(readonly provider: AnchorProvider) {
    this.program = new Program(idl as SolagentPay, provider);
  }

  /** Client that signs and pays fees with `keypair`. Node only. */
  static fromKeypair(connection: Connection, keypair: Keypair): SolAgentPayClient {
    const provider = new AnchorProvider(connection, new Wallet(keypair), { commitment: "confirmed" });
    return new SolAgentPayClient(provider);
  }

  get signer(): PublicKey {
    return this.provider.wallet.publicKey;
  }

  findAgentWallet(owner: PublicKey, agent: PublicKey): PublicKey {
    return findAgentWalletPda(owner, agent, this.program.programId)[0];
  }

  fetchAgentWallet(address: PublicKey): Promise<AgentWalletAccount> {
    return this.program.account.agentWallet.fetch(address);
  }

  /** Owner: create a wallet for `agent` that pays in `mint`. Fund it by sending tokens to `vault`. */
  async createAgentWallet(params: {
    agent: PublicKey;
    mint: PublicKey;
    maxPerTx: string;
    dailyLimit: string;
  }): Promise<{ signature: TransactionSignature; agentWallet: PublicKey; vault: PublicKey }> {
    const { decimals, tokenProgram } = await this.getMintInfo(params.mint);
    const agentWallet = this.findAgentWallet(this.signer, params.agent);
    const vault = getAssociatedTokenAddressSync(params.mint, agentWallet, true, tokenProgram);

    const signature = await this.program.methods
      .createAgentWallet(
        toBaseUnits(params.maxPerTx, decimals),
        toBaseUnits(params.dailyLimit, decimals),
      )
      .accountsPartial({
        owner: this.signer,
        agent: params.agent,
        agentWallet,
        mint: params.mint,
        vault,
        tokenProgram,
      })
      .rpc();
    return { signature, agentWallet, vault };
  }

  /** Owner: replace the wallet's limits and paused flag. */
  async updatePolicy(
    agentWallet: PublicKey,
    policy: { maxPerTx: string; dailyLimit: string; paused: boolean },
  ): Promise<TransactionSignature> {
    const { decimals } = await this.load(agentWallet);
    return this.program.methods
      .updatePolicy(
        toBaseUnits(policy.maxPerTx, decimals),
        toBaseUnits(policy.dailyLimit, decimals),
        policy.paused,
      )
      .accountsPartial({ owner: this.signer, agentWallet })
      .rpc();
  }

  /**
   * Agent: pay `amount` to `recipient`, creating the recipient's token account if it is missing. With `reference` (a
   * Solana Pay reference key, e.g. from an HTTP 402 invoice), the key rides along as a read-only account, which is
   * how the payee's gateway finds and settles the payment.
   */
  async pay(params: {
    agentWallet: PublicKey;
    recipient: PublicKey;
    amount: string;
    reference?: PublicKey | string;
  }): Promise<TransactionSignature> {
    const { wallet, decimals, tokenProgram, vault } = await this.load(params.agentWallet);
    // allowOwnerOffCurve: the recipient may itself be a PDA, e.g. another agent's wallet.
    const recipientTokenAccount = getAssociatedTokenAddressSync(
      wallet.mint,
      params.recipient,
      true,
      tokenProgram,
    );

    return this.program.methods
      .pay(toBaseUnits(params.amount, decimals))
      .accountsPartial({
        agent: this.signer,
        agentWallet: params.agentWallet,
        mint: wallet.mint,
        vault,
        recipientTokenAccount,
        tokenProgram,
      })
      .remainingAccounts(
        params.reference === undefined ? [] : [{ pubkey: new PublicKey(params.reference), isSigner: false, isWritable: false }],
      )
      .preInstructions([
        createAssociatedTokenAccountIdempotentInstruction(
          this.signer,
          recipientTokenAccount,
          params.recipient,
          wallet.mint,
          tokenProgram,
        ),
      ])
      .rpc();
  }

  /** Owner: move `amount` from the vault to the owner's own token account. */
  async withdraw(params: { agentWallet: PublicKey; amount: string }): Promise<TransactionSignature> {
    const { wallet, decimals, tokenProgram, vault } = await this.load(params.agentWallet);
    const destination = getAssociatedTokenAddressSync(wallet.mint, this.signer, true, tokenProgram);

    return this.program.methods
      .withdraw(toBaseUnits(params.amount, decimals))
      .accountsPartial({
        owner: this.signer,
        agentWallet: params.agentWallet,
        mint: wallet.mint,
        vault,
        destination,
        tokenProgram,
      })
      .preInstructions([
        createAssociatedTokenAccountIdempotentInstruction(
          this.signer,
          destination,
          this.signer,
          wallet.mint,
          tokenProgram,
        ),
      ])
      .rpc();
  }

  async getStatus(agentWallet: PublicKey): Promise<AgentWalletStatus> {
    return this.statusFor(agentWallet, await this.fetchAgentWallet(agentWallet));
  }

  /** Every agent wallet `owner` has created, read from the program's accounts. */
  async listAgentWallets(owner: PublicKey): Promise<AgentWalletStatus[]> {
    // `owner` is the first field after the 8-byte account discriminator.
    const accounts = await this.program.account.agentWallet.all([
      { memcmp: { offset: 8, bytes: owner.toBase58() } },
    ]);
    return Promise.all(accounts.map(({ publicKey, account }) => this.statusFor(publicKey, account)));
  }

  /** Whether the program is deployed (executable) on the provider's cluster. */
  async isDeployed(): Promise<boolean> {
    const account = await this.provider.connection.getAccountInfo(this.program.programId);
    return account?.executable ?? false;
  }

  private async statusFor(agentWallet: PublicKey, wallet: AgentWalletAccount): Promise<AgentWalletStatus> {
    const { decimals, tokenProgram } = await this.getMintInfo(wallet.mint);
    const vault = getAssociatedTokenAddressSync(wallet.mint, agentWallet, true, tokenProgram);
    const balance = await this.provider.connection.getTokenAccountBalance(vault);

    const windowStart = wallet.windowStart.toNumber();
    const windowActive = Date.now() / 1000 - windowStart < SPEND_WINDOW_SECS;
    const spent = windowActive ? wallet.spentInWindow : new BN(0);
    const remaining = BN.max(wallet.dailyLimit.sub(spent), new BN(0));

    return {
      address: agentWallet.toBase58(),
      owner: wallet.owner.toBase58(),
      agent: wallet.agent.toBase58(),
      mint: wallet.mint.toBase58(),
      vault: vault.toBase58(),
      decimals,
      paused: wallet.paused,
      balance: fromBaseUnits(new BN(balance.value.amount), decimals),
      maxPerTx: fromBaseUnits(wallet.maxPerTx, decimals),
      dailyLimit: fromBaseUnits(wallet.dailyLimit, decimals),
      spentInWindow: fromBaseUnits(spent, decimals),
      remainingToday: fromBaseUnits(remaining, decimals),
      windowResetsAt: windowActive
        ? new Date((windowStart + SPEND_WINDOW_SECS) * 1000).toISOString()
        : null,
    };
  }

  private async load(agentWallet: PublicKey) {
    const wallet = await this.fetchAgentWallet(agentWallet);
    const { decimals, tokenProgram } = await this.getMintInfo(wallet.mint);
    const vault = getAssociatedTokenAddressSync(wallet.mint, agentWallet, true, tokenProgram);
    return { wallet, decimals, tokenProgram, vault };
  }

  /** Decimals and owning token program (SPL Token or Token-2022); cached since neither changes. */
  private async getMintInfo(mint: PublicKey): Promise<MintInfo> {
    const cached = this.mints.get(mint.toBase58());
    if (cached) return cached;

    const account = await this.provider.connection.getAccountInfo(mint);
    if (!account) throw new Error(`Mint ${mint.toBase58()} not found`);
    const info = {
      decimals: unpackMint(mint, account, account.owner).decimals,
      tokenProgram: account.owner,
    };
    this.mints.set(mint.toBase58(), info);
    return info;
  }
}
