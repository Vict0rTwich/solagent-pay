import { apiCall } from "./invoice-api";
import type { NetworkId } from "./network";

// Merchant API keys over the payment server's HTTP API (app/api/keys), shared by its route handlers and the
// dashboard. A key lets a server (an HTTP 402 paywall, a backend job) create invoices without a browser sign-in.

export type KeyEnvironment = "test" | "live";

/** An API key as the dashboard lists it. The key itself is only ever returned once, by `create`. */
export interface ApiKeySummary {
  id: string;
  name: string;
  environment: KeyEnvironment;
  /** "sp_test_9fA2…x3aQ". */
  preview: string;
  dailyCapCents: number;
  /** USDC cents of invoices the key created since 00:00 UTC. */
  usedTodayCents: number;
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

export interface CreateApiKeyRequest {
  name: string;
  environment: KeyEnvironment;
  /** Whole US dollars. */
  dailyCapUsd: number;
}

export interface CreateApiKeyResponse {
  /** The full key. Shown once: the server keeps only its hash. */
  key: string;
  apiKey: ApiKeySummary;
}

export const KEY_NAME_MAX = 40;
export const DAILY_CAP_MAX_USD = 1_000_000;
export const MAX_ACTIVE_KEYS = 20;

/** Test keys work on devnet and localnet; live keys on mainnet-beta, where payments are real. */
export function keyEnvironmentFor(network: NetworkId): KeyEnvironment {
  return network === "mainnet-beta" ? "live" : "test";
}

export function networkAllowed(environment: KeyEnvironment, network: NetworkId): boolean {
  return environment === keyEnvironmentFor(network);
}

export const keysApi = {
  /** Needs the merchant session cookie (lib/auth-api). */
  list: async () => (await apiCall<{ keys: ApiKeySummary[] }>("/api/keys")).keys,
  create: (input: CreateApiKeyRequest) => apiCall<CreateApiKeyResponse>("/api/keys", { method: "POST", body: JSON.stringify(input) }),
  revoke: (id: string) => apiCall<{ apiKey: ApiKeySummary }>(`/api/keys/${encodeURIComponent(id)}`, { method: "DELETE" }),
};
