"use client";

import { ChevronRight, LoaderCircle, Send } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { JsonView } from "@/components/ui/JsonView";
import { toast } from "@/components/ui/Toaster";
import { cn } from "@/lib/cn";
import type { EngineEvent } from "@/lib/engine-events";
import { describeApiError, invoiceApi, type WebhookHealth } from "@/lib/invoice-api";
import { webhooksApi, type WebhookTestDelivery } from "@/lib/webhooks";

const REASON: Record<number, string> = {
  200: "OK",
  201: "Created",
  202: "Accepted",
  204: "No Content",
  301: "Moved Permanently",
  302: "Found",
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  408: "Request Timeout",
  413: "Payload Too Large",
  429: "Too Many Requests",
  500: "Internal Server Error",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
};

/** One delivery attempt, whether it's a test sent from here or a real `payment.succeeded` from the stream. */
interface Delivery {
  id: string;
  at: number;
  url: string;
  status: number | null;
  statusText: string;
  ok: boolean;
  latencyMs: number | null;
  /** DELIVERED / RETRYING / FAILED / SKIPPED, as the dispatcher reported it. */
  outcome: string;
  test: boolean;
  signed: boolean;
  error: string | null;
  attempt: number | null;
  payload: unknown;
  response: string | null;
}

function fromTest(delivery: WebhookTestDelivery): Delivery {
  return {
    id: delivery.id,
    at: delivery.sentAt,
    url: delivery.url,
    status: delivery.status,
    statusText: delivery.statusText,
    ok: delivery.ok,
    latencyMs: delivery.latencyMs,
    outcome: delivery.ok ? "DELIVERED" : "FAILED",
    test: true,
    signed: delivery.signed,
    error: delivery.error,
    attempt: null,
    payload: delivery.payload,
    response: delivery.response,
  };
}

/** A real delivery the dispatcher reported (WEBHOOK_DISPATCHED). Test deliveries are shown from their own response. */
function fromEvent(event: EngineEvent): Delivery | null {
  const d = event.data;
  if (event.type !== "WEBHOOK_DISPATCHED" || d.test === true) return null;
  const status = typeof d.httpStatus === "number" ? d.httpStatus : null;
  return {
    id: event.id,
    at: event.at,
    url: typeof d.host === "string" ? d.host : "SOLAGENT_WEBHOOK_URL not set",
    status,
    statusText: "",
    ok: d.outcome === "DELIVERED",
    latencyMs: typeof d.ms === "number" ? d.ms : null,
    outcome: String(d.outcome),
    test: false,
    signed: d.signed === true,
    error: typeof d.error === "string" ? d.error : typeof d.reason === "string" ? d.reason : null,
    attempt: typeof d.attempt === "number" ? d.attempt : null,
    payload: d.payload ?? null,
    response: null,
  };
}

/**
 * The console's second tab: where `payment.succeeded` goes, how each delivery went (status, latency, payload), and a
 * button that sends a signed test event to SOLAGENT_WEBHOOK_URL, or to the built-in receiver while that isn't set.
 */
export function WebhookInspector({ signedIn, events }: { signedIn: boolean; events: readonly EngineEvent[] }) {
  const [tests, setTests] = useState<Delivery[]>([]);
  const [sending, setSending] = useState(false);
  const [health, setHealth] = useState<WebhookHealth | "unreachable" | null>(null);

  useEffect(() => {
    let cancelled = false;
    invoiceApi.webhookHealth().then(
      (webhooks) => !cancelled && setHealth(webhooks),
      () => !cancelled && setHealth("unreachable"),
    );
    return () => {
      cancelled = true;
    };
  }, [tests.length]);

  const deliveries = useMemo(
    () => [...tests, ...events.flatMap((event) => fromEvent(event) ?? [])].sort((a, b) => b.at - a.at),
    [tests, events],
  );

  const send = async () => {
    setSending(true);
    try {
      const delivery = await webhooksApi.test();
      setTests((list) => [fromTest(delivery), ...list].slice(0, 50));
      toast(delivery.ok ? `Test webhook delivered: HTTP ${delivery.status} in ${delivery.latencyMs}ms` : "Test webhook failed; see the delivery log", delivery.ok ? "success" : "error");
    } catch (caught) {
      toast(describeApiError(caught), "error");
    } finally {
      setSending(false);
    }
  };

  const configured = health !== null && health !== "unreachable" && health.configured;
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-console-line px-3 py-2 font-mono text-[11px] sm:px-4">
        <span className="text-console-ink-3">
          Endpoint{" "}
          <span className={configured ? "text-console-ink" : "text-amber-300/90"}>
            {health === null ? "…" : health === "unreachable" ? "server unreachable" : configured ? "SOLAGENT_WEBHOOK_URL" : "not set · tests use the built-in receiver"}
          </span>
        </span>
        {health !== null && health !== "unreachable" && (
          <>
            <span className="text-console-ink-3">
              Signing <span className={health.signed ? "text-emerald-400" : "text-amber-300/90"}>{health.signed ? "HMAC-SHA256" : "unsigned"}</span>
            </span>
            <span className="tabular-nums text-console-ink-3">
              Delivered <span className="text-console-ink">{health.delivered}</span> · queued <span className="text-console-ink">{health.queued}</span> · failed{" "}
              <span className={health.failed ? "text-red-400" : "text-console-ink"}>{health.failed}</span>
            </span>
          </>
        )}
        <button
          type="button"
          onClick={() => void send()}
          disabled={!signedIn || sending}
          title={signedIn ? "POST a signed test payment.succeeded event" : "Sign in to send a test webhook"}
          className="btn-primary ml-auto inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 font-sans text-xs disabled:cursor-not-allowed disabled:opacity-50"
        >
          {sending ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> : <Send className="size-3.5" aria-hidden />}
          Send test webhook
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 sm:px-4">
        {deliveries.length === 0 ? (
          <p className="py-8 text-center font-mono text-[11.5px] text-console-ink-3">
            {signedIn
              ? "No deliveries yet. Send a test webhook, or get paid: each payment.succeeded shows up here."
              : "Sign in to send test webhooks and see deliveries for your invoices."}
          </p>
        ) : (
          <ol className="space-y-1.5">
            {deliveries.map((delivery) => (
              <DeliveryCard key={delivery.id} delivery={delivery} />
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

function DeliveryCard({ delivery }: { delivery: Delivery }) {
  const [openSection, setOpenSection] = useState<"payload" | "response" | null>(null);
  const statusTone = delivery.ok
    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
    : delivery.outcome === "SKIPPED"
      ? "border-slate-500/30 bg-slate-500/10 text-slate-300"
      : delivery.outcome === "RETRYING"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
        : "border-red-500/30 bg-red-500/10 text-red-400";
  const statusLabel =
    delivery.status !== null ? `${delivery.status} ${delivery.statusText || REASON[delivery.status] || ""}`.trim() : delivery.outcome === "SKIPPED" ? "SKIPPED" : "ERR";

  return (
    <li className="rounded-md border border-console-line bg-console-raised/60 font-mono text-[11.5px]">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-2.5 py-2">
        <span className="rounded border border-blue-500/30 bg-blue-500/10 px-1.5 text-[10px] font-medium leading-4 text-blue-300">POST</span>
        <span className="min-w-0 flex-1 truncate text-console-ink" title={delivery.url}>
          {delivery.url}
        </span>
        <span className={cn("rounded border px-1.5 text-[10.5px] font-medium leading-4 tabular-nums", statusTone)}>{statusLabel}</span>
        <span className="w-14 text-right tabular-nums text-console-ink-2" title="Round trip">
          {delivery.latencyMs === null ? "—" : `${delivery.latencyMs}ms`}
        </span>
        <span className="tabular-nums text-console-ink-3">{new Date(delivery.at).toISOString().slice(11, 23)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-console-line px-2.5 py-1.5 text-[10.5px] text-console-ink-3">
        {delivery.test && <span className="rounded border border-console-line px-1 leading-4 text-console-ink-2">TEST</span>}
        <span>payment.succeeded</span>
        <span>· {delivery.signed ? "signed" : "unsigned"}</span>
        {!delivery.test && <span>· {delivery.outcome.toLowerCase()}</span>}
        {delivery.attempt !== null && <span className="tabular-nums">· attempt {delivery.attempt}</span>}
        {delivery.error && <span className="text-red-400">· {delivery.error}</span>}
        <span className="ml-auto flex gap-1">
          <SectionToggle label="Payload" open={openSection === "payload"} onClick={() => setOpenSection(openSection === "payload" ? null : "payload")} />
          {delivery.response !== null && (
            <SectionToggle label="Response" open={openSection === "response"} onClick={() => setOpenSection(openSection === "response" ? null : "response")} />
          )}
        </span>
      </div>
      {openSection === "payload" && <JsonView value={delivery.payload} className="border-t border-console-line px-2.5 py-2 text-[11px] leading-[1.5]" />}
      {openSection === "response" && delivery.response !== null && (
        <pre className="overflow-x-auto whitespace-pre-wrap break-all border-t border-console-line px-2.5 py-2 text-[11px] leading-[1.5] text-console-ink-2">
          {delivery.response}
        </pre>
      )}
    </li>
  );
}

function SectionToggle({ label, open, onClick }: { label: string; open: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      className="inline-flex h-5 items-center gap-0.5 rounded px-1 text-console-ink-2 transition-colors hover:bg-console-line hover:text-console-ink"
    >
      <ChevronRight className={cn("size-3 transition-transform", open && "rotate-90")} aria-hidden />
      {label}
    </button>
  );
}
