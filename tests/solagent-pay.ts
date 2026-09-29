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

  const pay = (amount: number, signer = agent) =>
    program.methods
      .pay(new BN(amount))
      .accountsPartial({
        agent: signer.publicKey,
        agentWallet,
        mint,
        vault,
        recipientTokenAccount: merchantAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([signer])
      .rpc();

  const updatePolicy = (maxPerTx: BN, dailyLimit: BN, paused: boolean, signer = owner) =>
    program.methods
      .updatePolicy(maxPerTx, dailyLimit, paused)
      .accountsPartial({ owner: signer.publicKey, agentWallet })
      .signers([signer])
      .rpc();

  const withdraw = (amount: number, destination: PublicKey, signer = owner) =>
    program.methods
      .withdraw(new BN(amount))
      .accountsPartial({
        owner: signer.publicKey,
        agentWallet,
        mint,
        vault,
        destination,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([signer])
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

  it("rejects a zero-amount payment", async () => {
    await expectAnchorError(pay(0), "ZeroAmount");
  });

  it("only lets the wallet's agent pay", async () => {
    const stranger = Keypair.generate();
    await expectAnchorError(pay(1_000_000, stranger), "ConstraintSeeds");
  });

  it("rejects a policy whose per-transaction limit exceeds the daily limit", async () => {
    await expectAnchorError(updatePolicy(DAILY_LIMIT.addn(1), DAILY_LIMIT, false), "InvalidPolicy");
  });

  it("only lets the owner change the policy", async () => {
    const stranger = Keypair.generate();
    await expectAnchorError(updatePolicy(MAX_PER_TX, DAILY_LIMIT, true, stranger), "ConstraintHasOne");
  });

  it("blocks payments while paused, and resumes when unpaused", async () => {
    const roomyLimit = new BN(20_000_000);
    await updatePolicy(MAX_PER_TX, roomyLimit, true);
    await expectAnchorError(pay(1_000_000), "WalletPaused");

    await updatePolicy(MAX_PER_TX, roomyLimit, false);
    await pay(1_000_000); // 8 + 1 = 9 spent, under the raised limit

    const wallet = await program.account.agentWallet.fetch(agentWallet);
    expect(wallet.spentInWindow.toNumber()).to.equal(9_000_000);
    const merchantAccount = await getAccount(provider.connection, merchantAta);
    expect(merchantAccount.amount).to.equal(9_000_000n);
  });

  it("only lets the owner withdraw", async () => {
    const stranger = Keypair.generate();
    await expectAnchorError(withdraw(1_000_000, merchantAta, stranger), "ConstraintHasOne");
  });

  it("lets the owner withdraw past the agent's limits, even while paused", async () => {
    await updatePolicy(MAX_PER_TX, DAILY_LIMIT, true);
    const ownerAta = (
      await getOrCreateAssociatedTokenAccount(provider.connection, owner, mint, owner.publicKey)
    ).address;

    await withdraw(11_000_000, ownerAta); // 20 minted - 9 paid: the whole vault, above both limits

    expect((await getAccount(provider.connection, vault)).amount).to.equal(0n);
    expect((await getAccount(provider.connection, ownerAta)).amount).to.equal(11_000_000n);
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
