import { PublicKey } from "@solana/web3.js";

export const AGENT_WALLET_SEED = Buffer.from("agent_wallet");

export function findAgentWalletPda(
  owner: PublicKey,
  agent: PublicKey,
  programId: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [AGENT_WALLET_SEED, owner.toBuffer(), agent.toBuffer()],
    programId,
  );
}
