import { apiCall, type PaymentSucceededEvent } from "./invoice-api";

// Test webhook deliveries (POST /api/webhooks/test), shared by the route and the console's Webhook Inspector.

/** A `payment.succeeded` body marked as a test: `test: true`, an `evt_test_` id and a `test_` signature. */
export type TestWebhookPayload = PaymentSucceededEvent & { test: true };

export interface WebhookTestDelivery {
  id: string;
  method: "POST";
  /** Where it went: the host (and "/…" for a path, which can carry a token) of SOLAGENT_WEBHOOK_URL, or the built-in receiver. */
  url: string;
  target: "configured" | "built-in receiver";
  /** Sent with X-SolAgent-Signature (SOLAGENT_WEBHOOK_SECRET is set). */
  signed: boolean;
  /** HTTP status, or null when the request itself failed (DNS, refused, timeout). */
  status: number | null;
  statusText: string;
  ok: boolean;
  latencyMs: number;
  sentAt: number;
  /** Why the request failed, when it did. */
  error: string | null;
  payload: TestWebhookPayload;
  /** The start of the receiver's response body. */
  response: string | null;
}

export const webhooksApi = {
  /** Needs the merchant session cookie (lib/auth-api). */
  test: async () => (await apiCall<{ delivery: WebhookTestDelivery }>("/api/webhooks/test", { method: "POST", body: "{}" })).delivery,
};
