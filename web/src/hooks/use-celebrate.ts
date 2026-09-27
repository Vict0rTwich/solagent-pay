"use client";

import { useCallback, useEffect, useRef } from "react";

import { celebrate, primeAudio } from "@/lib/celebrate";
import { useSettings } from "@/lib/settings";

export interface PaidState {
  /** The invoice's reference key. */
  key: string;
  paid: boolean;
  /**
   * Paid moments ago: news even when first seen already paid. A Blink sale is created by the buyer's wallet, so
   * the dashboard may first hear of it once it's paid.
   */
  fresh?: boolean;
}

/** Celebrates a payment now (e.g. the pay dialog's own success), with the chime unless it's muted in Settings. */
export function useCelebrate(): (key: string) => void {
  const [{ sounds }] = useSettings();
  useEffect(() => primeAudio(), []);
  return useCallback((key: string) => celebrate(key, { sound: sounds }), [sounds]);
}

/**
 * Celebrates each item seen unpaid and later paid. One first seen already paid isn't news (a reload, an old
 * invoice), and callers leave an item out until they know its state, so a slow first load doesn't count as a flip.
 */
export function useCelebratePayments(items: readonly PaidState[]): void {
  const celebrateNow = useCelebrate();
  const seen = useRef(new Map<string, boolean>());

  useEffect(() => {
    for (const { key, paid, fresh } of items) {
      const before = seen.current.get(key);
      seen.current.set(key, paid);
      if (paid && (before === false || (before === undefined && fresh))) celebrateNow(key);
    }
  }, [items, celebrateNow]);
}
