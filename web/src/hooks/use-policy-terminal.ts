"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";

import { useDashboard } from "@/lib/dashboard-store";
import { DEMO_MERCHANT } from "@/lib/demo-data";
import { parseCommand, runPlan, type Plan, type TerminalLine } from "@/lib/policy-commands";

export interface TerminalEntry {
  id: number;
  line: TerminalLine;
}

// Pause before the reply so the tool call reads as a round trip rather than an instant echo.
const TOOL_LATENCY_MS = 450;

/** State for the policy terminal: submitted commands, simulated tool calls and their results. */
const WRITE_PLANS: ReadonlySet<Plan["kind"]> = new Set(["set-paused", "set-limit", "provision"]);

const LIVE_READ_ONLY =
  "Live agent wallets only change through a transaction signed by your wallet, which this terminal doesn't send. " +
  "Use the SDK's updatePolicy or createAgentWallet, or switch to demo data (header badge) to try the simulated flow.";

export function usePolicyTerminal() {
  const { agents, updateAgent, provisionAgent, source } = useDashboard();
  const { publicKey } = useWallet();
  const reduceMotion = useReducedMotion();
  const nextId = useRef(0);
  const [entries, setEntries] = useState<TerminalEntry[]>(() => [
    {
      id: nextId.current++,
      line: {
        kind: "reply",
        tone: "info",
        text: `Connected to the SolAgent Pay MCP server (simulated). I manage the spending policies of your ${agents.length} agent wallets.\nType help for examples, or pick a suggestion below.`,
      },
    },
  ]);
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<string[]>([]);

  // Commands run after a delay, so read the latest agents and owner through refs.
  const agentsRef = useRef(agents);
  const ownerRef = useRef(publicKey?.toBase58() ?? DEMO_MERCHANT);
  const liveRef = useRef(source.mode === "live");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    agentsRef.current = agents;
    ownerRef.current = publicKey?.toBase58() ?? DEMO_MERCHANT;
    liveRef.current = source.mode === "live";
  });

  useEffect(() => () => clearTimeout(timer.current), []);

  const append = useCallback((lines: TerminalLine[]) => {
    setEntries((current) => [...current, ...lines.map((line) => ({ id: nextId.current++, line }))]);
  }, []);

  const run = useCallback(
    (input: string) => {
      const text = input.trim();
      if (!text || running) return;
      setHistory((current) => [...current.filter((h) => h !== text), text]);

      const plan = parseCommand(text, agentsRef.current);
      if (plan.kind === "clear") {
        setEntries([]);
        return;
      }

      append([{ kind: "command", text }]);
      setRunning(true);
      timer.current = setTimeout(
        () => {
          append(
            liveRef.current && WRITE_PLANS.has(plan.kind)
              ? [{ kind: "reply", tone: "error", text: LIVE_READ_ONLY }]
              : runPlan(plan, agentsRef.current, {
                  updateAgent,
                  provisionAgent: (agent) => provisionAgent({ ...agent, owner: ownerRef.current }),
                }),
          );
          setRunning(false);
        },
        reduceMotion ? 0 : TOOL_LATENCY_MS,
      );
    },
    [append, provisionAgent, reduceMotion, running, updateAgent],
  );

  return { entries, running, history, run };
}
