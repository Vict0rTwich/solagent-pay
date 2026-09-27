"use client";

import { Connection } from "@solana/web3.js";
import {
  Check,
  CircleAlert,
  Database,
  LoaderCircle,
  Network,
  PartyPopper,
  RefreshCw,
  TriangleAlert,
  Volume2,
  VolumeX,
  Webhook,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { Reveal } from "@/components/dashboard/Reveal";
import { PageHeader } from "@/components/ui/PageHeader";
import { useCelebrate } from "@/hooks/use-celebrate";
import { cn } from "@/lib/cn";
import { formatCount } from "@/lib/format";
import { invoiceApi, type PaymentSucceededEvent, type WebhookHealth } from "@/lib/invoice-api";
import { NETWORKS, USDC_MINT_DEVNET, type NetworkId } from "@/lib/network";
import { useSettings } from "@/lib/settings";

import { AgentAccessCard } from "./AgentAccessCard";
import { SettingsCard } from "./SettingsCard";

const NETWORK_ORDER: readonly NetworkId[] = ["devnet", "localnet", "mainnet-beta"];

const NETWORK_NOTES: Record<NetworkId, string> = {
  devnet: "Free test network. Get test USDC from faucet.circle.com.",
  localnet: "Your own solana-test-validator. Nothing leaves your machine.",
  "mainnet-beta": "Real USDC. Payment links request real funds.",
};

interface Draft {
  network: NetworkId;
  dataSource: "auto" | "demo";
}

const DATA_SOURCES = [
  {
    id: "auto",
    label: "Live when a wallet is connected",
    note: "USDC balance, transfers, invoices and agent wallets from the selected network. Falls back to demo data without a wallet, or when the RPC doesn't answer.",
  },
  { id: "demo", label: "Demo data", note: "Seeded sample data for walkthroughs. Nothing is read from the chain." },
] as const;

export function SettingsView() {
  const [settings, update] = useSettings();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const current: Draft = draft ?? { network: settings.network, dataSource: settings.dataSource };
  const dirty = draft !== null && (draft.network !== settings.network || draft.dataSource !== settings.dataSource);

  useEffect(() => {
    if (savedAt === null) return;
    const timer = setTimeout(() => setSavedAt(null), 2500);
    return () => clearTimeout(timer);
  }, [savedAt]);

  const edit = (patch: Partial<Draft>) => {
    setDraft({ ...current, ...patch });
    setSavedAt(null);
  };

  const save = () => {
    update({ network: current.network, dataSource: current.dataSource });
    setDraft(null);
    setSavedAt(Date.now());
  };

  return (
    <div className="mx-auto w-full max-w-[960px] space-y-5 pb-24">
      <Reveal index={0}>
        <PageHeader title="Settings" description="Network, settlement callbacks and API access for this workspace." note="Saved in this browser" />
      </Reveal>

      <Reveal index={1}>
        <SettingsCard
          icon={Network}
          title="Solana RPC network"
          description="Every balance, payment link and explorer link uses this network. Switch your wallet to the same one."
        >
          <div role="radiogroup" aria-label="Solana network" className="grid gap-3 md:grid-cols-3">
            {NETWORK_ORDER.map((id) => {
              const network = NETWORKS[id];
              const selected = current.network === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => edit({ network: id })}
                  className={cn(
                    "relative rounded-lg border p-4 text-left transition-colors",
                    selected ? "border-accent bg-accent-soft" : "border-line hover:border-accent-line hover:bg-accent-soft",
                  )}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-ink">
                      {network.label}
                      {id === "devnet" && <span className="ml-1.5 text-xs font-normal text-ink-3">default</span>}
                    </span>
                    <span
                      aria-hidden
                      className={cn(
                        "grid size-4 place-items-center rounded-full border",
                        selected ? "border-accent bg-accent" : "border-line-strong",
                      )}
                    >
                      {selected && <span className="size-1.5 rounded-full bg-accent-fg" />}
                    </span>
                  </span>
                  <span className="mt-2 block break-all font-mono text-[11px] text-ink-3">{network.endpoint}</span>
                  <span className="mt-2 block text-xs text-ink-2">{NETWORK_NOTES[id]}</span>
                </button>
              );
            })}
          </div>

          {current.network === "mainnet-beta" && (
            <Callout tone="warning">
              Payment links on Mainnet Beta ask for real USDC. The public RPC is rate-limited, so set
              NEXT_PUBLIC_SOLANA_MAINNET_RPC_URL to a dedicated endpoint before taking payments.
            </Callout>
          )}
          {current.network === "localnet" && (
            <Callout tone="info">
              Start a validator with <code className="font-mono text-ink">solana-test-validator</code>. To accept USDC locally,
              clone the devnet mint: <code className="break-all font-mono text-ink">--clone {USDC_MINT_DEVNET} --url devnet</code>
            </Callout>
          )}

          <ConnectionTest key={current.network} network={current.network} />
        </SettingsCard>
      </Reveal>

      <Reveal index={2}>
        <SettingsCard
          icon={Database}
          title="Data source"
          description="What the dashboard shows. The header badge says which one is on screen and why."
        >
          <div role="radiogroup" aria-label="Data source" className="grid gap-3 md:grid-cols-2">
            {DATA_SOURCES.map((option) => {
              const selected = current.dataSource === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => edit({ dataSource: option.id })}
                  className={cn(
                    "rounded-lg border p-4 text-left transition-colors",
                    selected ? "border-accent bg-accent-soft" : "border-line hover:border-accent-line hover:bg-accent-soft",
                  )}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-ink">{option.label}</span>
                    <span
                      aria-hidden
                      className={cn(
                        "grid size-4 shrink-0 place-items-center rounded-full border",
                        selected ? "border-accent bg-accent" : "border-line-strong",
                      )}
                    >
                      {selected && <span className="size-1.5 rounded-full bg-accent-fg" />}
                    </span>
                  </span>
                  <span className="mt-2 block text-xs text-ink-2">{option.note}</span>
                </button>
              );
            })}
          </div>
        </SettingsCard>
      </Reveal>

      <Reveal index={3}>
        <CelebrationCard sounds={settings.sounds} onSounds={(sounds) => update({ sounds })} />
      </Reveal>

      <Reveal index={4}>
        <WebhookCard network={current.network} />
      </Reveal>

      <Reveal index={5}>
        <AgentAccessCard network={settings.network} />
      </Reveal>

      {/* Above the event stream bar pinned to the bottom of the dashboard. */}
      <div className="sticky bottom-14 z-20">
        <div className="popover flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 sm:px-5">
          <p className="text-[13px]" aria-live="polite">
            {savedAt !== null ? (
              <span className="inline-flex items-center gap-1.5 text-success">
                <Check className="size-4" strokeWidth={2.5} aria-hidden />
                Changes saved
              </span>
            ) : dirty ? (
              <span className="text-ink">You have unsaved changes</span>
            ) : (
              <span className="text-ink-3">All changes saved</span>
            )}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setDraft(null)}
              disabled={!dirty}
              className="btn-ghost h-8 rounded-lg px-3 text-[13px] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Discard
            </button>
            <button
              type="button"
              onClick={save}
              disabled={!dirty}
              className="btn-primary inline-flex h-8 items-center gap-2 rounded-lg px-3 text-[13px] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {savedAt !== null && <Check className="size-4" strokeWidth={2.5} aria-hidden />}
              {savedAt !== null ? "Saved" : "Save changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Applies at once, like the theme switch: a preference of this browser, not a workspace change to save. */
function CelebrationCard({ sounds, onSounds }: { sounds: boolean; onSounds: (sounds: boolean) => void }) {
  const celebrate = useCelebrate();
  const [previews, setPreviews] = useState(0);
  return (
    <SettingsCard
      icon={PartyPopper}
      title="Payment celebrations"
      description="Confetti and a short chime when an invoice is paid, on the dashboard and on your client's checkout page."
    >
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line p-4">
        <button type="button" role="switch" aria-checked={sounds} onClick={() => onSounds(!sounds)} className="flex items-center gap-3 text-left">
          <span aria-hidden className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors", sounds ? "bg-accent" : "bg-line-strong")}>
            <span className={cn("absolute top-0.5 size-4 rounded-full transition-[left]", sounds ? "left-[18px] bg-accent-fg" : "left-0.5 bg-panel")} />
          </span>
          <span>
            <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
              {sounds ? <Volume2 className="size-4 text-accent-ink" aria-hidden /> : <VolumeX className="size-4 text-ink-3" aria-hidden />}
              Payment chime
            </span>
            <span className="mt-0.5 block text-xs text-ink-3">Two soft notes, made in the browser. Confetti follows your system&rsquo;s reduced-motion setting.</span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => {
            setPreviews((n) => n + 1);
            celebrate(`preview-${previews}`);
          }}
          className="btn-ghost inline-flex h-8 items-center gap-2 rounded-lg px-3 text-[13px]"
        >
          <PartyPopper className="size-3.5" aria-hidden />
          Preview
        </button>
      </div>
    </SettingsCard>
  );
}

function Callout({ tone, children }: { tone: "warning" | "info"; children: ReactNode }) {
  const Icon = tone === "warning" ? TriangleAlert : CircleAlert;
  return (
    <div
      role={tone === "warning" ? "alert" : undefined}
      className={cn(
        "mt-4 flex gap-2.5 rounded-lg border px-3 py-2.5 text-xs leading-relaxed",
        tone === "warning" ? "border-warning-line bg-warning-bg text-ink" : "border-line bg-canvas text-ink-2",
      )}
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0", tone === "warning" ? "text-warning" : "text-ink-3")} aria-hidden />
      <p>{children}</p>
    </div>
  );
}

type TestResult = { state: "idle" } | { state: "running" } | { state: "ok"; slot: number; ms: number } | { state: "error"; message: string };

/** Asks the selected endpoint for its current slot, so a wrong URL or stopped validator shows up before saving. */
function ConnectionTest({ network }: { network: NetworkId }) {
  const [result, setResult] = useState<TestResult>({ state: "idle" });
  const config = NETWORKS[network];

  const test = async () => {
    setResult({ state: "running" });
    const started = performance.now();
    try {
      const slot = await Promise.race([
        new Connection(config.endpoint, "confirmed").getSlot(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 6000)),
      ]);
      setResult({ state: "ok", slot, ms: Math.round(performance.now() - started) });
    } catch (error) {
      const timedOut = error instanceof Error && error.message === "timeout";
      setResult({
        state: "error",
        message:
          network === "localnet"
            ? "No validator answered at 127.0.0.1:8899. Start solana-test-validator and try again."
            : timedOut
              ? `${config.label} didn't answer within 6 seconds.`
              : `Couldn't reach ${config.label}. Check your connection or try a different RPC endpoint.`,
      });
    }
  };

  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={() => void test()}
        disabled={result.state === "running"}
        className="btn-ghost inline-flex h-8 items-center gap-2 rounded-lg px-3 text-[13px] disabled:opacity-60"
      >
        {result.state === "running" ? (
          <LoaderCircle className="size-4 animate-spin" aria-hidden />
        ) : (
          <RefreshCw className="size-4" aria-hidden />
        )}
        Test connection
      </button>
      <p className="text-xs" aria-live="polite">
        {result.state === "ok" && (
          <span className="inline-flex items-center gap-1.5 text-success">
            <Check className="size-3.5" strokeWidth={2.5} aria-hidden />
            Reachable · slot <span className="font-mono">{formatCount(result.slot)}</span> in {result.ms} ms
          </span>
        )}
        {result.state === "error" && (
          <span className="inline-flex items-start gap-1.5 text-danger">
            <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
            {result.message}
          </span>
        )}
      </p>
    </div>
  );
}

/**
 * The payment server sends webhooks, so they're configured on the server (SOLAGENT_WEBHOOK_URL and
 * SOLAGENT_WEBHOOK_SECRET), not in this browser. This shows what the server reports.
 */
function WebhookCard({ network }: { network: NetworkId }) {
  const [health, setHealth] = useState<WebhookHealth | "unreachable" | null>(null);

  useEffect(() => {
    let cancelled = false;
    invoiceApi.webhookHealth().then(
      (webhooks) => !cancelled && setHealth(webhooks),
      () => !cancelled && setHealth("unreachable"),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const example: PaymentSucceededEvent = {
    id: "evt_paid_7Q9hC2…",
    event: "payment.succeeded",
    invoiceId: "INV-1001",
    amount: "1.00",
    token: "USDC",
    signature: "5Kx9…Qz2a",
    timestamp: 1790215899,
    reference: "7Q9hC2…",
    network,
  };

  return (
    <SettingsCard
      icon={Webhook}
      title="Settlement webhook"
      description="Once the payment server has verified a payment on-chain, it POSTs payment.succeeded to your endpoint, once per invoice, retrying until it gets a 2xx."
    >
      <dl className="grid gap-2 text-sm sm:grid-cols-3">
        <HealthItem label="Endpoint">
          {health === null ? "Checking…" : health === "unreachable" ? "Server unreachable" : health.configured ? "Configured" : "Not set"}
        </HealthItem>
        <HealthItem label="Signing">
          {health === null || health === "unreachable" ? "—" : health.signed ? "HMAC-SHA256" : "Unsigned"}
        </HealthItem>
        <HealthItem label="Deliveries">
          {health === null || health === "unreachable"
            ? "—"
            : `${formatCount(health.delivered)} sent · ${formatCount(health.queued)} queued${health.failed ? ` · ${formatCount(health.failed)} failed` : ""}`}
        </HealthItem>
      </dl>
      {health !== null && health !== "unreachable" && (!health.configured || !health.signed) && (
        <p className="mt-3 flex gap-1.5 text-xs text-warning">
          <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
          {health.configured
            ? "Set SOLAGENT_WEBHOOK_SECRET on the server so your endpoint can tell real calls from forged ones."
            : "Set SOLAGENT_WEBHOOK_URL (and SOLAGENT_WEBHOOK_SECRET) on the server, then restart it. Payments are recorded meanwhile, but not sent."}
        </p>
      )}
      <p className="mt-3 text-xs text-ink-3">
        Headers: <span className="font-mono">X-SolAgent-Event-Id</span> (the same on every retry: deduplicate on it) and{" "}
        <span className="font-mono">X-SolAgent-Signature: t=…,v1=…</span>, an HMAC-SHA256 of{" "}
        <span className="font-mono">&quot;&lt;t&gt;.&lt;body&gt;&quot;</span> with your secret.
      </p>
      <details className="group mt-4 rounded-lg border border-line bg-canvas">
        <summary className="cursor-pointer select-none px-3 py-2 text-xs text-ink-2 hover:text-ink">Example payload</summary>
        <pre className="overflow-x-auto border-t border-line px-3 py-3 font-mono text-[11px] leading-relaxed text-ink-2">
          {JSON.stringify(example, null, 2)}
        </pre>
      </details>
    </SettingsCard>
  );
}

function HealthItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-canvas px-3 py-2">
      <dt className="text-[11px] text-ink-3">{label}</dt>
      <dd className="mt-0.5 text-[13px] text-ink">{children}</dd>
    </div>
  );
}

