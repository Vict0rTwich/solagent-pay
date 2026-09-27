import path from "node:path";

import { NETWORKS, type NetworkId } from "@/lib/network";

// Payment server settings, from the environment. See .env.example.
//
// A value that can't be used is reported and replaced by its default rather than thrown: this module loads with
// every route, so a throw here would fail every request with an empty 500 before any handler could say why.

const WARNED = Symbol.for("solagent-pay.config-warnings");

/** Logs `message` once per process, however many route bundles load this module. */
export function warnOnce(key: string, message: string): void {
  const holder = globalThis as typeof globalThis & { [WARNED]?: Set<string> };
  holder[WARNED] ??= new Set();
  if (holder[WARNED].has(key)) return;
  holder[WARNED].add(key);
  console.warn(`[solagent-pay] ${message}`);
}

function numberFromEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    warnOnce(name, `${name} must be a number from ${min} to ${max}; got "${raw}". Using ${fallback}.`);
    return fallback;
  }
  return value;
}

function envKey(network: NetworkId): string {
  return network.toUpperCase().replace(/-/g, "_");
}

function storeFromEnv(): "file" | "postgres" {
  const raw = process.env.SOLAGENT_STORE?.trim() || "file";
  if (raw === "file" || raw === "postgres") return raw;
  warnOnce("SOLAGENT_STORE", `SOLAGENT_STORE must be "file" or "postgres"; got "${raw}". Using the file store.`);
  return "file";
}

function underdogNetworkFromEnv(): "devnet" | "mainnet-beta" {
  const raw = process.env.UNDERDOG_NETWORK?.trim() || "devnet";
  if (raw === "devnet" || raw === "mainnet-beta") return raw;
  warnOnce("UNDERDOG_NETWORK", `UNDERDOG_NETWORK must be "devnet" or "mainnet-beta"; got "${raw}". Using devnet.`);
  return "devnet";
}

/** Unusable values count as unset, which is safe: see publicOrigin for what an unset app URL allows. */
function appUrlFromEnv(): URL | null {
  const raw = process.env.SOLAGENT_APP_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol === "https:" || url.protocol === "http:") return new URL(url.origin);
  } catch {
    // Reported below.
  }
  warnOnce("SOLAGENT_APP_URL", `SOLAGENT_APP_URL must be this app's origin, like https://pay.example.com; got "${raw}". Ignoring it.`);
  return null;
}

export const serverConfig = {
  /** "file": one JSON file, one server process. "postgres": shared by any number of processes or instances. */
  store: storeFromEnv(),
  /** Where the file store's JSON file lives. */
  dataDir: process.env.SOLAGENT_DATA_DIR || path.join(process.cwd(), ".data"),
  /** PostgreSQL connection string for the postgres store. */
  databaseUrl: process.env.SOLAGENT_DATABASE_URL || process.env.DATABASE_URL || null,
  /** Connections per server instance. Keep it small on serverless hosts, where every instance has its own pool. */
  databasePoolMax: numberFromEnv("SOLAGENT_DATABASE_POOL_MAX", 5, 1, 100),
  /**
   * This app's public origin. Sign-in messages name it and the server only accepts ones that do, so a signature
   * a phishing site collected for its own domain is useless here. Required in production.
   */
  appUrl: appUrlFromEnv(),
  /** HMAC-SHA256 key for the session and sign-in cookies. Required in production; at least 32 characters. */
  sessionSecret: process.env.SOLAGENT_SESSION_SECRET || null,
  /** How long a merchant stays signed in. */
  sessionTtlMs: numberFromEnv("SOLAGENT_SESSION_TTL_HOURS", 12, 0.25, 24 * 30) * 3_600_000,
  /** Unpaid invoices expire after this long. */
  invoiceTtlMs: numberFromEnv("SOLAGENT_INVOICE_TTL_MINUTES", 15, 1, 60 * 24 * 30) * 60_000,
  /** Where `payment.succeeded` events are POSTed; unset means events are recorded but not sent. */
  webhookUrl: process.env.SOLAGENT_WEBHOOK_URL || null,
  /** HMAC-SHA256 key for the X-SolAgent-Signature header. */
  webhookSecret: process.env.SOLAGENT_WEBHOOK_SECRET || null,
  /** If set, only these wallets can sign in, so strangers can't use this server to watch and webhook their payments. */
  merchantWallets: new Set(
    (process.env.SOLAGENT_MERCHANT_WALLETS ?? "")
      .split(",")
      .map((wallet) => wallet.trim())
      .filter(Boolean),
  ),
  /** Requests per second to each RPC endpoint. The public devnet endpoint rate-limits hard. */
  rpcRequestsPerSecond: numberFromEnv("SOLAGENT_RPC_RPS", 4, 0.2, 500),
  /** Open (pending) invoices the server will watch at once. */
  maxOpenInvoices: numberFromEnv("SOLAGENT_MAX_OPEN_INVOICES", 500, 1, 100_000),
  /** Products each merchant can have on sale at once. */
  maxProductsPerMerchant: numberFromEnv("SOLAGENT_MAX_PRODUCTS", 100, 1, 10_000),
  /**
   * cNFT receipts (Underdog Protocol). Without a key and project, receipts are simulated: logged and marked as such,
   * never minted, so local development needs no Underdog account. A key mints on one network; sales on the others
   * get simulated receipts too, so a devnet purchase never mints on mainnet.
   */
  underdog: {
    apiKey: process.env.UNDERDOG_API_KEY?.trim() || null,
    projectId: process.env.UNDERDOG_PROJECT_ID?.trim() || null,
    network: underdogNetworkFromEnv(),
    /** Defaults to Underdog's API for `network`. */
    apiUrl: process.env.UNDERDOG_API_URL?.trim() || null,
  },
};

/** HTTP RPC endpoint: SOLAGENT_RPC_URL_<NETWORK> (e.g. SOLAGENT_RPC_URL_DEVNET), else the app's default. */
export function rpcEndpoint(network: NetworkId): string {
  return process.env[`SOLAGENT_RPC_URL_${envKey(network)}`] || NETWORKS[network].endpoint;
}

/**
 * Websocket endpoint: SOLAGENT_WS_URL_<NETWORK>, else derived from the HTTP one the way web3.js does it
 * (wss for https; a local validator's websocket is on the next port, 8899 -> 8900).
 */
export function wsEndpoint(network: NetworkId): string {
  const configured = process.env[`SOLAGENT_WS_URL_${envKey(network)}`];
  if (configured) return configured;
  const url = new URL(rpcEndpoint(network));
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  if (url.port) url.port = String(Number(url.port) + 1);
  return url.toString();
}
