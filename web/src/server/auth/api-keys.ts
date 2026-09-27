import { createHash, randomBytes, randomUUID } from "node:crypto";

import type { ApiKeySummary, KeyEnvironment } from "@/lib/api-keys";
import { encodeBase58 } from "@/lib/base58";

import { error } from "../http";
import type { ApiKeyRecord, KeyStore } from "../store";

// Merchant API keys: `sp_test_…` / `sp_live_…` plus 32 random bytes in base58. Only a SHA-256 is stored, so a
// leaked store doesn't leak working keys; the key is shown once, when it's created. A plain hash (no salt) is
// enough here: the key is 256 bits of randomness, so there's no dictionary to precompute.

const KEY_PATTERN = /^sp_(test|live)_[1-9A-HJ-NP-Za-km-z]{32,48}$/;

export function hashKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

export function generateApiKey(input: { merchant: string; name: string; environment: KeyEnvironment; dailyCapCents: number }): {
  key: string;
  record: ApiKeyRecord;
} {
  const secret = encodeBase58(randomBytes(32));
  const key = `sp_${input.environment}_${secret}`;
  return {
    key,
    record: {
      id: `key_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
      merchant: input.merchant,
      name: input.name,
      environment: input.environment,
      hash: hashKey(key),
      preview: `sp_${input.environment}_${secret.slice(0, 4)}…${secret.slice(-4)}`,
      dailyCapCents: input.dailyCapCents,
      createdAt: Date.now(),
      lastUsedAt: null,
      revokedAt: null,
    },
  };
}

export function toKeySummary(record: ApiKeyRecord, usedTodayCents: number): ApiKeySummary {
  return {
    id: record.id,
    name: record.name,
    environment: record.environment,
    preview: record.preview,
    dailyCapCents: record.dailyCapCents,
    usedTodayCents,
    createdAt: record.createdAt,
    lastUsedAt: record.lastUsedAt,
    revokedAt: record.revokedAt,
  };
}

/** UTC midnight of `now`, the day a key's volume is counted against. */
export function utcDay(now = Date.now()): number {
  return now - (now % 86_400_000);
}

/** The key in `Authorization: Bearer sp_…`, if the request carries one (well-formed or not). */
export function bearerKey(request: Request): string | null {
  const header = request.headers.get("authorization");
  const match = header?.match(/^Bearer\s+(\S+)$/i);
  return match?.[1] ?? null;
}

/**
 * The active key a request authenticates with, or the response to send instead. Every failure reads the same
 * ("invalid or revoked"), so the answer doesn't say which keys exist.
 */
export async function requireApiKey(request: Request, store: KeyStore): Promise<ApiKeyRecord | Response> {
  const key = bearerKey(request);
  if (!key) return error(401, "Send an API key: Authorization: Bearer sp_test_… (create one in Settings).");
  const record = KEY_PATTERN.test(key) ? await store.findApiKeyByHash(hashKey(key)) : null;
  if (!record || record.revokedAt !== null) return error(401, "That API key is invalid or has been revoked.");
  return record;
}
