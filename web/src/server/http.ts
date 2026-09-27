import { PublicKey } from "@solana/web3.js";

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });
}

export function error(status: number, message: string, headers: Record<string, string> = {}): Response {
  return json({ error: message }, status, headers);
}

/** The caller's address as the proxy reports it; "local" when there's no proxy header. */
export function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export function isAddress(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 32 || value.length > 44) return false;
  try {
    new PublicKey(value);
    return true;
  } catch {
    return false;
  }
}

const buckets = new Map<string, { tokens: number; updatedAt: number }>();

/**
 * Token bucket per key: `perMinute` sustained, bursts up to `perMinute`. False means over the limit.
 * In memory, so per server process: with several instances (postgres store) each enforces its own limit.
 */
export function allow(key: string, perMinute: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key) ?? { tokens: perMinute, updatedAt: now };
  bucket.tokens = Math.min(perMinute, bucket.tokens + ((now - bucket.updatedAt) / 60_000) * perMinute);
  bucket.updatedAt = now;
  const allowed = bucket.tokens >= 1;
  if (allowed) bucket.tokens -= 1;
  buckets.set(key, bucket);
  if (buckets.size > 10_000) {
    for (const [name, stale] of buckets) if (now - stale.updatedAt > 10 * 60_000) buckets.delete(name);
  }
  return allowed;
}

export function tooManyRequests(): Response {
  return error(429, "Too many requests. Slow down and try again shortly.", { "retry-after": "10" });
}

/** A setting this server needs is missing or unusable. The message says which, and what to set. */
export class ServerConfigError extends Error {
  override readonly name = "ServerConfigError";
}

/** By name, not `instanceof`: route bundles each get their own copy of this module. */
export function isServerConfigError(value: unknown): value is ServerConfigError {
  return value instanceof Error && value.name === "ServerConfigError";
}

/** Errors that mean the database (or another service the store needs) can't be reached right now. */
const UNREACHABLE_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "ETIMEDOUT", "EAI_AGAIN", "57P01", "57P03", "08001", "08006"]);

function isUnreachable(value: unknown): boolean {
  const code = value && typeof value === "object" && "code" in value ? String((value as { code: unknown }).code) : "";
  // pg reports a dropped pool connection by message only.
  return UNREACHABLE_CODES.has(code) || (value instanceof Error && /^Connection terminated/.test(value.message));
}

/**
 * Wraps a route handler so a failure is answered in JSON the dashboard can show, never Next's empty 500: a missing
 * or unusable setting (503, naming it), the database unreachable (503), anything else (500, logged here with its
 * stack so it can be fixed).
 */
export function guarded<Args extends unknown[]>(handler: (...args: Args) => Promise<Response>): (...args: Args) => Promise<Response> {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (caught) {
      if (isServerConfigError(caught)) {
        console.error(`[solagent-pay] ${caught.message}`);
        return error(503, caught.message);
      }
      if (isUnreachable(caught)) {
        console.error("[solagent-pay] the payment server's store isn't reachable:", caught);
        return error(503, "The payment server can't reach its database right now. Try again shortly.", { "retry-after": "10" });
      }
      console.error("[solagent-pay] request failed:", caught);
      return error(500, "The payment server hit an unexpected error. Try again; if it keeps happening, check the server log.");
    }
  };
}
