"use client";

import { Bot, CirclePause, CirclePlay, Info, Pause } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { CopyButton } from "@/components/ui/CopyButton";
import { cn } from "@/lib/cn";
import { useDashboard } from "@/lib/dashboard-store";
import { formatUsd, truncateAddress } from "@/lib/format";
import { PROGRAM_ID } from "@/lib/network";
import { useNetwork } from "@/lib/settings";
import type { AgentWallet } from "@/lib/types";

// Meter fill carries severity; the track is the same hue, lighter, so state reads across the whole bar.
const METER_TONES = {
  normal: { fill: "bg-data", track: "bg-line" },
  high: { fill: "bg-warning", track: "bg-warning-bg" },
  full: { fill: "bg-danger", track: "bg-danger-bg" },
  paused: { fill: "bg-ink-3", track: "bg-line" },
} as const;

function meterTone(agent: AgentWallet): keyof typeof METER_TONES {
  if (agent.status === "paused") return "paused";
  const ratio = agent.dailyCapCents ? agent.spentTodayCents / agent.dailyCapCents : 0;
  if (ratio >= 1) return "full";
  if (ratio >= 0.8) return "high";
  return "normal";
}

export function AgentList({ onCommand, busy }: { onCommand: (command: string) => void; busy: boolean }) {
  const { agents } = useDashboard();
  const active = agents.filter((a) => a.status === "active").length;
  // Same set of agents on both sides: a paused agent's spend today still happened.
  const spent = agents.reduce((sum, a) => sum + a.spentTodayCents, 0);
  const cap = agents.reduce((sum, a) => sum + a.dailyCapCents, 0);

  return (
    <section aria-labelledby="agents-heading" className="card h-full">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <h2 id="agents-heading" className="text-[13px] font-medium text-ink">
            Agent wallets
          </h2>
          <p className="mt-0.5 text-xs text-ink-3">
            {agents.length} wallets · {active} active
          </p>
        </div>
        <p className="text-right text-xs text-ink-3">
          Spent today
          <span className="mt-0.5 block font-mono text-[13px] text-ink">
            {formatUsd(spent)} <span className="text-ink-3">/ {formatUsd(cap)}</span>
          </span>
        </p>
      </div>

      {agents.length > 0 ? (
        <ul className="divide-y divide-line">
          {agents.map((agent) => (
            <AgentRow key={agent.id} agent={agent} onCommand={onCommand} busy={busy} />
          ))}
        </ul>
      ) : (
        <NoLiveAgents />
      )}
    </section>
  );
}

/** Live mode with nothing on-chain: say why and what to do about it. */
function NoLiveAgents() {
  const { source } = useDashboard();
  const network = useNetwork();

  return (
    <div className="px-5 py-10 text-center sm:px-6">
      <span className="mx-auto grid size-10 place-items-center rounded-full border border-accent-line bg-accent-soft text-accent-ink">
        <Bot className="size-4" aria-hidden />
      </span>
      {source.agentsError ? (
        <p className="mt-3 text-sm text-ink-2">Couldn&rsquo;t load agent wallets: {source.agentsError}</p>
      ) : !source.programDeployed ? (
        <>
          <p className="mt-3 text-sm text-ink-2">The SolAgent Pay program isn&rsquo;t deployed on {network.label} yet.</p>
          <p className="mt-2 text-xs text-ink-3">
            Program <span className="font-mono">{truncateAddress(PROGRAM_ID, 6)}</span>. Deploy it from WSL, then agent wallets
            you create appear here:
          </p>
          <code className="mt-3 inline-block rounded-md border border-line bg-canvas px-2.5 py-1.5 font-mono text-xs text-ink">
            anchor deploy --provider.cluster devnet
          </code>
        </>
      ) : (
        <p className="mt-3 text-sm text-ink-2">
          No agent wallets for {truncateAddress(source.owner ?? "")} on {network.label} yet. Create one with the SDK&rsquo;s{" "}
          <span className="font-mono">createAgentWallet</span>.
        </p>
      )}
    </div>
  );
}

function AgentRow({ agent, onCommand, busy }: { agent: AgentWallet; onCommand: (command: string) => void; busy: boolean }) {
  const tone = METER_TONES[meterTone(agent)];
  const ratio = agent.dailyCapCents ? agent.spentTodayCents / agent.dailyCapCents : 0;
  const paused = agent.status === "paused";

  return (
    <li className="px-5 py-4 transition-colors hover:bg-row-hover">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            aria-hidden
            className={cn(
              "mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border",
              paused ? "border-line bg-canvas text-ink-3" : "border-accent-line bg-accent-soft text-accent-ink",
            )}
          >
            <Bot className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium text-ink">{agent.name}</p>
            <p className="truncate text-xs text-ink-3">{agent.purpose}</p>
          </div>
        </div>
        <Badge tone={paused ? "neutral" : "success"} icon={paused ? Pause : undefined}>
          {paused ? "Paused" : "Active"}
        </Badge>
      </div>

      <div className="mt-3 flex items-center gap-1 pl-11">
        <span className="text-xs text-ink-3">PDA</span>
        <span className="font-mono text-xs text-ink-2" title={agent.pda}>
          {truncateAddress(agent.pda, 6)}
        </span>
        <CopyButton text={agent.pda} label={`Copy ${agent.name} wallet address`} copiedLabel="Address copied" className="size-7" />
      </div>

      <div className="mt-2 pl-11">
        <div className="flex items-baseline justify-between gap-2 text-xs">
          <span className="font-mono tabular-nums text-ink">
            {formatUsd(agent.spentTodayCents)} <span className="text-ink-3">/ {formatUsd(agent.dailyCapCents)}</span>
          </span>
          <span className="font-mono tabular-nums text-ink-3">{Math.round(ratio * 100)}%</span>
        </div>
        <div
          role="meter"
          aria-label={`${agent.name} spending today`}
          aria-valuemin={0}
          aria-valuemax={agent.dailyCapCents / 100}
          aria-valuenow={Math.min(agent.spentTodayCents, agent.dailyCapCents) / 100}
          aria-valuetext={`${formatUsd(agent.spentTodayCents)} of ${formatUsd(agent.dailyCapCents)}${paused ? ", paused" : ""}`}
          className={cn("mt-1.5 h-1.5 overflow-hidden rounded-full", tone.track)}
        >
          <div
            className={cn("h-full rounded-full transition-[width] duration-500", tone.fill)}
            style={{ width: `${Math.min(100, ratio * 100)}%` }}
          />
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-ink-3">Up to {formatUsd(agent.maxPerTxCents)} per payment</p>
          <div className="flex gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => onCommand(`status of ${agent.name}`)}
              className="btn-ghost inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs disabled:opacity-50"
            >
              <Info className="size-3.5" aria-hidden />
              Details
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onCommand(`${paused ? "resume" : "pause"} ${agent.name}`)}
              className="btn-ghost inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs disabled:opacity-50"
            >
              {paused ? <CirclePlay className="size-3.5" aria-hidden /> : <CirclePause className="size-3.5" aria-hidden />}
              {paused ? "Resume" : "Pause"}
            </button>
          </div>
        </div>
      </div>
    </li>
  );
}
