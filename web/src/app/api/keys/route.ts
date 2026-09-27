import { DAILY_CAP_MAX_USD, KEY_NAME_MAX, MAX_ACTIVE_KEYS, type CreateApiKeyRequest, type CreateApiKeyResponse } from "@/lib/api-keys";
import { generateApiKey, toKeySummary, utcDay } from "@/server/auth/api-keys";
import { requireMerchant } from "@/server/auth/session";
import { allow, clientIp, error, json, readJson, tooManyRequests } from "@/server/http";
import { paymentRuntime } from "@/server/runtime";
import { isStoreError } from "@/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseCreate(body: unknown): CreateApiKeyRequest | string {
  if (!body || typeof body !== "object") return "Send a JSON body.";
  const input = body as Record<string, unknown>;
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name || name.length > KEY_NAME_MAX) return `name must be 1 to ${KEY_NAME_MAX} characters.`;
  if (input.environment !== "test" && input.environment !== "live") return 'environment must be "test" or "live".';
  const cap = input.dailyCapUsd;
  if (typeof cap !== "number" || !Number.isInteger(cap) || cap < 1 || cap > DAILY_CAP_MAX_USD) {
    return `dailyCapUsd must be a whole number of dollars from 1 to ${DAILY_CAP_MAX_USD.toLocaleString("en-US")}.`;
  }
  return { name, environment: input.environment, dailyCapUsd: cap };
}

/** The signed-in merchant's API keys (hashes never leave the server), with today's volume against each cap. */
export async function GET(request: Request): Promise<Response> {
  if (!allow(`keys:${clientIp(request)}`, 120)) return tooManyRequests();
  const { store } = paymentRuntime();
  const merchant = await requireMerchant(request, store);
  if (merchant instanceof Response) return merchant;

  const keys = await store.listApiKeys(merchant.address);
  const volume = await store.keyVolume(
    keys.map((key) => key.id),
    utcDay(),
  );
  return json({ keys: keys.map((key) => toKeySummary(key, volume[key.id] ?? 0)) });
}

/** Creates a key for the signed-in merchant. The response is the only time the full key is ever returned. */
export async function POST(request: Request): Promise<Response> {
  if (!allow(`keys-create:${clientIp(request)}`, 10)) return tooManyRequests();
  const { store } = paymentRuntime();
  const merchant = await requireMerchant(request, store);
  if (merchant instanceof Response) return merchant;
  const input = parseCreate(await readJson(request));
  if (typeof input === "string") return error(400, input);

  const { key, record } = generateApiKey({
    merchant: merchant.address,
    name: input.name,
    environment: input.environment,
    dailyCapCents: input.dailyCapUsd * 100,
  });
  try {
    await store.createApiKey(record, MAX_ACTIVE_KEYS);
  } catch (caught) {
    if (isStoreError(caught, "too_many_keys")) return error(409, caught.message);
    throw caught;
  }
  const response: CreateApiKeyResponse = { key, apiKey: toKeySummary(record, 0) };
  return json(response, 201);
}
