import type { Metadata } from "next";

import { CheckoutView } from "@/components/payments/CheckoutView";

export const metadata: Metadata = {
  title: "Checkout",
  // Each link is one invoice; there's nothing here for search engines.
  robots: { index: false, follow: false },
};

/** Hosted checkout: /pay?recipient=…&amount=…&spl-token=…&reference=…&label=…&message=…&memo=…&cluster=devnet */
export default async function PayPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, item);
  }
  return <CheckoutView query={query.toString()} />;
}
