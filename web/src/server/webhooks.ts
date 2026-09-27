import { createHmac, timingSafeEqual } from "node:crypto";

import { jitter } from "./backoff";
import type { EmitEngineEvent } from "./events";
import type { InvoiceStore, WebhookEventRecord } from "./store";

/** Wait before retry n (after attempt n failed): about 11 hours in total, then the event is marked failed. */
const RETRY_SCHEDULE_MS = [10_000, 30_000, 2 * 60_000, 10 * 60_000, 30 * 60_000, 60 * 60_000, 3 * 60 * 60_000, 6 * 60 * 60_000];
const DELIVERY_TIMEOUT_MS = 10_000;
/** How long a claimed event is ours: the delivery timeout plus slack for the store writes around it. */
const LEASE_MS = DELIVERY_TIMEOUT_MS + 30_000;
/** Bound on deliveries per sweep, so one sweep can't run forever while events keep arriving. */
const MAX_PER_SWEEP = 100;
const SWEEP_MS = 5_000;

export interface WebhookConfig {
  url: string | null;
  secret: string | null;
}

/**
 * `X-SolAgent-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">`. The receiver recomputes it with
 * the shared secret, compares in constant time and rejects old timestamps, which stops forged and replayed calls.
 */
export function signWebhook(secret: string, body: string, timestamp: number): string {
  const digest = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${digest}`;
}

/** Signatures older (or newer) than this are refused, so a captured delivery can't be replayed later. */
export const SIGNATURE_TOLERANCE_S = 5 * 60;

/** What a receiver should do with an X-SolAgent-Signature header: null when it's valid, else why it isn't. */
export function checkWebhookSignature(secret: string, body: string, header: string | null, now = Date.now()): string | null {
  if (!header) return "missing X-SolAgent-Signature";
  const parts = Object.fromEntries(header.split(",").map((part) => part.split("=", 2) as [string, string]));
  const timestamp = Number(parts.t);
  if (!Number.isInteger(timestamp) || !parts.v1) return "malformed X-SolAgent-Signature";
  if (Math.abs(now / 1000 - timestamp) > SIGNATURE_TOLERANCE_S) return "signature timestamp is outside the 5-minute window";
  const expected = Buffer.from(signWebhook(secret, body, timestamp).split("v1=")[1] ?? "", "hex");
  const received = Buffer.from(parts.v1, "hex");
  return expected.length === received.length && timingSafeEqual(expected, received) ? null : "signature doesn't match";
}

/**
 * Delivers queued events (the outbox the store fills when an invoice is paid). Delivery is at least once:
 * an event is retried until a 2xx, always with the same `id` (also sent as X-SolAgent-Event-Id), so the
 * receiver can drop repeats. Events are only ever queued once per invoice, by the store, and each delivery
 * leases its event first, so dispatchers in several instances don't send the same event at the same time.
 */
export class WebhookDispatcher {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private again = false;
  private warnedUnsigned = false;
  delivered = 0;
  failed = 0;

  constructor(
    private readonly store: InvoiceStore,
    private readonly config: WebhookConfig,
    private readonly log: (message: string) => void,
    private readonly emit: EmitEngineEvent,
  ) {}

  /**
   * One delivery attempt, for the merchant's event log. The URL's host only: its path and query can carry a token.
   * Skipped without a merchant: an event nobody can be sure belongs to them is shown to no one.
   */
  private async report(event: WebhookEventRecord, data: Record<string, unknown>): Promise<void> {
    const invoice = await this.store.get(event.reference).catch(() => null);
    if (!invoice) return;
    let host: string | null = null;
    try {
      host = this.config.url ? new URL(this.config.url).host : null;
    } catch {
      // A malformed URL fails the delivery itself; the log just leaves the host out.
    }
    this.emit({
      type: "WEBHOOK_DISPATCHED",
      network: invoice.network,
      merchant: invoice.recipient,
      reference: event.reference,
      data: { eventId: event.id, invoiceId: invoice.id, host, signed: this.config.secret !== null, ...data, payload: event.payload },
    });
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.kick(), SWEEP_MS);
    this.kick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Delivers whatever is due now (e.g. right after a payment settles). */
  kick(): void {
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    void this.deliverDue()
      .catch((error: unknown) => this.log(`webhook sweep failed: ${String(error)}`))
      .finally(() => {
        this.running = false;
        if (this.again) {
          this.again = false;
          this.kick();
        }
      });
  }

  private async deliverDue(): Promise<void> {
    for (let delivered = 0; delivered < MAX_PER_SWEEP; delivered++) {
      const event = await this.store.claimDueEvent(LEASE_MS);
      if (!event) return;
      await this.deliver(event);
    }
  }

  private async deliver(event: WebhookEventRecord): Promise<void> {
    const { url, secret } = this.config;
    if (!url) {
      await this.store.updateEvent(event.id, { status: "skipped", lastError: "SOLAGENT_WEBHOOK_URL isn't set" });
      await this.report(event, { outcome: "SKIPPED", reason: "SOLAGENT_WEBHOOK_URL isn't set" });
      return;
    }
    if (!secret && !this.warnedUnsigned) {
      this.warnedUnsigned = true;
      this.log("SOLAGENT_WEBHOOK_SECRET isn't set: webhooks go out unsigned, so receivers can't tell them from forgeries.");
    }

    const body = JSON.stringify(event.payload);
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "user-agent": "SolAgentPay-Webhooks/1",
      "x-solagent-event": event.payload.event,
      "x-solagent-event-id": event.id,
    };
    if (secret) headers["x-solagent-signature"] = signWebhook(secret, body, Math.floor(Date.now() / 1000));

    let problem: string | null = null;
    let httpStatus: number | null = null;
    const startedAt = Date.now();
    try {
      // No redirects: the payload goes only where it was configured to go.
      const response = await fetch(url, { method: "POST", headers, body, redirect: "manual", signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS) });
      await response.body?.cancel().catch(() => {});
      httpStatus = response.status;
      if (response.status < 200 || response.status >= 300) problem = `HTTP ${response.status}`;
    } catch (error) {
      problem = error instanceof Error ? error.message : String(error);
    }

    const attempts = event.attempts + 1;
    const attempt = { attempt: attempts, httpStatus, ms: Date.now() - startedAt };
    if (!problem) {
      this.delivered++;
      await this.store.updateEvent(event.id, { status: "delivered", attempts, deliveredAt: Date.now(), lastError: null });
      this.log(`webhook ${event.id} delivered (attempt ${attempts})`);
      await this.report(event, { outcome: "DELIVERED", ...attempt });
      return;
    }
    const wait = RETRY_SCHEDULE_MS[attempts - 1];
    if (wait === undefined) {
      this.failed++;
      await this.store.updateEvent(event.id, { status: "failed", attempts, lastError: problem });
      this.log(`webhook ${event.id} failed for good after ${attempts} attempts: ${problem}`);
      await this.report(event, { outcome: "FAILED", error: problem, ...attempt });
      return;
    }
    await this.store.updateEvent(event.id, { attempts, nextAttemptAt: Date.now() + jitter(wait), lastError: problem });
    this.log(`webhook ${event.id} attempt ${attempts} failed (${problem}); retrying in ~${Math.round(wait / 1000)} s`);
    await this.report(event, { outcome: "RETRYING", error: problem, retryInSeconds: Math.round(wait / 1000), ...attempt });
  }
}
