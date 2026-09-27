import { currencyOfMint } from "@/lib/currency";
import type { NetworkId } from "@/lib/network";

import { rpcEndpoint, serverConfig, wsEndpoint } from "./config";
import { EngineEvents } from "./events";
import { PaymentListener } from "./listener";
import { ReceiptMinter } from "./receipts";
import { createRpcClient, type RpcClient } from "./rpc";
import { createStore } from "./store";
import { createVerifier } from "./verify";
import { WebhookDispatcher } from "./webhooks";

function log(message: string): void {
  console.log(`[solagent-pay] ${message}`);
}

function createRuntime() {
  const store = createStore(log);
  const events = new EngineEvents();
  const rpcClients = new Map<NetworkId, RpcClient>();
  const rpc = (network: NetworkId): RpcClient => {
    let client = rpcClients.get(network);
    if (!client) {
      client = createRpcClient(rpcEndpoint(network), serverConfig.rpcRequestsPerSecond);
      rpcClients.set(network, client);
    }
    return client;
  };

  const webhooks = new WebhookDispatcher(store, { url: serverConfig.webhookUrl, secret: serverConfig.webhookSecret }, log, events.emit);
  // Orders whose product has no image get the generated token icon on their receipt, which needs a public origin.
  const iconUrl = (invoice: { mint: string | null }) =>
    serverConfig.appUrl ? new URL(`/api/actions/icon?currency=${currencyOfMint(invoice.mint) ?? "USDC"}`, serverConfig.appUrl).toString() : null;
  const receipts = new ReceiptMinter(store, serverConfig.underdog, iconUrl, log, events.emit);
  const { verifyInvoicePayment } = createVerifier({
    store,
    rpc: (invoice) => rpc(invoice.network),
    // The same write that marked it paid queued its webhook event and the buyer's receipt: send both now.
    onSettled: () => {
      webhooks.kick();
      receipts.kick();
    },
    emit: events.emit,
  });
  const listener = new PaymentListener({ store, verify: verifyInvoicePayment, wsUrl: wsEndpoint, log, emit: events.emit });

  let started: Promise<void> | null = null;
  return {
    store,
    events,
    listener,
    webhooks,
    receipts,
    rpc,
    verifyInvoicePayment,
    /** Starts the listener, webhook delivery and receipt minting once; later calls wait for the same start. */
    start(): Promise<void> {
      started ??= (async () => {
        await listener.start();
        webhooks.start();
        receipts.start();
      })().catch((error: unknown) => {
        started = null;
        throw error;
      });
      return started;
    },
    async stats() {
      return {
        invoices: await store.stats(),
        listener: listener.stats,
        webhooks: {
          configured: serverConfig.webhookUrl !== null,
          signed: serverConfig.webhookSecret !== null,
          queued: await store.pendingEventCount(),
          delivered: webhooks.delivered,
          failed: webhooks.failed,
        },
        receipts: { mode: receipts.configured ? `underdog (${serverConfig.underdog.network})` : "simulated" },
        rpc: Object.fromEntries([...rpcClients].map(([network, client]) => [network, { ...client.stats, paused: client.gate.paused }])),
      };
    },
  };
}

export type PaymentRuntime = ReturnType<typeof createRuntime>;

const RUNTIME = Symbol.for("solagent-pay.payment-runtime");

/**
 * The process-wide payment runtime. Kept on globalThis: Next.js loads route handlers and instrumentation in
 * separate bundles, and dev reloads re-run modules, and there must still be exactly one store (one writer for the
 * file store, one connection pool for the database) and one listener (one set of subscriptions).
 */
export function paymentRuntime(): PaymentRuntime {
  const holder = globalThis as typeof globalThis & { [RUNTIME]?: PaymentRuntime };
  holder[RUNTIME] ??= createRuntime();
  return holder[RUNTIME];
}

/** Server-side verdict for an invoice's payment; see createVerifier. */
export function verifyInvoicePayment(invoiceId: string, referenceKey: string) {
  return paymentRuntime().verifyInvoicePayment(invoiceId, referenceKey);
}
