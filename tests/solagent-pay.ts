import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";
import { expect } from "chai";
import { SolagentPay } from "../target/types/solagent_pay";

describe("solagent-pay", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.solagentPay as Program<SolagentPay>;
  const owner = (provider.wallet as anchor.Wallet).payer;
  const agent = Keypair.generate();
  const merchant = Keypair.generate();

  // 6-decimal mint: 1 token = 1_000_000 base units.
  const MAX_PER_TX = new BN(5_000_000);
  const DAILY_LIMIT = new BN(8_000_000);

  let mint: PublicKey;
  let agentWallet: PublicKey;
  let vault: PublicKey;
  let merchantAta: PublicKey;

  const pay = (amount: number) =>
    program.methods
      .pay(new BN(amount))
      .accountsPartial({
        agent: agent.publicKey,
        agentWallet,
        mint,
        vault,
        recipientTokenAccount: merchantAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([agent])
      .rpc();

  before(async () => {
    mint = await createMint(provider.connection, owner, owner.publicKey, null, 6);
    [agentWallet] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent_wallet"), owner.publicKey.toBuffer(), agent.publicKey.toBuffer()],
      program.programId,
    );
    vault = getAssociatedTokenAddressSync(mint, agentWallet, true);
    merchantAta = (
      await getOrCreateAssociatedTokenAccount(provider.connection, owner, mint, merchant.publicKey)
    ).address;
  });

  it("creates an agent wallet with a spending policy", async () => {
    await program.methods
      .createAgentWallet(MAX_PER_TX, DAILY_LIMIT)
      .accountsPartial({
        owner: owner.publicKey,
        agent: agent.publicKey,
        agentWallet,
        mint,
        vault,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const wallet = await program.account.agentWallet.fetch(agentWallet);
    expect(wallet.agent.toBase58()).to.equal(agent.publicKey.toBase58());
    expect(wallet.maxPerTx.eq(MAX_PER_TX)).to.be.true;
    expect(wallet.dailyLimit.eq(DAILY_LIMIT)).to.be.true;

    await mintTo(provider.connection, owner, mint, vault, owner, 20_000_000);
  });

  it("lets the agent pay within its limits", async () => {
    await pay(3_000_000);

    const merchantAccount = await getAccount(provider.connection, merchantAta);
    expect(merchantAccount.amount).to.equal(3_000_000n);
  });

  it("rejects a payment above the per-transaction limit", async () => {
    await expectAnchorError(pay(6_000_000), "ExceedsPerTxLimit");
  });

  it("rejects payments past the daily limit", async () => {
    await pay(5_000_000); // 3 + 5 = 8, exactly the daily limit
    await expectAnchorError(pay(1_000_000), "ExceedsDailyLimit");
  });
});

async function expectAnchorError(promise: Promise<unknown>, code: string) {
  try {
    await promise;
  } catch (err) {
    expect((err as anchor.AnchorError).error?.errorCode?.code).to.equal(code);
    return;
  }
  expect.fail(`Expected the transaction to fail with ${code}`);
}
