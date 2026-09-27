import { serverConfig } from "@/server/config";
import { allow, clientIp, error, json, tooManyRequests } from "@/server/http";
import { checkWebhookSignature } from "@/server/webhooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 64 * 1024;

/**
 * A built-in webhook receiver: where test deliveries go while SOLAGENT_WEBHOOK_URL isn't set, and a reference for
 * what a real receiver does. It checks X-SolAgent-Signature (when SOLAGENT_WEBHOOK_SECRET is set), answers 2xx
 * quickly, and does nothing else: no state, nothing stored.
 */
export async function POST(request: Request): Promise<Response> {
  if (!allow(`webhook-receiver:${clientIp(request)}`, 60)) return tooManyRequests();
  const body = await request.text();
  if (body.length > MAX_BODY_BYTES) return error(413, "Webhook bodies are small; this one isn't.");

  const secret = serverConfig.webhookSecret;
  if (secret) {
    const problem = checkWebhookSignature(secret, body, request.headers.get("x-solagent-signature"));
    if (problem) return error(401, `Rejected: ${problem}.`);
  }

  let event: unknown;
  try {
    event = JSON.parse(body);
  } catch {
    return error(400, "The body isn't JSON.");
  }
  const fields = event && typeof event === "object" ? (event as Record<string, unknown>) : {};
  if (typeof fields.event !== "string" || typeof fields.id !== "string") return error(400, "Expected an event with `id` and `event`.");
  return json({ received: true, id: fields.id, event: fields.event, verified: secret !== null, test: fields.test === true });
}
