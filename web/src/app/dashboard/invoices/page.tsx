import type { Metadata } from "next";

import { InvoicesView } from "@/components/invoices/InvoicesView";

export const metadata: Metadata = {
  title: "Products & invoices",
};

export default function InvoicesPage() {
  return <InvoicesView />;
}
