"use client";

import { useEffect, useState } from "react";

import { apiCall } from "./invoice-api";

// Live SOL and USDC prices in US dollars (GET /api/price), for showing what an invoice is worth in the other
// asset. Indicative only: invoices are always paid in exactly the asset and amount they ask for.

export interface PriceQuote {
  /** US dollars per SOL. */
  solUsd: number;
  /** Pyth's confidence interval around solUsd, in US dollars. */
  solUsdConfidence: number;
  /** US dollars per USDC (a hair off 1.00 at times). */
  usdcUsd: number;
  /** When the older of the two prices was published on-chain, unix ms. */
  publishTime: number;
  fetchedAt: number;
  source: string;
}

const REFRESH_MS = 15_000;

/** The latest quote while `enabled`, refreshed every 15 s. `error` when the price couldn't be read. */
export function usePriceQuote(enabled: boolean): { quote: PriceQuote | null; error: boolean } {
  const [quote, setQuote] = useState<PriceQuote | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const load = () => {
      if (document.visibilityState === "hidden") return;
      apiCall<PriceQuote>("/api/price").then(
        (next) => {
          if (cancelled) return;
          setQuote(next);
          setError(false);
        },
        () => !cancelled && setError(true),
      );
    };
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [enabled]);

  return { quote, error };
}
