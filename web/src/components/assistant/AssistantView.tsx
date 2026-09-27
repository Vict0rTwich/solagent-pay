"use client";

import { Reveal } from "@/components/dashboard/Reveal";
import { PageHeader } from "@/components/ui/PageHeader";
import { usePolicyTerminal } from "@/hooks/use-policy-terminal";
import { useDashboard } from "@/lib/dashboard-store";
import { truncateAddress } from "@/lib/format";
import { useNetwork } from "@/lib/settings";

import { AgentList } from "./AgentList";
import { PolicyTerminal } from "./PolicyTerminal";

export function AssistantView() {
  const terminal = usePolicyTerminal();
  const { source } = useDashboard();
  const network = useNetwork();

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-5">
      <Reveal index={0}>
        <PageHeader
          title="SolAgent AI assistant"
          description="See what your agents are spending and change their policies in plain language."
          note={
            source.mode === "live"
              ? `Live agent wallets owned by ${truncateAddress(source.owner ?? "")} on ${network.label} · the terminal reads them but doesn't sign changes`
              : "Simulated MCP session · changes stay in this dashboard; nothing is signed or sent"
          }
        />
      </Reveal>

      <div className="grid gap-5 xl:grid-cols-12">
        <Reveal index={1} className="min-w-0 xl:col-span-5">
          <AgentList onCommand={terminal.run} busy={terminal.running} />
        </Reveal>
        <Reveal index={2} className="min-w-0 xl:col-span-7">
          <PolicyTerminal entries={terminal.entries} running={terminal.running} history={terminal.history} onRun={terminal.run} />
        </Reveal>
      </div>
    </div>
  );
}
