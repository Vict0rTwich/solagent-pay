import { Connection } from "@solana/web3.js";

import { backoffDelay, retryAfterMs, sleep } from "./backoff";

/** Worth retrying: rate limited, or the node/gateway is briefly unavailable. */
const RETRY_STATUSES = new Set([429, 502, 503, 504]);
const MAX_ATTEMPTS = 6;
const RETRY_BASE_MS = 500;
const RETRY_CAP_MS = 30_000;
const REQUEST_TIMEOUT_MS = 20_000;

/**
 * Paces requests to one RPC endpoint: at most `perSecond`, first come first served. After a 429 everyone waits
 * out the backoff, not just the request that got it, so the server stops hammering an endpoint that said stop.
 */
export class RateGate {
  private nextSlot = 0;
  private pausedUntil = 0;
  private readonly intervalMs: number;

  constructor(perSecond: number) {
    this.intervalMs = 1000 / perSecond;
  }

  async take(): Promise<void> {
    const now = Date.now();
    const slot = Math.max(now, this.nextSlot, this.pausedUntil);
    this.nextSlot = slot + this.intervalMs;
    if (slot > now) await sleep(slot - now);
  }

  pause(ms: number): void {
    this.pausedUntil = Math.max(this.pausedUntil, Date.now() + ms);
  }

  get paused(): boolean {
    return this.pausedUntil > Date.now();
  }
}

export interface RpcStats {
  requests: number;
  retries: number;
  rateLimited: number;
}

/**
 * fetch for web3.js: paced by `gate`, retried with exponential backoff and jitter on 429, 5xx gateway errors
 * and network failures, honoring Retry-After. web3.js's own 429 retry is turned off so this is the only one.
 */
export function resilientFetch(gate: RateGate, stats: RpcStats): typeof fetch {
  return async (input, init) => {
    for (let attempt = 0; ; attempt++) {
      await gate.take();
      stats.requests++;
      let response: Response | null = null;
      let failure: unknown = null;
      try {
        response = await fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      } catch (error) {
        failure = error;
      }

      const retryable = response ? RETRY_STATUSES.has(response.status) : true;
      if (!retryable || attempt + 1 >= MAX_ATTEMPTS) {
        if (response) return response;
        throw failure;
      }

      const delay = retryAfterMs(response?.headers.get("retry-after") ?? null) ?? backoffDelay(attempt, RETRY_BASE_MS, RETRY_CAP_MS);
      if (response?.status === 429) {
        stats.rateLimited++;
        gate.pause(delay);
      }
      stats.retries++;
      await response?.body?.cancel().catch(() => {});
      await sleep(delay);
    }
  };
}

export interface RpcClient {
  connection: Connection;
  gate: RateGate;
  stats: RpcStats;
}

export function createRpcClient(endpoint: string, requestsPerSecond: number): RpcClient {
  const gate = new RateGate(requestsPerSecond);
  const stats: RpcStats = { requests: 0, retries: 0, rateLimited: 0 };
  const connection = new Connection(endpoint, {
    commitment: "confirmed",
    disableRetryOnRateLimit: true,
    fetch: resilientFetch(gate, stats),
  });
  return { connection, gate, stats };
}
