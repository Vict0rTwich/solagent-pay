"use client";

import { Bot, KeyRound, LoaderCircle, Plus, TriangleAlert } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { CodeView } from "@/components/ui/CodeView";
import { CopyButton } from "@/components/ui/CopyButton";
import { segmentClass, segmentGroupClass } from "@/components/ui/FilterTabs";
import { toast } from "@/components/ui/Toaster";
import { useOrigin } from "@/hooks/use-checkout-link";
import { useMerchantSession } from "@/hooks/use-merchant-session";
import {
  DAILY_CAP_MAX_USD,
  KEY_NAME_MAX,
  keyEnvironmentFor,
  keysApi,
  type ApiKeySummary,
  type CreateApiKeyResponse,
  type KeyEnvironment,
} from "@/lib/api-keys";
import { cn } from "@/lib/cn";
import { formatDateTime, formatUsd } from "@/lib/format";
import { describeApiError } from "@/lib/invoice-api";
import type { NetworkId } from "@/lib/network";

import { SettingsCard } from "./SettingsCard";

const BADGE = "inline-flex h-5 items-center gap-1.5 rounded border px-1.5 font-mono text-[10.5px] font-medium uppercase leading-none tracking-[0.04em]";

const ENVIRONMENT_NOTE: Record<KeyEnvironment, string> = {
  test: "Works on devnet and localnet.",
  live: "Works on mainnet-beta: invoices ask for real USDC.",
};

/**
 * AI agent access: the merchant's API keys (created, capped and revoked on the payment server, which keeps only a
 * hash of each) and the HTTP 402 paywall code that uses them. Managing keys needs the merchant session.
 */
export function AgentAccessCard({ network }: { network: NetworkId }) {
  const { status, session, signIn, canSignIn } = useMerchantSession();
  const signedIn = status === "signed-in";
  const [keys, setKeys] = useState<ApiKeySummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<CreateApiKeyResponse | null>(null);

  useEffect(() => {
    if (!signedIn) {
      setKeys(null);
      setFresh(null);
      return;
    }
    let cancelled = false;
    keysApi.list().then(
      (list) => {
        if (cancelled) return;
        setKeys(list);
        setLoadError(null);
      },
      (caught: unknown) => !cancelled && setLoadError(describeApiError(caught)),
    );
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  const active = keys?.filter((key) => key.revokedAt === null) ?? [];
  const ready = active.length > 0;
  const badge = (
    <span
      className={cn(BADGE, ready ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-400 light:border-emerald-200 light:bg-emerald-50 light:text-emerald-700" : "border-idle-line bg-idle-bg text-idle")}
      title={ready ? "An active API key can create invoices for HTTP 402 paywalls" : "Create an API key to charge agents with HTTP 402"}
    >
      HTTP 402 {ready ? "ready" : "· needs a key"}
    </span>
  );

  return (
    <SettingsCard
      icon={Bot}
      title="AI agent access & x402"
      description="Charge AI agents per request: your API answers 402 Payment Required with a USDC invoice, the agent pays it on Solana, and the retry goes through. Keys let your server create those invoices."
      badge={badge}
    >
      {!signedIn ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-canvas px-4 py-3">
          <KeyRound className="size-4 shrink-0 text-accent-ink" aria-hidden />
          <p className="min-w-0 flex-1 text-[13px] text-ink-2">
            API keys live on the payment server, so managing them needs your merchant sign-in.
            {status === "disconnected" && " Connect your wallet first."}
          </p>
          <button
            type="button"
            onClick={() => void signIn().catch(() => {})}
            disabled={status === "disconnected" || status === "signing-in" || !canSignIn}
            className="btn-primary inline-flex h-8 items-center gap-2 rounded-lg px-3 text-[13px] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {status === "signing-in" ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> : <KeyRound className="size-3.5" aria-hidden />}
            {status === "signing-in" ? "Waiting for wallet…" : "Sign in with wallet"}
          </button>
        </div>
      ) : (
        <>
          <CreateKeyForm
            defaultEnvironment={keyEnvironmentFor(network)}
            onCreated={(created) => {
              setFresh(created);
              setKeys((list) => [created.apiKey, ...(list ?? [])]);
              toast(`API key "${created.apiKey.name}" created`);
            }}
          />
          {fresh && <NewKey created={fresh} onDone={() => setFresh(null)} />}
          {loadError ? (
            <p role="alert" className="mt-4 flex gap-2 text-[13px] text-danger">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              Couldn&rsquo;t load your keys: {loadError}
            </p>
          ) : (
            <KeyList keys={keys} onRevoked={(revoked) => setKeys((list) => list?.map((key) => (key.id === revoked.id ? revoked : key)) ?? null)} />
          )}
        </>
      )}

      <PaywallCode payTo={session?.address ?? null} environment={active[0]?.environment ?? keyEnvironmentFor(network)} />
    </SettingsCard>
  );
}

function CreateKeyForm({ defaultEnvironment, onCreated }: { defaultEnvironment: KeyEnvironment; onCreated: (created: CreateApiKeyResponse) => void }) {
  const [name, setName] = useState("");
  const [environment, setEnvironment] = useState<KeyEnvironment>(defaultEnvironment);
  const [cap, setCap] = useState("50");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const dailyCapUsd = Number(cap);
    if (!name.trim()) return setError("Name the key after what uses it, e.g. “Research API paywall”.");
    if (!Number.isInteger(dailyCapUsd) || dailyCapUsd < 1 || dailyCapUsd > DAILY_CAP_MAX_USD) {
      return setError(`The daily cap is whole dollars, from $1 to $${DAILY_CAP_MAX_USD.toLocaleString("en-US")}.`);
    }
    setError(null);
    setCreating(true);
    try {
      onCreated(await keysApi.create({ name: name.trim(), environment, dailyCapUsd }));
      setName("");
    } catch (caught) {
      setError(describeApiError(caught));
    } finally {
      setCreating(false);
    }
  };

  const field =
    "h-9 rounded-lg border border-line bg-canvas px-3 text-[13px] text-ink outline-none transition-colors placeholder:text-ink-3 hover:border-line-strong focus:border-accent";
  return (
    <form onSubmit={(event) => void submit(event)} noValidate>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_7.5rem_auto] sm:items-end">
        <label className="grid gap-1.5 text-xs font-medium text-ink-2">
          Key name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={KEY_NAME_MAX} placeholder="Research API paywall" autoComplete="off" className={field} />
        </label>
        <div className="grid gap-1.5">
          <span className="text-xs font-medium text-ink-2" id="key-environment-label">
            Environment
          </span>
          <div role="radiogroup" aria-labelledby="key-environment-label" className={cn(segmentGroupClass, "h-9 items-center")}>
            {(["test", "live"] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={environment === option}
                onClick={() => setEnvironment(option)}
                title={ENVIRONMENT_NOTE[option]}
                className={cn(segmentClass(environment === option), "font-mono uppercase")}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
        <label className="grid gap-1.5 text-xs font-medium text-ink-2">
          Daily cap
          <span className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-[13px] text-ink-3">$</span>
            <input value={cap} onChange={(e) => setCap(e.target.value)} inputMode="numeric" className={cn(field, "w-full pl-6 font-mono tabular-nums")} />
          </span>
        </label>
        <button
          type="submit"
          disabled={creating}
          className="btn-primary inline-flex h-9 items-center justify-center gap-2 rounded-lg px-3.5 text-[13px] disabled:cursor-wait disabled:opacity-70"
        >
          {creating ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Plus className="size-4" aria-hidden />}
          Create key
        </button>
      </div>
      <p className="mt-1.5 text-xs text-ink-3">
        {ENVIRONMENT_NOTE[environment]} Invoices a key creates pay your wallet, in USDC, up to its cap per UTC day.
      </p>
      {error && (
        <p role="alert" className="mt-2 flex gap-1.5 text-xs text-danger">
          <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      )}
    </form>
  );
}

/** The one time the full key is visible. */
function NewKey({ created, onDone }: { created: CreateApiKeyResponse; onDone: () => void }) {
  return (
    <div role="status" className="mt-4 rounded-lg border border-success-line bg-success-bg p-3">
      <p className="text-[13px] font-medium text-ink">Copy your new key now. It won&rsquo;t be shown again.</p>
      <div className="mt-2 flex items-center gap-1 rounded-md border border-line bg-canvas py-1 pl-3 pr-1">
        <code className="min-w-0 flex-1 break-all font-mono text-xs tabular-nums text-ink">{created.key}</code>
        <CopyButton text={created.key} label="Copy the API key" copiedLabel="API key copied" className="size-7" />
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-ink-2">
          Store it on your server as <span className="font-mono">SOLAGENT_API_KEY</span>; the payment server keeps only its hash.
        </p>
        <button type="button" onClick={onDone} className="btn-ghost h-7 rounded-md px-2.5 text-xs">
          I&rsquo;ve saved it
        </button>
      </div>
    </div>
  );
}

function KeyList({ keys, onRevoked }: { keys: ApiKeySummary[] | null; onRevoked: (key: ApiKeySummary) => void }) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  if (keys === null) return <p className="mt-4 text-[13px] text-ink-3">Loading your keys…</p>;
  if (keys.length === 0) return <p className="mt-4 text-[13px] text-ink-3">No API keys yet. Create one to put an endpoint behind HTTP 402.</p>;

  const revoke = async (key: ApiKeySummary) => {
    setRevoking(key.id);
    try {
      const { apiKey } = await keysApi.revoke(key.id);
      onRevoked(apiKey);
      toast(`Revoked "${key.name}": its next request is refused`);
    } catch (caught) {
      toast(describeApiError(caught), "error");
    } finally {
      setRevoking(null);
      setConfirming(null);
    }
  };

  return (
    <div className="relative mt-4 overflow-x-auto rounded-lg border border-line">
      <table className="w-full min-w-[640px] text-[13px]">
        <caption className="sr-only">API keys</caption>
        <thead>
          <tr className="th text-left shadow-[inset_0_-1px_0_var(--line)]">
            <th scope="col" className="h-8 pl-3 pr-3 font-medium">
              Name
            </th>
            <th scope="col" className="h-8 pr-3 font-medium">
              Key
            </th>
            <th scope="col" className="h-8 pr-3 font-medium">
              Today / cap <span className="font-mono normal-case tracking-normal">(UTC)</span>
            </th>
            <th scope="col" className="h-8 pr-3 font-medium">
              Last used
            </th>
            <th scope="col" className="h-8 pr-3">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {keys.map((key) => {
            const revoked = key.revokedAt !== null;
            const share = Math.min(1, key.usedTodayCents / key.dailyCapCents);
            return (
              <tr key={key.id} className={cn("border-t border-line first:border-t-0", revoked ? "text-ink-3" : "hover:bg-row-hover")}>
                <td className="max-w-[180px] py-2 pl-3 pr-3 align-middle">
                  <p className={cn("truncate font-medium", revoked ? "text-ink-3 line-through decoration-ink-3/60" : "text-ink")} title={key.name}>
                    {key.name}
                  </p>
                </td>
                <td className="whitespace-nowrap py-2 pr-3 align-middle">
                  <span className="font-mono text-xs tabular-nums text-ink-2">{key.preview}</span>
                  <span
                    className={cn(
                      "ml-2 inline-flex h-4 items-center rounded-sm border px-1 font-mono text-[9.5px] font-medium uppercase leading-none tracking-[0.06em]",
                      key.environment === "live"
                        ? "border-amber-500/30 bg-amber-500/10 text-amber-400 light:border-amber-200 light:bg-amber-50 light:text-amber-700"
                        : "border-accent-line bg-accent-soft text-accent-ink",
                    )}
                  >
                    {key.environment}
                  </span>
                </td>
                <td className="py-2 pr-3 align-middle">
                  <p className="whitespace-nowrap font-mono text-xs tabular-nums">
                    <span className={revoked ? "text-ink-3" : "text-ink"}>{formatUsd(key.usedTodayCents)}</span>
                    <span className="text-ink-3"> / {formatUsd(key.dailyCapCents)}</span>
                  </p>
                  <div
                    role="meter"
                    aria-label={`${key.name}: today's volume against its cap`}
                    aria-valuemin={0}
                    aria-valuemax={key.dailyCapCents / 100}
                    aria-valuenow={Math.min(key.usedTodayCents, key.dailyCapCents) / 100}
                    className="mt-1 h-1 w-28 overflow-hidden rounded-full bg-line"
                  >
                    <div
                      className={cn("h-full rounded-full", share >= 1 ? "bg-danger" : share >= 0.8 ? "bg-warning" : "bg-accent")}
                      style={{ width: `${share * 100}%` }}
                    />
                  </div>
                </td>
                <td className="whitespace-nowrap py-2 pr-3 align-middle font-mono text-xs tabular-nums text-ink-3">
                  {key.lastUsedAt ? `${formatDateTime(key.lastUsedAt)}` : "never"}
                </td>
                <td className="whitespace-nowrap py-2 pr-3 text-right align-middle">
                  {revoked ? (
                    <span className="font-mono text-[11px] uppercase tracking-[0.04em] text-ink-3">Revoked</span>
                  ) : confirming === key.id ? (
                    <span className="inline-flex items-center gap-1">
                      <button type="button" onClick={() => setConfirming(null)} className="h-7 rounded-md px-2 text-xs text-ink-2 hover:bg-raised">
                        Keep
                      </button>
                      <button
                        type="button"
                        onClick={() => void revoke(key)}
                        disabled={revoking === key.id}
                        className="inline-flex h-7 items-center gap-1.5 rounded-md border border-danger-line bg-danger-bg px-2 text-xs font-medium text-danger disabled:opacity-60"
                      >
                        {revoking === key.id && <LoaderCircle className="size-3 animate-spin" aria-hidden />}
                        Revoke now
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirming(key.id)}
                      className="h-7 rounded-md px-2 text-xs text-ink-2 transition-colors hover:bg-danger-bg hover:text-danger"
                    >
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

type SnippetTab = "next" | "express" | "agent";

const SNIPPET_TABS: ReadonlyArray<{ id: SnippetTab; label: string }> = [
  { id: "next", label: "Next.js" },
  { id: "express", label: "Express" },
  { id: "agent", label: "Agent (payer)" },
];

function snippet(tab: SnippetTab, values: { payTo: string; gateway: string; network: string }): string {
  const options = `{
    amount: "0.10",
    currency: "USDC",
    payTo: "${values.payTo}",
    apiKey: process.env.SOLAGENT_API_KEY!,
    gatewayUrl: "${values.gateway}",
  }`;
  if (tab === "next") {
    return `// app/api/report/route.ts: 0.10 USDC per request, paid on Solana
import { withPaywall } from "@solagent-pay/sdk";

export const GET = withPaywall(
  async () => Response.json({ report: "…" }),
  ${options},
);`;
  }
  if (tab === "express") {
    return `import express from "express";
import { solagentMiddleware } from "@solagent-pay/sdk";

const app = express();

// Unpaid requests get 402 with a USDC invoice; paid ones reach the handler, once per payment.
app.get(
  "/api/report",
  solagentMiddleware(${options}),
  (req, res) => res.json({ report: "…" }),
);

app.listen(4000);`;
  }
  return `import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { SolAgentPayClient, fetchWithPayment } from "@solagent-pay/sdk";

const client = SolAgentPayClient.fromKeypair(new Connection("https://api.${values.network}.solana.com"), agentKeypair);

// On 402, pay from the agent's on-chain wallet (its daily cap and per-payment limit apply), then retry.
const response = await fetchWithPayment("https://api.example.com/api/report", {
  pay: async ({ payTo, extra }) => {
    await client.pay({
      agentWallet: AGENT_WALLET,
      recipient: new PublicKey(payTo),
      amount: extra.amount,
      reference: extra.reference,
    });
  },
});
console.log(await response.json());`;
}

/** The paywall code, filled in with this merchant's wallet, this dashboard's URL and the key's network. */
function PaywallCode({ payTo, environment }: { payTo: string | null; environment: KeyEnvironment }) {
  const origin = useOrigin();
  const [tab, setTab] = useState<SnippetTab>("next");
  const code = snippet(tab, {
    payTo: payTo ?? "YOUR_MERCHANT_WALLET",
    gateway: origin || "https://pay.example.com",
    network: environment === "live" ? "mainnet-beta" : "devnet",
  });

  return (
    <div className="mt-6 border-t border-line pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[13px] font-medium text-ink">Put an endpoint behind HTTP 402</p>
          <p className="mt-0.5 text-xs text-ink-3">
            From <span className="font-mono">@solagent-pay/sdk</span>. The 402 body uses x402&rsquo;s <span className="font-mono">accepts</span> format
            with a Solana Pay reference scheme, so agents pay with <span className="font-mono">fetchWithPayment</span>.
          </p>
        </div>
        <div role="group" aria-label="Framework" className={segmentGroupClass}>
          {SNIPPET_TABS.map(({ id, label }) => (
            <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)} className={segmentClass(tab === id)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="relative mt-3">
        <CodeView code={code} />
        <div className="absolute right-2 top-2">
          <CopyButton text={code} label="Copy the code" copiedLabel="Code copied" className="size-7 bg-console-raised" />
        </div>
      </div>
    </div>
  );
}
