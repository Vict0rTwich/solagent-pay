"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Braces, ChevronUp, ClipboardCopy, SquareTerminal, Trash2 } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { CopiedToast } from "@/components/ui/CopiedToast";
import { JsonView } from "@/components/ui/JsonView";
import { useCopy } from "@/hooks/use-copy";
import { useEngineStream, type EngineStream } from "@/hooks/use-engine-stream";
import { useMerchantSession } from "@/hooks/use-merchant-session";
import { cn } from "@/lib/cn";
import type { EngineEvent, EngineEventType } from "@/lib/engine-events";
import { truncateAddress } from "@/lib/format";
import type { NetworkConfig } from "@/lib/network";
import { useNetwork } from "@/lib/settings";

import { WebhookInspector } from "./WebhookInspector";

const OPEN_KEY = "solagent-devlog-open";
const CONSOLE_EVENT = "solagent:console";

export type ConsoleTab = "rpc" | "webhooks";

const TABS: ReadonlyArray<{ id: ConsoleTab; label: string }> = [
  { id: "rpc", label: "RPC Stream" },
  { id: "webhooks", label: "Webhook Inspector" },
];

/** Opens or closes the console from anywhere (the header's network pill); with a tab, opens on that tab. */
export function toggleConsole(tab?: ConsoleTab): void {
  window.dispatchEvent(new CustomEvent<{ tab?: ConsoleTab }>(CONSOLE_EVENT, { detail: { tab } }));
}

// Muted per-stage tints on the dark console: lifecycle bright, chain plumbing dim, verification amber, paid emerald.
const TYPE_COLOR: Record<EngineEventType, string> = {
  INVOICE_CREATED: "text-console-ink",
  WEBSOCKET_SUBSCRIBED: "text-console-ink-2",
  TX_DETECTED: "text-[#8fb4d8]",
  LAMPORT_DELTA_VERIFIED: "text-amber-300/90",
  TOKEN_DELTA_VERIFIED: "text-amber-300/90",
  STATUS_UPDATED: "text-emerald-400",
  WEBHOOK_DISPATCHED: "text-console-ink-2",
  BLINK_TX_BUILT: "text-console-ink-2",
  RECEIPT_MINT: "text-violet-300/90",
  SOCKET_STATE: "text-console-ink-3",
};

// Timestamps carry their stage's hue, a step quieter, so the pipeline reads down the left edge.
const TIME_COLOR: Record<EngineEventType, string> = {
  INVOICE_CREATED: "text-console-ink-2",
  WEBSOCKET_SUBSCRIBED: "text-console-ink-3",
  TX_DETECTED: "text-[#8fb4d8]/70",
  LAMPORT_DELTA_VERIFIED: "text-amber-300/60",
  TOKEN_DELTA_VERIFIED: "text-amber-300/60",
  STATUS_UPDATED: "text-emerald-400/70",
  WEBHOOK_DISPATCHED: "text-console-ink-3",
  BLINK_TX_BUILT: "text-console-ink-3",
  RECEIPT_MINT: "text-violet-300/60",
  SOCKET_STATE: "text-console-ink-3",
};

const short = (value: unknown) => (typeof value === "string" ? truncateAddress(value, 5) : String(value));

/** One line for the log, per event type; the full payload is below it. */
function summary(event: EngineEvent): string {
  const d = event.data;
  switch (event.type) {
    case "INVOICE_CREATED": {
      const expected = d.expected as { units: string; unit: string } | null;
      const key = d.apiKey as { name: string } | null | undefined;
      return `${String(d.invoiceId)} · ${String(d.amount)} ${String(d.currency)}${expected ? ` · expects ${expected.units} ${expected.unit}` : ""}${key ? ` · via key "${key.name}"` : ""}`;
    }
    case "WEBSOCKET_SUBSCRIBED":
      return `logsSubscribe #${String(d.subscription)} · mentions ${short(d.account)}`;
    case "TX_DETECTED":
      return `${short(d.signature)} · slot ${String(d.slot)}${d.failed ? " · failed on-chain" : ""}`;
    case "LAMPORT_DELTA_VERIFIED":
    case "TOKEN_DELTA_VERIFIED":
      return `expected ${String(d.expected)} · received ${String(d.received)} ${String(d.unit)} → ${String(d.verdict)}`;
    case "STATUS_UPDATED":
      return `${String(d.invoiceId)} ${String(d.from)} → ${String(d.to)}`;
    case "WEBHOOK_DISPATCHED":
      return `${d.test ? "TEST · " : ""}${String(d.outcome)}${d.httpStatus ? ` · HTTP ${String(d.httpStatus)}` : ""}${d.host ? ` · ${String(d.host)}` : ""}`;
    case "BLINK_TX_BUILT":
      return `${String(d.invoiceId)} · unsigned tx for ${short(d.payer)}`;
    case "RECEIPT_MINT":
      return `${String(d.invoiceId)} · cNFT ${String(d.outcome)} → ${short(d.owner)}${d.error ? ` · ${String(d.error)}` : ""}`;
    case "SOCKET_STATE":
      return `${event.network ?? "?"} websocket ${String(d.state)}`;
  }
}

function time(ms: number): string {
  return new Date(ms).toISOString().slice(11, 23);
}

function duration(ms: number): string {
  return ms < 1000 ? `${Math.max(0, Math.round(ms))}ms` : `${(ms / 1000).toFixed(1)}s`;
}

interface Latency {
  text: string;
  title: string;
}

/**
 * Measured latency per event, from the server's own timestamps. For a detected transaction: how long after its block
 * (block times are whole seconds, so about ±1 s). For the steps after it: time since the previous event of the same
 * invoice, which is the engine's per-step latency (detect → verify → paid → webhook).
 */
function latencies(events: readonly EngineEvent[]): Array<Latency | null> {
  const last = new Map<string, number>();
  return events.map((event) => {
    let latency: Latency | null = null;
    const blockTime = event.data.blockTime;
    if (event.type === "TX_DETECTED" && typeof blockTime === "number") {
      latency = { text: `≈${duration(event.at - blockTime * 1000)}`, title: "Detected this long after the transaction's block time (±1 s)" };
    } else if (event.reference && last.has(event.reference)) {
      latency = { text: `+${duration(event.at - (last.get(event.reference) ?? event.at))}`, title: "Since the previous step for this invoice" };
    }
    if (event.reference) last.set(event.reference, event.at);
    return latency;
  });
}

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

const WS_LABEL: Record<string, string> = {
  open: "WS live",
  idle: "WS idle",
  connecting: "WS connecting",
  reconnecting: "WS reconnecting",
  unavailable: "WS n/a · polling",
  closed: "WS closed",
};

function Connection({ stream, network, signedIn }: { stream: EngineStream; network: NetworkConfig; signedIn: boolean }) {
  const { status, sockets } = stream;
  const ws = sockets[network.id];
  const [dot, text, title] = !signedIn
    ? ["bg-console-ink-3", "Sign in to stream", "The stream shows your own invoices' events, so it needs your merchant session."]
    : status === "open"
      ? [
          ws === "open" ? "bg-emerald-400" : "bg-amber-400",
          `${network.shortLabel} RPC · ${WS_LABEL[ws ?? "idle"] ?? `WS ${ws}`}`,
          `Connected to the payment server's event stream on ${network.label}. The websocket opens while invoices are being watched; polling covers the rest.`,
        ]
      : status === "closed"
        ? ["bg-red-400", "Disconnected · retrying", "The event stream closed. Retrying in a few seconds."]
        : ["bg-amber-400", "Connecting…", "Opening the event stream."];
  return (
    <span
      title={title}
      className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md border border-console-line px-2 font-mono text-[10.5px] text-console-ink-2"
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", dot)} />
      <span className="hidden sm:inline">{text}</span>
      <span className="sr-only sm:hidden">{text}</span>
    </span>
  );
}

const toolClass =
  "inline-flex h-6 items-center gap-1.5 rounded-md px-2 font-mono text-[10.5px] text-console-ink-2 transition-colors hover:bg-console-raised hover:text-console-ink disabled:opacity-40 disabled:hover:bg-transparent";

/**
 * "Dev Mode": a console pinned to the bottom of the dashboard. RPC Stream: the payment engine's live events for this
 * merchant (invoice created, websocket subscribed, transaction detected, amount verified, paid, webhook sent), with
 * measured per-step latency. Webhook Inspector: delivery log and a test-webhook button.
 *
 * ` or ~ toggles it from anywhere outside a text field, and so does the header's network pill. Opening it moves focus
 * to the active tab; Escape closes it and puts focus back. It's a non-modal panel, so focus isn't trapped in it.
 */
export function DevLogDrawer() {
  const { status: session } = useMerchantSession();
  const signedIn = session === "signed-in";
  const stream = useEngineStream(signedIn);
  const network = useNetwork();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<ConsoleTab>("rpc");
  const [payloads, setPayloads] = useState(true);
  const [seen, setSeen] = useState(0);
  const copyLog = useCopy();
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const tabRefs = useRef(new Map<ConsoleTab, HTMLButtonElement>());
  const returnFocus = useRef<HTMLElement | null>(null);
  const focusOnOpen = useRef(false);

  useEffect(() => {
    try {
      setOpen(localStorage.getItem(OPEN_KEY) === "1");
    } catch {
      // Storage blocked: start collapsed.
    }
  }, []);

  const toggle = useCallback((next: boolean, options: { focus?: boolean; tab?: ConsoleTab } = {}) => {
    if (options.tab) setTab(options.tab);
    if (next && options.focus) {
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      focusOnOpen.current = true;
    }
    if (!next && returnFocus.current) {
      const target = returnFocus.current;
      returnFocus.current = null;
      requestAnimationFrame(() => target.focus());
    }
    setOpen(next);
    try {
      localStorage.setItem(OPEN_KEY, next ? "1" : "0");
    } catch {
      // Only a convenience.
    }
  }, []);

  // Keyboard openings land focus on the active tab once it's rendered.
  useEffect(() => {
    if (open && focusOnOpen.current) {
      focusOnOpen.current = false;
      tabRefs.current.get(tab)?.focus();
    }
  }, [open, tab]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.key !== "`" && event.key !== "~") || event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return;
      event.preventDefault();
      toggle(!open, { focus: true });
    };
    const onToggle = (event: Event) => {
      const requested = (event as CustomEvent<{ tab?: ConsoleTab }>).detail?.tab;
      toggle(requested && open && requested !== tab ? true : !open, { focus: true, tab: requested });
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener(CONSOLE_EVENT, onToggle);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(CONSOLE_EVENT, onToggle);
    };
  }, [open, tab, toggle]);

  const count = stream.events.length;
  useEffect(() => {
    if (open) setSeen(count);
  }, [open, count]);
  const unread = open ? 0 : Math.max(0, count - seen);
  const measured = useMemo(() => latencies(stream.events), [stream.events]);

  // Follow new events while the view is at the bottom; leave it alone while someone reads back.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (element && pinned.current) element.scrollTop = element.scrollHeight;
  }, [count, open, payloads, tab]);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && open) {
      event.stopPropagation();
      if (!returnFocus.current) returnFocus.current = document.getElementById("devlog-toggle");
      toggle(false);
    }
  };

  const onTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next: ConsoleTab = tab === "rpc" ? "webhooks" : "rpc";
    setTab(next);
    tabRefs.current.get(next)?.focus();
  };

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 lg:left-60" onKeyDown={onKeyDown}>
      <section aria-label="Developer console: RPC stream and webhooks" className="pointer-events-auto border-t border-console-line bg-console text-console-ink">
        <div className="flex h-9 items-center gap-2 px-3 sm:px-4">
          <button
            id="devlog-toggle"
            type="button"
            onClick={() => toggle(!open)}
            aria-expanded={open}
            aria-controls="devlog-panel"
            aria-keyshortcuts="` ~"
            className={cn("flex min-w-0 items-center gap-2 text-left", !open && "flex-1")}
          >
            <SquareTerminal className="size-3.5 shrink-0 text-blue-400" aria-hidden />
            <span className="truncate font-mono text-[11px] font-medium text-console-ink">
              {open ? "Console" : "Event stream"}
              {!open && <span className="hidden text-console-ink-3 sm:inline"> · Solana RPC</span>}
            </span>
            {!open && count > 0 && <span className="hidden font-mono text-[10.5px] tabular-nums text-console-ink-3 sm:inline">{count}</span>}
            {unread > 0 && (
              <span
                className="rounded-full border border-console-line bg-console-raised px-1.5 font-mono text-[10px] leading-4 tabular-nums text-console-ink"
                aria-label={`${unread} new events`}
              >
                +{unread}
              </span>
            )}
          </button>

          {open && (
            <div role="tablist" aria-label="Console views" onKeyDown={onTabKeyDown} className="flex min-w-0 flex-1 items-center gap-0.5">
              {TABS.map(({ id, label }) => {
                const selected = tab === id;
                return (
                  <button
                    key={id}
                    ref={(node) => {
                      if (node) tabRefs.current.set(id, node);
                      else tabRefs.current.delete(id);
                    }}
                    type="button"
                    role="tab"
                    id={`console-tab-${id}`}
                    aria-selected={selected}
                    aria-controls="devlog-panel"
                    tabIndex={selected ? 0 : -1}
                    onClick={() => setTab(id)}
                    className={cn(
                      "inline-flex h-6 items-center rounded-md border px-2 font-mono text-[10.5px] transition-colors",
                      selected ? "border-blue-500/30 bg-blue-500/10 text-blue-300" : "border-transparent text-console-ink-3 hover:text-console-ink-2",
                    )}
                  >
                    <span aria-hidden className="text-console-ink-3">
                      [&nbsp;
                    </span>
                    {label}
                    <span aria-hidden className="text-console-ink-3">
                      &nbsp;]
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <Connection stream={stream} network={network} signedIn={signedIn} />

          {open && tab === "rpc" && (
            <div className="flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                role="switch"
                aria-checked={payloads}
                onClick={() => setPayloads((p) => !p)}
                title={payloads ? "Hide payloads" : "Show payloads"}
                className={cn(toolClass, "hidden md:inline-flex", payloads && "text-console-ink")}
              >
                <Braces className="size-3.5" aria-hidden />
                JSON {payloads ? "on" : "off"}
              </button>
              <button type="button" onClick={stream.clear} disabled={count === 0} aria-label="Clear logs" title="Clear logs" className={toolClass}>
                <Trash2 className="size-3.5" aria-hidden />
                <span className="hidden md:inline">Clear</span>
              </button>
              <button
                type="button"
                onClick={() => void copyLog.copy(JSON.stringify(stream.events, null, 2))}
                disabled={count === 0}
                aria-label="Copy log JSON"
                title="Copy log JSON"
                className={cn(toolClass, "relative")}
              >
                <ClipboardCopy className="size-3.5" aria-hidden />
                <span className="hidden md:inline">Copy</span>
                <CopiedToast show={copyLog.copied} label={`${count} events copied`} />
              </button>
            </div>
          )}

          <kbd
            aria-hidden
            className="hidden h-5 min-w-5 items-center justify-center rounded border border-console-line bg-console-raised px-1 font-mono text-[10.5px] text-console-ink-3 md:inline-flex"
            title="Press ` or ~ to toggle"
          >
            ~
          </kbd>
          <button
            type="button"
            onClick={() => toggle(!open)}
            aria-label={open ? "Collapse the console" : "Expand the console"}
            className="grid size-6 shrink-0 place-items-center rounded-md text-console-ink-2 transition-colors hover:bg-console-raised hover:text-console-ink"
          >
            <ChevronUp className={cn("size-4 transition-transform duration-200", open && "rotate-180")} aria-hidden />
          </button>
        </div>

        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              id="devlog-panel"
              key="panel"
              role="tabpanel"
              aria-labelledby={`console-tab-${tab}`}
              initial={{ height: 0 }}
              animate={{ height: "min(45vh, 440px)" }}
              exit={{ height: 0 }}
              transition={{ type: "spring", stiffness: 420, damping: 44 }}
              className="overflow-hidden border-t border-console-line"
            >
              {tab === "webhooks" ? (
                <WebhookInspector signedIn={signedIn} events={stream.events} />
              ) : (
                <div
                  ref={scroller}
                  role="log"
                  aria-live="off"
                  onScroll={(event) => {
                    const element = event.currentTarget;
                    pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
                  }}
                  className="h-full overflow-y-auto py-1.5 font-mono text-[11.5px] leading-relaxed"
                >
                  {count === 0 ? (
                    <p className="px-4 py-8 text-center text-console-ink-3">
                      {signedIn
                        ? "Waiting for events. Create an invoice, or pay one, to watch the engine work."
                        : "Connect your wallet and sign in: the stream shows your own invoices, from creation to webhook."}
                    </p>
                  ) : (
                    <ol>
                      {stream.events.map((event, index) => (
                        <LogEntry key={event.id} event={event} latency={measured[index] ?? null} payload={payloads} />
                      ))}
                    </ol>
                  )}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </section>
    </div>
  );
}

function LogEntry({ event, latency, payload }: { event: EngineEvent; latency: Latency | null; payload: boolean }) {
  const settled = event.type === "STATUS_UPDATED" && event.data.to === "PAID";
  return (
    <motion.li
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.16 }}
      className={cn(
        "border-l-2 px-3 py-1 transition-colors hover:bg-console-raised sm:px-4",
        settled ? "border-emerald-500/70 bg-emerald-950/30" : "border-transparent",
      )}
    >
      <p className="grid min-w-0 grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 md:grid-cols-[88px_188px_64px_56px_1fr]">
        <span className={cn("tabular-nums", TIME_COLOR[event.type])}>{time(event.at)}</span>
        <span className={cn("truncate font-medium", TYPE_COLOR[event.type])} title={event.type}>
          {event.type}
        </span>
        <span className="hidden truncate tabular-nums text-console-ink-2 md:block" title={latency?.title}>
          {latency?.text ?? ""}
        </span>
        <span className="hidden truncate text-console-ink-3 md:block">{event.network ?? "—"}</span>
        <span className="col-span-2 min-w-0 break-all text-console-ink md:col-span-1">
          {summary(event)}
          {latency && <span className="ml-2 tabular-nums text-console-ink-3 md:hidden">{latency.text}</span>}
        </span>
      </p>
      {payload && <JsonView value={event.data} className="mt-1 border-l border-console-line pl-3 text-[11px] leading-[1.5] md:ml-[calc(396px_+_3rem)]" />}
    </motion.li>
  );
}
