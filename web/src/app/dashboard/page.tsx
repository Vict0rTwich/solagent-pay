import { BalanceCard } from "@/components/dashboard/BalanceCard";
import { InvoiceTable } from "@/components/dashboard/InvoiceTable";
import { OverviewHeading } from "@/components/dashboard/OverviewHeading";
import { QuickInvoiceWidget } from "@/components/dashboard/QuickInvoiceWidget";
import { Reveal } from "@/components/dashboard/Reveal";
import { StatsBar } from "@/components/dashboard/StatsBar";

/**
 * Metric bar, then the payments table as the page's hero. Balance and the quick payment link sit in a narrow rail
 * beside it on wide screens (withdrawals start from the balance card), and side by side below it otherwise.
 */
export default function DashboardPage() {
  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-5">
      <Reveal index={0}>
        <OverviewHeading />
      </Reveal>

      <Reveal index={1}>
        <StatsBar />
      </Reveal>

      {/* From 1400px the rail sits beside the table at a fixed width, so every pixel the chart used to take goes to the
          table, which stays pinned below the header while the rail scrolls past. Narrower, the table runs full width
          and the rail's two cards sit side by side beneath it. */}
      <div className="grid gap-5 wide:grid-cols-[minmax(0,1fr)_300px] wide:items-start 2xl:grid-cols-[minmax(0,1fr)_340px]">
        <Reveal index={2} className="min-w-0 wide:sticky wide:top-[4.75rem]">
          <InvoiceTable />
        </Reveal>
        <Reveal index={3} className="grid gap-5 sm:grid-cols-2 wide:grid-cols-1">
          <BalanceCard />
          <QuickInvoiceWidget />
        </Reveal>
      </div>
    </div>
  );
}
