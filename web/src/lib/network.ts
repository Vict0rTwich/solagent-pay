import { PROGRAM_ID as SDK_PROGRAM_ID } from "@solagent-pay/sdk";
import { clusterApiUrl } from "@solana/web3.js";

export type NetworkId = "devnet" | "localnet" | "mainnet-beta";

export interface NetworkConfig {
  id: NetworkId;
  label: string;
  shortLabel: string;
  endpoint: string;
  usdcMint: string;
}

/** Circle's devnet USDC; also what a local validator should clone. */
export const USDC_MINT_DEVNET = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
export const USDC_MINT_MAINNET = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
/** Tether on mainnet; it has no official devnet deployment. */
export const USDT_MINT_MAINNET = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
export const LOCALNET_ENDPOINT = "http://127.0.0.1:8899";

export const NETWORKS: Record<NetworkId, NetworkConfig> = {
  devnet: {
    id: "devnet",
    label: "Solana Devnet",
    shortLabel: "Devnet",
    // https://api.devnet.solana.com unless overridden.
    endpoint: process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? clusterApiUrl("devnet"),
    usdcMint: USDC_MINT_DEVNET,
  },
  localnet: {
    id: "localnet",
    label: "Localhost",
    shortLabel: "Localnet",
    endpoint: LOCALNET_ENDPOINT,
    usdcMint: USDC_MINT_DEVNET,
  },
  "mainnet-beta": {
    id: "mainnet-beta",
    label: "Mainnet Beta",
    shortLabel: "Mainnet",
    endpoint: process.env.NEXT_PUBLIC_SOLANA_MAINNET_RPC_URL ?? clusterApiUrl("mainnet-beta"),
    usdcMint: USDC_MINT_MAINNET,
  },
};

export const DEFAULT_NETWORK: NetworkId = "devnet";

export function isNetworkId(value: unknown): value is NetworkId {
  return typeof value === "string" && Object.hasOwn(NETWORKS, value);
}

/** The SolAgent Pay program, from the IDL the SDK was built with (declare_id! in lib.rs). */
export const PROGRAM_ID = SDK_PROGRAM_ID.toBase58();

function explorerCluster(network: NetworkConfig): string {
  if (network.id === "mainnet-beta") return "";
  if (network.id === "devnet") return "?cluster=devnet";
  return `?cluster=custom&customUrl=${encodeURIComponent(network.endpoint)}`;
}

export function explorerAddressUrl(address: string, network: NetworkConfig): string {
  return `https://explorer.solana.com/address/${address}${explorerCluster(network)}`;
}

/** A cNFT receipt (its asset address) on Solscan; Solana Explorer on a local validator. */
export function assetExplorer(address: string, network: NetworkConfig): { url: string; name: string } {
  if (network.id === "localnet") return { url: explorerAddressUrl(address, network), name: "Solana Explorer" };
  const cluster = network.id === "devnet" ? "?cluster=devnet" : "";
  return { url: `https://solscan.io/token/${address}${cluster}`, name: "Solscan" };
}

/** Solscan for public clusters; Solana Explorer for a local validator, which Solscan can't reach. */
export function txExplorer(signature: string, network: NetworkConfig): { url: string; name: string } {
  if (network.id === "localnet") {
    return { url: `https://explorer.solana.com/tx/${signature}${explorerCluster(network)}`, name: "Solana Explorer" };
  }
  const cluster = network.id === "devnet" ? "?cluster=devnet" : "";
  return { url: `https://solscan.io/tx/${signature}${cluster}`, name: "Solscan" };
}
