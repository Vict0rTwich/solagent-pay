import type { EngineEvent, EngineHello } from "@/lib/engine-events";
import { requireMerchant } from "@/server/auth/session";
import { allow, clientIp, tooManyRequests } from "@/server/http";
import { paymentRuntime } from "@/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 15_000;
/** How often an open stream re-checks that its session wasn't signed out. */
const REVOCATION_CHECK_MS = 60_000;

/**
 * The payment engine's live events for the signed-in merchant, as Server-Sent Events (the dashboard's log drawer).
 * Only events about invoices that pay this merchant's wallet, plus server-wide socket state. Starts with a `hello`
 * (socket states), then replays what's buffered since Last-Event-ID, then streams. Ends when the session does.
 */
export async function GET(request: Request): Promise<Response> {
  if (!allow(`events:${clientIp(request)}`, 30)) return tooManyRequests();
  const payments = paymentRuntime();
  const merchant = await requireMerchant(request, payments.store);
  if (merchant instanceof Response) return merchant;
  // So there's a listener (and sockets) to report on, even before the first invoice of this process.
  await payments.start().catch(() => {});

  const encoder = new TextEncoder();
  const visible = (event: EngineEvent) => event.merchant === null || event.merchant === merchant.address;
  let stop = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      const write = (chunk: string) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          stop();
        }
      };
      const send = (event: EngineEvent) => {
        if (visible(event)) write(`id: ${event.id}\nevent: engine\ndata: ${JSON.stringify(event)}\n\n`);
      };

      const hello: EngineHello = { bootId: payments.events.bootId, merchant: merchant.address, sockets: payments.listener.socketStates };
      write(`retry: 3000\nevent: hello\ndata: ${JSON.stringify(hello)}\n\n`);
      for (const event of payments.events.since(request.headers.get("last-event-id"))) send(event);
      const unsubscribe = payments.events.subscribe(send);

      const heartbeat = setInterval(() => write(": ping\n\n"), HEARTBEAT_MS);
      const expiry = setTimeout(() => stop(), Math.max(0, merchant.expiresAt - Date.now()));
      const revocation = setInterval(() => {
        void payments.store.isSessionRevoked(merchant.sessionId).then((revoked) => revoked && stop(), () => {});
      }, REVOCATION_CHECK_MS);

      stop = () => {
        if (!open) return;
        open = false;
        unsubscribe();
        clearInterval(heartbeat);
        clearInterval(revocation);
        clearTimeout(expiry);
        try {
          controller.close();
        } catch {
          // Already closed by the client.
        }
      };
      request.signal.addEventListener("abort", () => stop());
    },
    cancel() {
      stop();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
      // Proxies such as nginx buffer responses by default, which would hold events back.
      "x-accel-buffering": "no",
    },
  });
}
