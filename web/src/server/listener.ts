import type { VerificationResult } from "@/lib/invoice-api";
import type { NetworkId } from "@/lib/network";

import { backoffDelay, jitter } from "./backoff";
import type { EmitEngineEvent } from "./events";
import { LogsSocket, type SocketState } from "./logs-socket";
import type { InvoiceRecord, InvoiceStore } from "./store";

/** With the socket open it reports payments within about a second; polling is only the safety net. */
const POLL_WITH_SOCKET_MS = 60_000;
/** Without it, polling is how payments are found. */
const POLL_WITHOUT_SOCKET_MS = 12_000;
const ERROR_BACKOFF_CAP_MS = 5 * 60_000;
const TICK_MS = 1_000;
/** If the chain can't be read at an invoice's deadline, keep trying this long before expiring it anyway. */
const EXPIRY_GRACE_MS = 10 * 60_000;

interface Watch {
  reference: string;
  network: NetworkId;
  /** The wallet the invoice pays, and its number: for the event log. */
  merchant: string;
  invoiceId: string;
  nextCheckAt: number;
  failures: number;
  /** Start time of the last check that completed; an invoice is only expired after a check that began past its deadline. */
  lastCheckedAt: number;
  checking: boolean;
  again: boolean;
}

export interface ListenerDeps {
  store: InvoiceStore;
  verify: (invoiceId: string, reference: string) => Promise<VerificationResult>;
  wsUrl: (network: NetworkId) => string;
  log: (message: string) => void;
  emit: EmitEngineEvent;
}

/**
 * Watches every open invoice's reference key until the invoice is paid, canceled or expired, then lets go of it
 * (socket subscription and poll schedule both). A socket notification or a due poll triggers a verification;
 * the verifier decides, and settles, so the listener never marks anything paid itself.
 */
export class PaymentListener {
  private readonly watches = new Map<string, Watch>();
  private readonly sockets = new Map<NetworkId, LogsSocket>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;

  constructor(private readonly deps: ListenerDeps) {}

  async start(): Promise<void> {
    if (this.timer) return;
    for (const invoice of await this.deps.store.openInvoices()) this.watch(invoice);
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.deps.log(`listener started, watching ${this.watches.size} open invoice(s)`);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const socket of this.sockets.values()) socket.close();
    this.sockets.clear();
    this.watches.clear();
  }

  watch(invoice: InvoiceRecord): void {
    if (invoice.status !== "pending" || this.watches.has(invoice.reference)) return;
    this.watches.set(invoice.reference, {
      reference: invoice.reference,
      network: invoice.network,
      merchant: invoice.recipient,
      invoiceId: invoice.id,
      nextCheckAt: Date.now(),
      failures: 0,
      lastCheckedAt: 0,
      checking: false,
      again: false,
    });
    this.socketFor(invoice.network).subscribe(invoice.reference);
  }

  /** Stops everything watching this reference. Idempotent. */
  unwatch(reference: string): void {
    const watch = this.watches.get(reference);
    if (!watch) return;
    this.watches.delete(reference);
    this.sockets.get(watch.network)?.unsubscribe(reference);
  }

  /** Check now (a notification or an API request); coalesces with a check already running. */
  nudge(reference: string): void {
    const watch = this.watches.get(reference);
    if (watch) this.check(watch);
  }

  get stats() {
    return {
      watching: this.watches.size,
      sockets: Object.fromEntries([...this.sockets].map(([network, socket]) => [network, socket.stats])),
    };
  }

  /** Socket state per network with a socket, e.g. { devnet: "open" }. */
  get socketStates(): Partial<Record<NetworkId, SocketState>> {
    return Object.fromEntries([...this.sockets].map(([network, socket]) => [network, socket.state]));
  }

  private socketFor(network: NetworkId): LogsSocket {
    let socket = this.sockets.get(network);
    if (!socket) {
      socket = new LogsSocket({
        url: this.deps.wsUrl(network),
        onLogs: (reference) => this.nudge(reference),
        onSubscribed: (reference, subscription) => {
          const watch = this.watches.get(reference);
          if (!watch) return;
          this.deps.emit({
            type: "WEBSOCKET_SUBSCRIBED",
            network,
            merchant: watch.merchant,
            reference,
            data: { invoiceId: watch.invoiceId, account: reference, method: "logsSubscribe", subscription, commitment: "confirmed" },
          });
        },
        // Server-wide, so no merchant, and no endpoint URL: it can carry an RPC API key.
        onState: (state) => this.deps.emit({ type: "SOCKET_STATE", network, merchant: null, reference: null, data: { state } }),
        log: (message) => this.deps.log(`[${network}] ${message}`),
      });
      this.sockets.set(network, socket);
    }
    return socket;
  }

  private pollDelay(watch: Watch): number {
    const base = this.sockets.get(watch.network)?.state === "open" ? POLL_WITH_SOCKET_MS : POLL_WITHOUT_SOCKET_MS;
    // After RPC errors, back off per invoice (with jitter) on top of the RPC client's own retries.
    if (watch.failures > 0) return base + backoffDelay(watch.failures, base, ERROR_BACKOFF_CAP_MS);
    // Jitter spreads invoices out, so they don't all poll in the same second.
    return jitter(base, 0.25);
  }

  private check(watch: Watch): void {
    if (watch.checking) {
      watch.again = true;
      return;
    }
    watch.checking = true;
    const startedAt = Date.now();
    void (async () => {
      try {
        const invoice = await this.deps.store.get(watch.reference);
        if (!invoice || invoice.status !== "pending") {
          this.unwatch(watch.reference);
          return;
        }
        const result = await this.deps.verify(invoice.id, invoice.reference);
        watch.failures = 0;
        watch.lastCheckedAt = startedAt;
        if (result.invoiceStatus !== "pending") {
          if (result.settledNow) this.deps.log(`${invoice.id} paid by ${result.signature ?? "?"}`);
          this.unwatch(watch.reference);
        }
      } catch (error) {
        watch.failures++;
        this.deps.log(`check of ${watch.reference.slice(0, 8)}… failed (${watch.failures}x): ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        watch.checking = false;
        watch.nextCheckAt = Date.now() + this.pollDelay(watch);
        if (watch.again && this.watches.has(watch.reference)) {
          watch.again = false;
          this.check(watch);
        }
      }
    })();
  }

  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const now = Date.now();
      // Picks up invoices created since, and drops ones that were settled or canceled elsewhere (e.g. the API).
      const open = await this.deps.store.openInvoices();
      const openReferences = new Set(open.map((invoice) => invoice.reference));
      for (const reference of [...this.watches.keys()]) if (!openReferences.has(reference)) this.unwatch(reference);

      for (const invoice of open) {
        this.watch(invoice);
        const watch = this.watches.get(invoice.reference);
        if (!watch) continue;

        if (invoice.expiresAt <= now) {
          // Expire only after a check that started past the deadline found nothing, so a payment that landed
          // just before the deadline still counts. If the chain can't be read, give it a grace period.
          const checkedAfterDeadline = watch.lastCheckedAt >= invoice.expiresAt;
          if (checkedAfterDeadline || now > invoice.expiresAt + EXPIRY_GRACE_MS) {
            const { changed } = await this.deps.store.expire(invoice.reference, now);
            if (changed) {
              this.deps.log(`${invoice.id} expired unpaid`);
              this.deps.emit({
                type: "STATUS_UPDATED",
                network: invoice.network,
                merchant: invoice.recipient,
                reference: invoice.reference,
                data: { invoiceId: invoice.id, from: "PENDING", to: "EXPIRED", expiresAt: invoice.expiresAt },
              });
            }
            this.unwatch(invoice.reference);
            continue;
          }
          if (watch.failures === 0) watch.nextCheckAt = Math.min(watch.nextCheckAt, now);
        }

        if (!watch.checking && watch.nextCheckAt <= now) this.check(watch);
      }
    } catch (error) {
      this.deps.log(`listener tick failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.ticking = false;
    }
  }
}
