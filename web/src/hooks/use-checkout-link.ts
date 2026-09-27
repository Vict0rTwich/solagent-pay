"use client";

import { useCallback, useSyncExternalStore } from "react";

import { useNetwork } from "@/lib/settings";
import { buildCheckoutUrl } from "@/lib/solana-pay";

const subscribeNever = () => () => {};

/** This site's origin; empty during the server render, so it never causes a hydration mismatch. */
export function useOrigin(): string {
  return useSyncExternalStore(
    subscribeNever,
    () => window.location.origin,
    () => "",
  );
}

/** Turns an invoice's `solana:` link into the https checkout link to share with the payer. */
export function useCheckoutLink(): (paymentUrl: string) => string {
  const origin = useOrigin();
  const network = useNetwork();
  return useCallback((paymentUrl: string) => buildCheckoutUrl(origin, paymentUrl, network.id), [origin, network.id]);
}
