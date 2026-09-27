import { randomBytes } from "node:crypto";

import { encodeBase58 } from "@/lib/base58";
import { isNetworkId } from "@/lib/network";
import type { TestWebhookPayload, WebhookTestDelivery } from "@/lib/webhooks";
import { requireMerchant } from "@/server/auth/session";
import { serverConfig } from "@/server/config";
import { allow, clientIp, json, readJson, tooManyRequests } from "@/server/http";
import { publicOrigin } from "@/server/origin";
import { paymentRuntime } from "@/server/runtime";
import { signWebhook } from "@/server/webhooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TIMEOUT_MS = 10_000;
const RESPONSE_PREVIEW_BYTES = 2048;

/** The configured URL as the dashboard may show it: its host, with the path elided (it can carry a token). */
function displayUrl(raw: string): string {
  try {
    const url = new URL(raw);
    return `${url.protocol}//${url.host}${url.pathname !== "/" || url.search ? "/…" : "/"}`;
  } catch {
    return "(malformed SOLAGENT_WEBHOOK_URL)";
  }
}

/**
 * Sends one test `payment.succeeded` event, signed like a real delivery, and reports how it went: to
 * SOLAGENT_WEBHOOK_URL when it's set, else to this server's own receiver (/api/webhooks/receiver). The body is marked
 * as a test (`test: true`, an `evt_test_` id, a `test_` signature) and the request carries X-SolAgent-Test: 1, so a
 * receiver can tell it from a real payment. Nothing is queued or retried; it's one attempt, reported as it went.
 */
export async function POST(request: Request): Promise<Response> {
  if (!allow(`webhook-test:${clientIp(request)}`, 20)) return tooManyRequests();
  const payments = paymentRuntime();
  const merchant = await requireMerchant(request, payments.store);
  if (merchant instanceof Response) return merchant;
  if (!allow(`webhook-test-merchant:${merchant.address}`, 10)) return tooManyRequests();

  const body = await readJson(request);
  const requested = body && typeof body === "object" && "network" in body ? (body as { network: unknown }).network : undefined;
  const network = isNetworkId(requested) ? requested : "devnet";

  const configured = serverConfig.webhookUrl;
  const target = configured ?? `${publicOrigin(request).origin}/api/webhooks/receiver`;
  const now = Date.now();
  const payload: TestWebhookPayload = {
    id: `evt_test_${randomBytes(8).toString("hex")}`,
    event: "payment.succeeded",
    invoiceId: "INV-TEST",
    amount: "1.00",
    token: "USDC",
    signature: `test_${encodeBase58(randomBytes(32))}`,
    timestamp: Math.floor(now / 1000),
    reference: encodeBase58(randomBytes(32)),
    network,
    test: true,
  };
  const text = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "user-agent": "SolAgentPay-Webhooks/1",
    "x-solagent-event": payload.event,
    "x-solagent-event-id": payload.id,
    "x-solagent-test": "1",
  };
  const secret = serverConfig.webhookSecret;
  if (secret) headers["x-solagent-signature"] = signWebhook(secret, text, Math.floor(now / 1000));

  let status: number | null = null;
  let statusText = "";
  let response: string | null = null;
  let failure: string | null = null;
  const started = performance.now();
  try {
    // No redirects, like real deliveries: the payload goes only where it was configured to go.
    const reply = await fetch(target, { method: "POST", headers, body: text, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
    status = reply.status;
    statusText = reply.statusText;
    response = (await reply.text().catch(() => "")).slice(0, RESPONSE_PREVIEW_BYTES) || null;
  } catch (caught) {
    failure = caught instanceof Error ? (caught.name === "TimeoutError" ? `No answer within ${TIMEOUT_MS / 1000} s` : caught.message) : String(caught);
  }
  const latencyMs = Math.round(performance.now() - started);
  const ok = status !== null && status >= 200 && status < 300;

  const delivery: WebhookTestDelivery = {
    id: payload.id,
    method: "POST",
    url: configured ? displayUrl(configured) : target,
    target: configured ? "configured" : "built-in receiver",
    signed: secret !== null,
    status,
    statusText,
    ok,
    latencyMs,
    sentAt: now,
    error: failure,
    payload,
    response,
  };
  payments.events.emit({
    type: "WEBHOOK_DISPATCHED",
    network,
    merchant: merchant.address,
    reference: null,
    data: {
      eventId: payload.id,
      invoiceId: payload.invoiceId,
      test: true,
      outcome: ok ? "DELIVERED" : "FAILED",
      httpStatus: status,
      ms: latencyMs,
      host: delivery.url,
      signed: delivery.signed,
      ...(failure ? { error: failure } : {}),
      payload,
    },
  });
  return json({ delivery });
}
