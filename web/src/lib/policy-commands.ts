import { policyError, toBaseUnits } from "./agents";
import type { AgentPatch, NewAgent } from "./dashboard-store";
import { formatUsd, truncateAddress } from "./format";
import type { AgentWallet } from "./types";

// Natural-language policy commands, mapped onto the program's instructions the way an MCP
// tool call would be. Parsing is deliberately simple pattern matching.

export type ToolArgs = Record<string, string | number | boolean>;

export type TerminalLine =
  | { kind: "command"; text: string }
  | { kind: "call"; tool: string; args: ToolArgs }
  | { kind: "reply"; tone: "success" | "error" | "info"; text: string }
  | { kind: "agents"; agents: AgentWallet[] };

export type Plan =
  | { kind: "help" }
  | { kind: "clear" }
  | { kind: "status"; agentId?: string }
  | { kind: "set-paused"; agentIds: string[]; paused: boolean }
  | { kind: "set-limit"; agentId: string; field: "dailyCapCents" | "maxPerTxCents"; cents: number }
  | { kind: "provision"; name: string; dailyCapCents: number; maxPerTxCents: number }
  | { kind: "unknown"; message: string };

export interface PolicyActions {
  updateAgent: (id: string, patch: AgentPatch) => void;
  provisionAgent: (input: Omit<NewAgent, "owner">) => AgentWallet;
}

const DEFAULT_DAILY_CAP_CENTS = 10_000;
const MONEY = /\$\s*(\d[\d,]*(?:\.\d{1,2})?)\s*(k\b)?|(\d[\d,]*(?:\.\d{1,2})?)\s*(k\b)?\s*(?:usdc|usd|dollars?)\b/gi;
const PER_TX = /^\s*(?:\/|per|a|each)\s*(?:tx|txn|transaction|payment|call)|^\s*(?:max|limit)?\s*per[- ]?(?:tx|transaction|payment)/i;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toCents(digits: string, thousands: boolean): number {
  const value = Number(digits.replace(/,/g, ""));
  return Math.round(value * (thousands ? 1000 : 1) * 100);
}

/** Every dollar amount in the text, tagged as per-payment when words like "per tx" follow it. */
function amounts(text: string): Array<{ cents: number; perTx: boolean }> {
  const found: Array<{ cents: number; perTx: boolean }> = [];
  for (const match of text.matchAll(MONEY)) {
    const digits = match[1] ?? match[3];
    if (!digits) continue;
    const after = text.slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + match[0].length + 24);
    const before = text.slice(Math.max(0, (match.index ?? 0) - 24), match.index ?? 0);
    found.push({
      cents: toCents(digits, Boolean(match[2] ?? match[4])),
      perTx: PER_TX.test(after) || /per[- ]?(?:tx|transaction|payment)\s*(?:limit|cap|max)?\s*(?:of|to|at|=)?\s*$/i.test(before),
    });
  }
  return found;
}

/** The agent a command refers to: full name first, then its distinctive first word ("sourcing"). */
export function findAgent(text: string, agents: readonly AgentWallet[]): AgentWallet | undefined {
  const lower = text.toLowerCase();
  const byName = agents
    .filter((a) => lower.includes(a.name.toLowerCase()))
    .sort((a, b) => b.name.length - a.name.length)[0];
  if (byName) return byName;
  return agents.find((a) => {
    const first = a.name.toLowerCase().split(/\s+/)[0];
    return first && first !== "agent" && new RegExp(`\\b${escapeRegExp(first)}\\b`).test(lower);
  });
}

function extractName(original: string): string | null {
  const quoted = /["“'‘](.+?)["”'’]/.exec(original);
  const named =
    quoted?.[1] ??
    /\b(?:called|named)\s+([A-Za-z0-9][\w &-]*?)(?=\s+(?:with|at|capped|and|for|,)|[.,]|$)/i.exec(original)?.[1] ??
    /\bagent\s+(?!with\b|at\b|called\b|named\b)([A-Za-z0-9][\w &-]*?)(?=\s+(?:with|at|capped|and|for|,)|[.,]|$)/i.exec(original)?.[1];
  const name = named?.trim();
  if (!name) return null;
  return name.replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 32);
}

export function parseCommand(input: string, agents: readonly AgentWallet[]): Plan {
  const text = input.trim();
  const lower = text.toLowerCase();

  if (/^(help|\?|commands|what can you do\??)$/.test(lower)) return { kind: "help" };
  if (/^(clear|cls)$/.test(lower)) return { kind: "clear" };

  const provisionVerb =
    /^(?:please\s+|can you\s+)?(?:provision|create|add|spin up|deploy|set up|setup|onboard)\s+(?:an?\s+)?(?:new\s+)?(?:ai\s+)?agent\b/.test(lower);
  if (provisionVerb || /\bnew agent\b/.test(lower)) {
    const name = extractName(text);
    if (!name) {
      return { kind: "unknown", message: 'Give the new agent a name, e.g. provision agent "Invoice Chaser" with a $40 daily cap.' };
    }
    const money = amounts(text);
    const daily = money.find((m) => !m.perTx)?.cents ?? DEFAULT_DAILY_CAP_CENTS;
    const perTx = money.find((m) => m.perTx)?.cents ?? Math.max(100, Math.round(daily / 4));
    return { kind: "provision", name, dailyCapCents: daily, maxPerTxCents: perTx };
  }

  const everyone = /\b(all|every|everything|everyone)\b/.test(lower);
  const agent = findAgent(text, agents);

  const money = amounts(text);
  if (money.length > 0 && /\b(set|change|raise|lower|update|increase|decrease|reduce|bump|cut|make|add|cap|limit|budget)\b/.test(lower)) {
    if (!agent) return { kind: "unknown", message: `Which agent? Try "set ${agents[0]?.name ?? "Sourcing Agent"} daily cap to $300".` };
    const perTx = money[0]?.perTx || /per[- ]?(tx|transaction|payment)|each payment|single payment/.test(lower);
    const field = perTx ? "maxPerTxCents" : "dailyCapCents";
    const amount = money[0]?.cents ?? 0;
    // "add $50 to …" and "raise … by $50" change the limit; "set … to $50" replaces it.
    const relative = /\b(add|plus)\b/.test(lower) || /\bby\s*\$?\s*\d/.test(lower);
    const decrease = /\b(lower|cut|decrease|reduce|drop|minus|subtract)\b/.test(lower);
    const cents = relative ? agent[field] + (decrease ? -amount : amount) : amount;
    return { kind: "set-limit", agentId: agent.id, field, cents };
  }

  const pause = /\b(pause|freeze|stop|halt|suspend|disable|block)\b/.test(lower);
  const resume = /\b(resume|unpause|un-pause|activate|reactivate|enable|restart|unfreeze|unblock)\b/.test(lower);
  if (pause || resume) {
    const paused = pause && !resume;
    if (everyone) return { kind: "set-paused", agentIds: agents.map((a) => a.id), paused };
    if (!agent) return { kind: "unknown", message: `Which agent? Try "${paused ? "pause" : "resume"} ${agents[0]?.name ?? "Sourcing Agent"}" or "${paused ? "pause" : "resume"} all agents".` };
    return { kind: "set-paused", agentIds: [agent.id], paused };
  }

  if (/\b(status|show|list|check|how|report|overview|agents?|spend|spent|budget)\b/.test(lower)) {
    return { kind: "status", agentId: everyone ? undefined : agent?.id };
  }

  return { kind: "unknown", message: 'I didn\'t catch that. Try "pause Market Data Agent", or type help to see what I can do.' };
}

function policyArgs(agent: AgentWallet, patch: AgentPatch = {}): ToolArgs {
  const next = { ...agent, ...patch };
  return {
    agent_wallet: truncateAddress(agent.pda),
    max_per_tx: toBaseUnits(next.maxPerTxCents),
    daily_limit: toBaseUnits(next.dailyCapCents),
    paused: next.status === "paused",
  };
}

function percent(agent: AgentWallet): number {
  return agent.dailyCapCents ? Math.round((agent.spentTodayCents / agent.dailyCapCents) * 100) : 0;
}

const HELP = [
  "Things you can ask:",
  "  status                         spending for every agent",
  "  status of Sourcing Agent       one agent's policy and spend",
  "  pause Market Data Agent        block its payments (update_policy paused=true)",
  "  resume all agents              let paused agents pay again",
  "  set Sourcing Agent daily cap to $300",
  "  set Inbox Triage per-tx limit to $15",
  '  provision agent "Invoice Chaser" with a $40 daily cap and $10 per payment',
  "  clear                          clear this terminal",
].join("\n");

/** Applies a plan through `actions` and returns what the terminal should print. */
export function runPlan(plan: Plan, agents: readonly AgentWallet[], actions: PolicyActions): TerminalLine[] {
  switch (plan.kind) {
    case "help":
      return [{ kind: "reply", tone: "info", text: HELP }];

    case "clear":
      return [];

    case "unknown":
      return [{ kind: "reply", tone: "error", text: plan.message }];

    case "status": {
      const agent = agents.find((a) => a.id === plan.agentId);
      if (!agent) {
        const active = agents.filter((a) => a.status === "active").length;
        return [
          { kind: "call", tool: "list_agent_wallets", args: { owner: truncateAddress(agents[0]?.owner ?? "") } },
          { kind: "agents", agents: [...agents] },
          { kind: "reply", tone: "info", text: `${active} of ${agents.length} agents active.` },
        ];
      }
      return [
        { kind: "call", tool: "get_wallet_status", args: { agent_wallet: truncateAddress(agent.pda) } },
        {
          kind: "reply",
          tone: "info",
          text: [
            `${agent.name} · ${agent.status === "active" ? "ACTIVE" : "PAUSED"}`,
            `Spent today   ${formatUsd(agent.spentTodayCents)} of ${formatUsd(agent.dailyCapCents)} (${percent(agent)}%)`,
            `Per payment   up to ${formatUsd(agent.maxPerTxCents)}`,
            `Wallet PDA    ${agent.pda}`,
          ].join("\n"),
        },
      ];
    }

    case "set-paused": {
      const targets = agents.filter((a) => plan.agentIds.includes(a.id));
      const changing = targets.filter((a) => (a.status === "paused") !== plan.paused);
      if (changing.length === 0) {
        const what = targets.length === 1 ? `${targets[0]?.name} is` : "Every agent is";
        return [{ kind: "reply", tone: "info", text: `${what} already ${plan.paused ? "paused" : "active"}.` }];
      }
      const lines: TerminalLine[] = [];
      for (const agent of changing) {
        const patch: AgentPatch = { status: plan.paused ? "paused" : "active" };
        lines.push({ kind: "call", tool: "update_policy", args: policyArgs(agent, patch) });
        actions.updateAgent(agent.id, patch);
      }
      const names = changing.map((a) => a.name).join(", ");
      lines.push({
        kind: "reply",
        tone: "success",
        text: plan.paused
          ? `Paused ${names}. Payments from ${changing.length === 1 ? "it" : "them"} now fail with WalletPaused until resumed.`
          : `Resumed ${names}. ${changing.length === 1 ? "It" : "They"} can pay again within the daily cap.`,
      });
      return lines;
    }

    case "set-limit": {
      const agent = agents.find((a) => a.id === plan.agentId);
      if (!agent) return [{ kind: "reply", tone: "error", text: "That agent no longer exists." }];
      const patch: AgentPatch = { [plan.field]: plan.cents };
      const next = { ...agent, ...patch };
      const call: TerminalLine = { kind: "call", tool: "update_policy", args: policyArgs(agent, patch) };
      const error = policyError(next.maxPerTxCents, next.dailyCapCents);
      if (error) return [call, { kind: "reply", tone: "error", text: `Rejected by the program. ${error}` }];
      actions.updateAgent(agent.id, patch);
      const label = plan.field === "dailyCapCents" ? "daily cap" : "per-payment limit";
      const before = plan.field === "dailyCapCents" ? agent.dailyCapCents : agent.maxPerTxCents;
      return [
        call,
        {
          kind: "reply",
          tone: "success",
          text: `${agent.name} ${label} is now ${formatUsd(plan.cents)} (was ${formatUsd(before)}). Spent today: ${formatUsd(agent.spentTodayCents)}.`,
        },
      ];
    }

    case "provision": {
      if (agents.some((a) => a.name.toLowerCase() === plan.name.toLowerCase())) {
        return [{ kind: "reply", tone: "error", text: `You already have an agent called ${plan.name}. Pick another name.` }];
      }
      const error = policyError(plan.maxPerTxCents, plan.dailyCapCents);
      if (error) return [{ kind: "reply", tone: "error", text: error }];
      const agent = actions.provisionAgent({
        name: plan.name,
        purpose: "Provisioned from the policy terminal",
        dailyCapCents: plan.dailyCapCents,
        maxPerTxCents: plan.maxPerTxCents,
      });
      return [
        {
          kind: "call",
          tool: "create_agent_wallet",
          args: {
            agent: truncateAddress(agent.agent),
            max_per_tx: toBaseUnits(agent.maxPerTxCents),
            daily_limit: toBaseUnits(agent.dailyCapCents),
          },
        },
        {
          kind: "reply",
          tone: "success",
          text: [
            `Provisioned ${agent.name}: ${formatUsd(agent.dailyCapCents)} a day, up to ${formatUsd(agent.maxPerTxCents)} per payment.`,
            `Agent key     ${agent.agent}`,
            `Wallet PDA    ${agent.pda}`,
            "Fund its USDC vault before it can pay.",
          ].join("\n"),
        },
      ];
    }
  }
}
