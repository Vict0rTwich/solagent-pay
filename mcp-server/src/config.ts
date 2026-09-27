import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { Keypair, PublicKey, clusterApiUrl } from "@solana/web3.js";

export interface Config {
  rpcUrl: string;
  agentKeypair: Keypair;
  /** Owner that created this agent's wallet; with the agent key it derives the wallet address. */
  owner: PublicKey;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const keypairPath = required(env, "AGENT_KEYPAIR_PATH").replace(/^~(?=$|[\\/])/, homedir());
  const secretKey = Uint8Array.from(JSON.parse(readFileSync(keypairPath, "utf8")));

  return {
    rpcUrl: env.SOLANA_RPC_URL ?? clusterApiUrl("devnet"),
    agentKeypair: Keypair.fromSecretKey(secretKey),
    owner: new PublicKey(required(env, "AGENT_WALLET_OWNER")),
  };
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}
