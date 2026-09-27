import { backoffDelay } from "./backoff";

export type SocketState = "idle" | "connecting" | "open" | "reconnecting" | "unavailable" | "closed";

export interface LogsSocketOptions {
  url: string;
  /** A transaction mentioning `reference` reached "confirmed". */
  onLogs: (reference: string, signature: string) => void;
  /** The RPC accepted the logsSubscribe for `reference`. */
  onSubscribed?: (reference: string, subscription: number) => void;
  onState?: (state: SocketState) => void;
  log?: (message: string) => void;
}

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_CAP_MS = 60_000;
const HEARTBEAT_MS = 20_000;
/** No message at all for this long (not even a heartbeat reply) means the connection is dead. */
const STALE_MS = 50_000;
const RESUBSCRIBE_BASE_MS = 2_000;

interface PendingRequest {
  reference: string;
  kind: "subscribe" | "unsubscribe";
}

/**
 * One websocket to a Solana RPC's pubsub endpoint, with a `logsSubscribe` (mentions: [reference]) per watched
 * reference key at "confirmed" commitment.
 *
 * - `wanted` is the source of truth. Subscribing twice is a no-op, and a subscription confirmed after its
 *   reference was dropped is unsubscribed straight away, so nothing leaks or doubles up.
 * - When the connection drops (network, server restart, rate limit), every server-side subscription dies with
 *   it. The maps are cleared, the socket reconnects with exponential backoff and jitter, and everything in
 *   `wanted` is subscribed again.
 * - A heartbeat notices a connection that silently stopped delivering.
 * - With nothing wanted, the socket closes; it reopens on the next subscribe.
 */
export class LogsSocket {
  private socket: WebSocket | null = null;
  private currentState: SocketState = "idle";
  private readonly wanted = new Set<string>();
  private readonly subscriptionByReference = new Map<string, number>();
  private readonly referenceBySubscription = new Map<number, string>();
  private readonly pending = new Map<number, PendingRequest>();
  private readonly retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly retryAttempts = new Map<string, number>();
  private nextId = 1;
  private reconnectAttempts = 0;
  private reconnects = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastMessageAt = 0;
  private closed = false;

  constructor(private readonly options: LogsSocketOptions) {}

  get state(): SocketState {
    return this.currentState;
  }

  get stats() {
    return {
      state: this.currentState,
      wanted: this.wanted.size,
      subscribed: this.subscriptionByReference.size,
      reconnects: this.reconnects,
    };
  }

  subscribe(reference: string): void {
    if (this.closed || this.wanted.has(reference)) return;
    this.wanted.add(reference);
    if (this.currentState === "open") this.sendSubscribe(reference);
    else this.connect();
  }

  unsubscribe(reference: string): void {
    if (!this.wanted.delete(reference)) return;
    this.clearRetry(reference);
    const id = this.subscriptionByReference.get(reference);
    if (id !== undefined) {
      this.subscriptionByReference.delete(reference);
      this.referenceBySubscription.delete(id);
      this.send({ method: "logsUnsubscribe", params: [id] }, { reference, kind: "unsubscribe" });
    }
    if (this.wanted.size === 0) this.disconnect("idle");
  }

  /** Stops for good (server shutdown or hot reload). */
  close(): void {
    this.closed = true;
    for (const reference of [...this.retryTimers.keys()]) this.clearRetry(reference);
    this.wanted.clear();
    this.disconnect("closed");
  }

  private setState(state: SocketState): void {
    if (state === this.currentState) return;
    this.currentState = state;
    this.options.log?.(`logs socket ${state}`);
    this.options.onState?.(state);
  }

  private connect(): void {
    if (this.closed || this.socket || this.reconnectTimer) return;
    if (typeof WebSocket === "undefined") {
      // Node < 22 has no WebSocket; polling carries on alone.
      this.setState("unavailable");
      return;
    }
    this.setState(this.reconnectAttempts > 0 ? "reconnecting" : "connecting");

    const socket = new WebSocket(this.options.url);
    this.socket = socket;
    socket.addEventListener("open", () => {
      if (this.socket !== socket) return;
      this.reconnectAttempts = 0;
      this.lastMessageAt = Date.now();
      this.setState("open");
      this.startHeartbeat();
      for (const reference of this.wanted) this.sendSubscribe(reference);
    });
    socket.addEventListener("message", (event) => {
      if (this.socket !== socket) return;
      this.lastMessageAt = Date.now();
      this.handleMessage(typeof event.data === "string" ? event.data : "");
    });
    socket.addEventListener("close", () => {
      if (this.socket !== socket) return;
      this.dropConnection();
      this.scheduleReconnect();
    });
    // An error is always followed by close, which does the cleanup.
    socket.addEventListener("error", () => {});
  }

  /** Forgets everything tied to the current connection; the server has already dropped those subscriptions. */
  private dropConnection(): void {
    this.stopHeartbeat();
    this.socket = null;
    this.subscriptionByReference.clear();
    this.referenceBySubscription.clear();
    this.pending.clear();
    for (const reference of [...this.retryTimers.keys()]) this.clearRetry(reference);
  }

  private scheduleReconnect(): void {
    if (this.closed || this.wanted.size === 0) {
      this.setState(this.closed ? "closed" : "idle");
      return;
    }
    const delay = RECONNECT_BASE_MS + backoffDelay(this.reconnectAttempts++, RECONNECT_BASE_MS, RECONNECT_CAP_MS);
    this.reconnects++;
    this.setState("reconnecting");
    this.options.log?.(`logs socket reconnecting in ${Math.round(delay)} ms`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private disconnect(state: SocketState): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const socket = this.socket;
    this.dropConnection();
    this.reconnectAttempts = 0;
    socket?.close();
    this.setState(state);
  }

  /** `request` is null for messages whose reply doesn't matter (heartbeats), so nothing waits on them. */
  private send(body: Record<string, unknown>, request: PendingRequest | null): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    const id = this.nextId++;
    if (request) this.pending.set(id, request);
    this.socket.send(JSON.stringify({ jsonrpc: "2.0", id, ...body }));
  }

  private sendSubscribe(reference: string): void {
    const alreadyAsked = [...this.pending.values()].some((p) => p.kind === "subscribe" && p.reference === reference);
    if (this.subscriptionByReference.has(reference) || alreadyAsked) return;
    this.send({ method: "logsSubscribe", params: [{ mentions: [reference] }, { commitment: "confirmed" }] }, { reference, kind: "subscribe" });
  }

  private handleMessage(raw: string): void {
    let message: { id?: unknown; result?: unknown; error?: unknown; method?: unknown; params?: unknown };
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }

    if (message.method === "logsNotification") {
      const params = message.params as { subscription?: number; result?: { value?: { signature?: string } } } | undefined;
      const reference = params?.subscription === undefined ? undefined : this.referenceBySubscription.get(params.subscription);
      const signature = params?.result?.value?.signature;
      if (reference && signature) this.options.onLogs(reference, signature);
      return;
    }

    if (typeof message.id !== "number") return;
    const request = this.pending.get(message.id);
    if (!request) return;
    this.pending.delete(message.id);
    if (request.kind !== "subscribe" || !request.reference) return;

    const reference = request.reference;
    if (typeof message.result === "number") {
      if (this.wanted.has(reference)) {
        this.subscriptionByReference.set(reference, message.result);
        this.referenceBySubscription.set(message.result, reference);
        this.retryAttempts.delete(reference);
        this.options.onSubscribed?.(reference, message.result);
      } else {
        // Dropped while the request was in flight: close it rather than leak it.
        this.send({ method: "logsUnsubscribe", params: [message.result] }, { reference, kind: "unsubscribe" });
      }
    } else if (this.wanted.has(reference)) {
      // Refused (e.g. too many subscriptions): try that one again later; polling covers it meanwhile.
      this.retrySubscribe(reference);
    }
  }

  private retrySubscribe(reference: string): void {
    if (this.retryTimers.has(reference)) return;
    const attempt = this.retryAttempts.get(reference) ?? 0;
    this.retryAttempts.set(reference, attempt + 1);
    const timer = setTimeout(
      () => {
        this.retryTimers.delete(reference);
        if (this.wanted.has(reference) && this.currentState === "open") this.sendSubscribe(reference);
      },
      RESUBSCRIBE_BASE_MS + backoffDelay(attempt, RESUBSCRIBE_BASE_MS, RECONNECT_CAP_MS),
    );
    this.retryTimers.set(reference, timer);
  }

  private clearRetry(reference: string): void {
    const timer = this.retryTimers.get(reference);
    if (timer) clearTimeout(timer);
    this.retryTimers.delete(reference);
    this.retryAttempts.delete(reference);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (Date.now() - this.lastMessageAt > STALE_MS) {
        this.options.log?.("logs socket went quiet; reconnecting");
        this.socket?.close();
        return;
      }
      // Any reply (even "method not found") proves the connection still carries messages both ways.
      this.send({ method: "ping" }, null);
    }, HEARTBEAT_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }
}
