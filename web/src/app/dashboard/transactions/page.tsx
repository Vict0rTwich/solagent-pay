import type { Metadata } from "next";

import { TransactionsView } from "@/components/transactions/TransactionsView";

export const metadata: Metadata = {
  title: "Transactions",
};

export default function TransactionsPage() {
  return <TransactionsView />;
}
