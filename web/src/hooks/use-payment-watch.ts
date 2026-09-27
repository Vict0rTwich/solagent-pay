"use client";

import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useEffect, useRef } from "react";

import { checkPayment, findPayment, toLookup, type PaymentCheckCache, type PaymentLookup, type PaymentTarget } from "@/lib/invoice-payments";
import { withTimeout } from "@/lib/live-data";

/** Fallback poll, for when the logs subscription drops or the RPC has no websocket. */
const POLL_MS = 5_000;

/**
 * Watches a payment target's reference key while `target` is set, at "confirmed" commitment, and reports
 * what it finds. A logs subscription (websocket) reports a payment about a second after it lands; polling
 * covers RPCs without websockets. Clearing `target` or unmounting removes the subscription and stops polling;
 * answers still in flight are dropped.
 */
export function usePaymentWatch(target: PaymentTarget | null, onLookup: (lookup: PaymentLookup) => void): void {
  const { connection } = useConnection();
  const checks = useRef<PaymentCheckCache>(new Map());
  // The subscription outlives renders; these hold the latest values for it.
  const targetRef = useRef(target);
  const onLookupRef = useRef(onLookup);
  useEffect(() => {
    targetRef.current = target;
    onLookupRef.current = onLookup;
  });

  const reference = target?.reference ?? null;
  useEffect(() => {
    if (!reference) return;
    let stopped = false;
    let polling = false;
    const report = (lookup: PaymentLookup) => {
      if (!stopped) onLookupRef.current(lookup);
    };

    const poll = async () => {
      const current = targetRef.current;
      if (polling || !current) return;
      polling = true;
      try {
        report(await withTimeout(findPayment(connection, current, checks.current)));
      } catch {
        // Rate limit or network blip: the next poll or the subscription picks it up.
      } finally {
        polling = false;
      }
    };

    let subscription: number | null = null;
    try {
      subscription = connection.onLogs(
        new PublicKey(reference),
        ({ signature }) => {
          const current = targetRef.current;
          if (!current) return;
          void checkPayment(connection, signature, current, checks.current)
            .then((check) => {
              if (check) report(toLookup(signature, check));
            })
            .catch(() => {
              // The next poll retries it.
            });
        },
        "confirmed",
      );
    } catch {
      // No websocket endpoint for this RPC: polling covers it.
    }

    void poll();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void poll();
    }, POLL_MS);

    return () => {
      stopped = true;
      clearInterval(timer);
      if (subscription !== null) void connection.removeOnLogsListener(subscription).catch(() => {});
    };
  }, [connection, reference]);
}
