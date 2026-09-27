"use client";

import { useCallback, useEffect, useState } from "react";

import { invoiceApi, type PublicInvoice } from "@/lib/invoice-api";

/** Our own server, not the RPC: cheap to ask often, so the page flips to paid within seconds. */
const POLL_MS = 3_000;

export interface ServerInvoice {
  /** Null until the first answer. False when the server doesn't know this reference, or couldn't be reached. */
  known: boolean | null;
  invoice: PublicInvoice | null;
  /** Asks again now. */
  refresh: () => void;
}

/**
 * The payment server's record of one invoice, polled while it's open. For a link this server made, that record
 * is the truth (paid, expired, canceled); for any other link `known` is false and the caller watches the chain.
 */
export function useServerInvoice(reference: string | null): ServerInvoice {
  const [state, setState] = useState<{ reference: string | null; known: boolean | null; invoice: PublicInvoice | null }>({
    reference: null,
    known: null,
    invoice: null,
  });
  const [requests, setRequests] = useState(0);
  const refresh = useCallback(() => setRequests((n) => n + 1), []);

  const current = state.reference === reference ? state : { reference, known: null, invoice: null };
  // Nothing more to learn once it's settled (and its receipt minted), or once it's clear the server doesn't have it.
  const done =
    current.known === false ||
    (current.invoice !== null && current.invoice.status !== "pending" && current.invoice.receipt?.status !== "pending");

  useEffect(() => {
    if (!reference || done) return;
    let cancelled = false;
    const load = async () => {
      try {
        const invoice = await invoiceApi.get(reference);
        if (!cancelled) setState({ reference, known: invoice !== null, invoice });
      } catch {
        // Unreachable before anything loaded: treat the link as unknown. Afterwards, keep the last answer.
        if (!cancelled) setState((s) => (s.reference === reference && s.known !== null ? s : { reference, known: false, invoice: null }));
      }
    };
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [reference, done, requests]);

  return { known: current.known, invoice: current.invoice, refresh };
}
