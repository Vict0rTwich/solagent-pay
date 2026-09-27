"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { EngineEvent, EngineHello } from "@/lib/engine-events";

export type StreamStatus = "off" | "connecting" | "open" | "closed";

const MAX_EVENTS = 500;
/** After the server ends a stream for good (session over, server gone), try a fresh one this often. */
const RETRY_MS = 5_000;

export interface EngineStream {
  status: StreamStatus;
  events: readonly EngineEvent[];
  /** logsSubscribe socket state per network, as the server reports it. */
  sockets: Record<string, string>;
  clear: () => void;
}

/**
 * The payment engine's live events (GET /api/dev/events) while `enabled` (a merchant is signed in). EventSource
 * reconnects on its own after network blips, resuming from the last event id; duplicates are dropped by id.
 */
export function useEngineStream(enabled: boolean): EngineStream {
  const [status, setStatus] = useState<StreamStatus>("off");
  const [events, setEvents] = useState<EngineEvent[]>([]);
  const [sockets, setSockets] = useState<Record<string, string>>({});
  const [attempt, setAttempt] = useState(0);
  // Events up to this server time were cleared: a fresh connection replays the server's buffer, and they stay gone.
  const clearedThrough = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setStatus("off");
      return;
    }
    setStatus("connecting");
    const source = new EventSource("/api/dev/events");
    let retry: ReturnType<typeof setTimeout> | undefined;

    source.addEventListener("hello", (message) => {
      const hello = JSON.parse((message as MessageEvent<string>).data) as EngineHello;
      setSockets(hello.sockets);
      setStatus("open");
    });
    source.addEventListener("engine", (message) => {
      const event = JSON.parse((message as MessageEvent<string>).data) as EngineEvent;
      if (event.type === "SOCKET_STATE" && event.network) {
        const network = event.network;
        setSockets((current) => ({ ...current, [network]: String(event.data.state) }));
      }
      if (event.at <= clearedThrough.current) return;
      setEvents((list) => (list.some((known) => known.id === event.id) ? list : [...list, event].slice(-MAX_EVENTS)));
    });
    source.onerror = () => {
      if (source.readyState !== EventSource.CLOSED) {
        setStatus("connecting");
        return;
      }
      // Refused (401 once the session ends) or the server went away: EventSource won't retry that by itself.
      setStatus("closed");
      retry = setTimeout(() => setAttempt((n) => n + 1), RETRY_MS);
    };

    return () => {
      clearTimeout(retry);
      source.close();
    };
  }, [enabled, attempt]);

  const clear = useCallback(() => {
    setEvents((list) => {
      clearedThrough.current = Math.max(clearedThrough.current, ...list.map((event) => event.at));
      return [];
    });
  }, []);

  return { status, events, sockets, clear };
}
