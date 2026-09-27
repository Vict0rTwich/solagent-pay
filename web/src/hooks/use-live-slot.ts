"use client";

import { useConnection } from "@solana/wallet-adapter-react";
import { useEffect, useState } from "react";

export type NetworkHealth = "connecting" | "live" | "slow" | "offline";

export interface LiveSlot {
  slot: number | null;
  latencyMs: number | null;
  health: NetworkHealth;
}

const POLL_MS = 2_000;
const SLOW_MS = 1_200;

/** Polls the RPC for the current slot and round-trip time. Pauses while the tab is hidden. */
export function useLiveSlot(): LiveSlot {
  const { connection } = useConnection();
  const [state, setState] = useState<LiveSlot>({ slot: null, latencyMs: null, health: "connecting" });

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    // A new connection means a new network: never show the previous network's slot.
    setState({ slot: null, latencyMs: null, health: "connecting" });

    const poll = async () => {
      if (inFlight || cancelled) return;
      inFlight = true;
      if (document.visibilityState === "visible") {
        const started = performance.now();
        try {
          const slot = await connection.getSlot("confirmed");
          if (!cancelled) {
            failures = 0;
            const latencyMs = Math.round(performance.now() - started);
            setState({ slot, latencyMs, health: latencyMs > SLOW_MS ? "slow" : "live" });
          }
        } catch {
          if (!cancelled) {
            failures += 1;
            // One failed poll is a retry; two in a row means the endpoint is down.
            setState((prev) => ({ ...prev, latencyMs: null, health: failures >= 2 ? "offline" : "connecting" }));
          }
        }
      }
      inFlight = false;
      if (!cancelled) timer = setTimeout(poll, failures > 0 ? POLL_MS * 3 : POLL_MS);
    };

    // Coming back to the tab refreshes right away instead of waiting for the next tick.
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible" || inFlight) return;
      clearTimeout(timer);
      void poll();
    };

    void poll();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [connection]);

  return state;
}
