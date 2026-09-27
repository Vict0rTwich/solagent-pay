"use client";

import { useMemo } from "react";

import { useCelebratePayments } from "@/hooks/use-celebrate";
import { useDashboard } from "@/lib/dashboard-store";

/** A Blink sale paid this recently is news when the dashboard first hears of it. */
const FRESH_MS = 60_000;

/** Confetti and a chime when one of the dashboard's invoices turns paid, whichever page is open. Renders nothing. */
export function PaymentCelebrations() {
  const { invoices, source } = useDashboard();
  const live = source.mode === "live";
  const items = useMemo(() => {
    const now = Date.now();
    return invoices.map((invoice) => ({
      key: invoice.reference,
      paid: invoice.paidAt !== undefined,
      fresh: live && invoice.productId !== undefined && invoice.paidAt !== undefined && now - invoice.paidAt < FRESH_MS,
    }));
  }, [invoices, live]);
  useCelebratePayments(items);
  return null;
}
