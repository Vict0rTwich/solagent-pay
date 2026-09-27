"use client";

import { CornerDownLeft, SquareTerminal } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { Badge } from "@/components/ui/Badge";
import type { TerminalEntry } from "@/hooks/use-policy-terminal";
import { cn } from "@/lib/cn";
import { useDashboard } from "@/lib/dashboard-store";
import { formatUsd } from "@/lib/format";
import type { TerminalLine, ToolArgs } from "@/lib/policy-commands";
import type { AgentWallet } from "@/lib/types";

function formatArgs(args: ToolArgs): string {
  const body = Object.entries(args)
    .map(([key, value]) => `  ${key}: ${typeof value === "string" ? `"${value}"` : String(value)}`)
    .join(",\n");
  return `{\n${body}\n}`;
}

/** Suggested commands that make sense for the agents as they are right now. */
function useSuggestions(): string[] {
  const { agents } = useDashboard();
  return useMemo(() => {
    const active = agents.filter((a) => a.status === "active");
    const nearCap = active.find((a) => a.dailyCapCents && a.spentTodayCents / a.dailyCapCents >= 0.8);
    const paused = agents.find((a) => a.status === "paused");
    const suggestions = ["status"];
    if (nearCap) suggestions.push(`set ${nearCap.name} daily cap to $${Math.ceil((nearCap.dailyCapCents * 1.2) / 10_000) * 100}`);
    if (active[0]) suggestions.push(`pause ${active[0].name}`);
    if (paused) suggestions.push(`resume ${paused.name}`);
    if (!agents.some((a) => a.name === "Invoice Chaser")) {
      suggestions.push('provision agent "Invoice Chaser" with a $40 daily cap and $10 per payment');
    }
    return suggestions;
  }, [agents]);
}

export function PolicyTerminal({
  entries,
  running,
  history,
  onRun,
}: {
  entries: readonly TerminalEntry[];
  running: boolean;
  history: readonly string[];
  onRun: (command: string) => void;
}) {
  const [input, setInput] = useState("");
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestions = useSuggestions();

  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [entries, running]);

  const submit = (command: string) => {
    if (!command.trim() || running) return;
    onRun(command);
    setInput("");
    setHistoryIndex(null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    if (history.length === 0) return;
    event.preventDefault();
    const last = history.length - 1;
    const next =
      event.key === "ArrowUp"
        ? Math.max(0, (historyIndex ?? last + 1) - 1)
        : historyIndex === null || historyIndex >= last
          ? null
          : historyIndex + 1;
    setHistoryIndex(next);
    setInput(next === null ? "" : (history[next] ?? ""));
  };

  return (
    <section aria-labelledby="terminal-heading" className="card flex h-full flex-col overflow-hidden">
      <div className="flex h-12 items-center justify-between gap-3 border-b border-console-line bg-console px-4 sm:px-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <SquareTerminal className="size-4 shrink-0 text-blue-400" aria-hidden />
          <h2 id="terminal-heading" className="text-[13px] font-medium text-console-ink">
            Policy terminal
          </h2>
          <span className="hidden truncate font-mono text-[11px] text-console-ink-3 sm:inline">solagent-pay · mcp</span>
        </div>
        <Badge tone="neutral">Simulated</Badge>
      </div>

      <div
        ref={logRef}
        role="log"
        aria-live="polite"
        aria-label="Terminal output"
        tabIndex={0}
        className="h-[440px] flex-1 space-y-3 overflow-y-auto bg-console px-4 py-4 font-mono text-[12.5px] leading-relaxed text-console-ink outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-console-ink-3 sm:px-5 xl:h-auto xl:min-h-[440px]"
      >
        {entries.map((entry) => (
          <Line key={entry.id} line={entry.line} />
        ))}
        {running && (
          <p className="text-console-ink-3">
            calling tool<span className="animate-pulse">…</span>
          </p>
        )}
      </div>

      <div className="space-y-2.5 border-t border-line p-3 sm:p-4">
        <div className="flex flex-wrap gap-1.5" aria-label="Suggested commands">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              disabled={running}
              onClick={() => submit(suggestion)}
              className="h-6 max-w-full truncate rounded-md border border-line px-2 font-mono text-[11px] text-ink-2 transition-colors hover:border-accent-line hover:bg-accent-soft hover:text-accent-ink disabled:opacity-50"
            >
              {suggestion}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(input);
          }}
          className="flex items-center gap-2 rounded-lg border border-line bg-canvas px-3 transition-colors hover:border-line-strong focus-within:border-accent"
        >
          <span className="font-mono text-accent-ink" aria-hidden>
            ›
          </span>
          <label htmlFor="policy-command" className="sr-only">
            Command
          </label>
          <input
            ref={inputRef}
            id="policy-command"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setHistoryIndex(null);
            }}
            onKeyDown={onKeyDown}
            autoComplete="off"
            spellCheck={false}
            placeholder="pause market data agent"
            className="h-10 min-w-0 flex-1 bg-transparent font-mono text-[13px] text-ink outline-none placeholder:text-ink-3"
          />
          <button
            type="submit"
            disabled={running || !input.trim()}
            aria-label="Run command"
            className="grid size-8 place-items-center rounded-md text-ink-3 transition-colors hover:bg-raised hover:text-ink disabled:opacity-40"
          >
            <CornerDownLeft className="size-4" />
          </button>
        </form>
      </div>
    </section>
  );
}

function Line({ line }: { line: TerminalLine }) {
  switch (line.kind) {
    case "command":
      return (
        <p className="text-console-ink">
          <span className="text-console-ink-3" aria-hidden>
            ›{" "}
          </span>
          {line.text}
        </p>
      );
    case "call":
      return (
        <div className="rounded-md border border-console-line bg-console-raised px-3 py-2">
          <p className="text-[#8fb4d8]">
            <span aria-hidden>→ </span>solagent-pay.{line.tool}
          </p>
          <pre className="mt-1 whitespace-pre-wrap break-all text-[11.5px] text-console-ink-2">{formatArgs(line.args)}</pre>
        </div>
      );
    case "reply":
      return (
        <p className="flex gap-2 whitespace-pre-wrap break-words">
          <span
            aria-hidden
            className={cn(
              "shrink-0",
              line.tone === "success" ? "text-emerald-400" : line.tone === "error" ? "text-red-400" : "text-console-ink-3",
            )}
          >
            {line.tone === "success" ? "✓" : line.tone === "error" ? "✕" : "·"}
          </span>
          <span className={cn("min-w-0", line.tone === "info" ? "text-console-ink-2" : "text-console-ink")}>
            {line.tone === "error" && <span className="sr-only">Error: </span>}
            {line.text}
          </span>
        </p>
      );
    case "agents":
      return <AgentTable agents={line.agents} />;
  }
}

function AgentTable({ agents }: { agents: readonly AgentWallet[] }) {
  return (
    <div className="relative overflow-x-auto rounded-md border border-console-line">
      <table className="w-full text-[11.5px]">
        <thead>
          <tr className="text-left text-console-ink-3">
            <th scope="col" className="px-3 py-1.5 font-medium">
              Agent
            </th>
            <th scope="col" className="px-3 py-1.5 font-medium">
              State
            </th>
            <th scope="col" className="px-3 py-1.5 text-right font-medium">
              Spent / cap
            </th>
            <th scope="col" className="px-3 py-1.5 text-right font-medium">
              Used
            </th>
          </tr>
        </thead>
        <tbody>
          {agents.map((agent) => {
            const used = agent.dailyCapCents ? Math.round((agent.spentTodayCents / agent.dailyCapCents) * 100) : 0;
            return (
              <tr key={agent.id} className="border-t border-console-line">
                <td className="whitespace-nowrap px-3 py-1.5 text-console-ink">{agent.name}</td>
                <td className={cn("px-3 py-1.5", agent.status === "active" ? "text-emerald-400" : "text-amber-300")}>
                  {agent.status === "active" ? "ACTIVE" : "PAUSED"}
                </td>
                <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-console-ink-2">
                  {formatUsd(agent.spentTodayCents)} / {formatUsd(agent.dailyCapCents)}
                </td>
                <td
                  className={cn(
                    "px-3 py-1.5 text-right tabular-nums",
                    used >= 100 ? "text-red-400" : used >= 80 ? "text-amber-300" : "text-console-ink-2",
                  )}
                >
                  {used}%
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
