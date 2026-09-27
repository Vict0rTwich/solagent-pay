import type { Metadata } from "next";
import { connection } from "next/server";
import type { ReactNode } from "react";

import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { MerchantSessionProvider } from "@/hooks/use-merchant-session";
import { DashboardProvider } from "@/lib/dashboard-store";

export const metadata: Metadata = {
  // A plain string here would drop the root template for every page below this layout.
  title: { default: "Dashboard", template: "%s · SolAgent Pay" },
};

// Merchant sign-in lives here, not in the root providers: the public /pay checkout never asks for it.
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  // Sample data is dated relative to now. Rendered per request (not once at build time), reading the clock here
  // and handing it down, so the server and the browser generate identical data from the same moment.
  await connection();
  const demoNow = Date.now();

  return (
    <MerchantSessionProvider>
      <DashboardProvider demoNow={demoNow}>
        <DashboardShell>{children}</DashboardShell>
      </DashboardProvider>
    </MerchantSessionProvider>
  );
}
