import { NETWORKS, type NetworkId } from "@/lib/network";
import { receiptName } from "@/lib/products";
import { formatAmount } from "@/lib/solana-pay";

import { jitter } from "./backoff";
import type { EmitEngineEvent } from "./events";
import type { InvoiceRecord, InvoiceStore } from "./store";

// Proof-of-purchase receipts: once an order settles, the buyer gets a compressed NFT naming what they bought, the
// price, the settling transaction and when it confirmed. Minted with Underdog Protocol's API, which pays for and
// submits the mint; this server only asks. Receipts are queued by the store in the same write that marks the
// invoice paid (see markPaid), and minted from that queue here, the way webhooks are delivered.
//
// Without UNDERDOG_API_KEY and UNDERDOG_PROJECT_ID the minter still runs: it logs what it would mint and marks the
// receipt "simulated", so local development and builds need no Underdog account.

/** Wait before retry n (after attempt n failed): about 2.5 hours in all, then the receipt is marked failed. */
const RETRY_SCHEDULE_MS = [15_000, 60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000];
const REQUEST_TIMEOUT_MS = 15_000;
/** How long a claimed receipt is ours: the request timeout plus slack for the store writes around it. */
const LEASE_MS = REQUEST_TIMEOUT_MS + 30_000;
const MAX_PER_SWEEP = 25;
const SWEEP_MS = 5_000;

const UNDERDOG_API: Record<UnderdogConfig["network"], string> = {
  devnet: "https://devnet.underdogprotocol.com",
  "mainnet-beta": "https://mainnet.underdogprotocol.com",
};

export interface UnderdogConfig {
  apiKey: string | null;
  projectId: string | null;
  /** The network the key mints on. */
  network: Extract<NetworkId, "devnet" | "mainnet-beta">;
  apiUrl: string | null;
}

/** Body of Underdog's POST /v2/projects/{projectId}/nfts. */
export interface UnderdogNft {
  /** On-chain name: at most 32 characters. */
  name: string;
  symbol: string;
  description: string;
  image: string;
  externalUrl: string;
  attributes: Record<string, string | number>;
  receiverAddress: string;
}

/** What the receipt says: "Receipt: <product>", the product image, and the price, transaction and time it settled. */
export function receiptNft(invoice: InvoiceRecord, owner: string, fallbackImage: string | null): UnderdogNft | null {
  const image = invoice.product?.image ?? fallbackImage;
  if (!image || !invoice.signature) return null;
  const title = invoice.product?.title || invoice.memo || invoice.id;
  const price = `${formatAmount(invoice.amount)} ${invoice.token}`;
  const cluster = invoice.network === "mainnet-beta" ? "" : `?cluster=${invoice.network}`;
  return {
    name: receiptName(title),
    symbol: "RCPT",
    description: `Proof of purchase: ${title}. ${price} paid for order ${invoice.id} on ${NETWORKS[invoice.network].label}.`,
    image,
    externalUrl: `https://solscan.io/tx/${invoice.signature}${cluster}`,
    attributes: {
      Price: price,
      TxSignature: invoice.signature,
      Timestamp: new Date((invoice.blockTime ?? Math.floor((invoice.paidAt ?? Date.now()) / 1000)) * 1000).toISOString(),
      Order: invoice.id,
    },
    receiverAddress: owner,
  };
}

type Attempt =
  | { outcome: "MINTED"; mintAddress: string | null; transactionId: string | null }
  | { outcome: "SIMULATED"; reason: string }
  | { outcome: "ERROR"; error: string; permanent: boolean };

export class ReceiptMinter {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private again = false;
  private warnedSimulated = false;

  constructor(
    private readonly store: InvoiceStore,
    private readonly config: UnderdogConfig,
    /** The generated token icon's public URL, for orders whose product has no image. Null without a public origin. */
    private readonly iconUrl: (invoice: InvoiceRecord) => string | null,
    private readonly log: (message: string) => void,
    private readonly emit: EmitEngineEvent,
  ) {}

  /** Real mints need both a key and the project that holds the receipts. */
  get configured(): boolean {
    return this.config.apiKey !== null && this.config.projectId !== null;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.kick(), SWEEP_MS);
    this.kick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Mints whatever is due now (e.g. right after an order settles). */
  kick(): void {
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    void this.mintDue()
      .catch((error: unknown) => this.log(`receipt sweep failed: ${String(error)}`))
      .finally(() => {
        this.running = false;
        if (this.again) {
          this.again = false;
          this.kick();
        }
      });
  }

  private async mintDue(): Promise<void> {
    for (let minted = 0; minted < MAX_PER_SWEEP; minted++) {
      const invoice = await this.store.claimDueReceipt(LEASE_MS);
      if (!invoice?.receipt) return;
      await this.mint(invoice, invoice.receipt.owner, invoice.receipt.attempts + 1);
    }
  }

  /** Why this receipt can't be a real mint, or null when it can. */
  private simulatedReason(invoice: InvoiceRecord): string | null {
    if (!this.config.apiKey) return "UNDERDOG_API_KEY isn't set on this server, so the receipt was simulated, not minted.";
    if (!this.config.projectId) return "UNDERDOG_PROJECT_ID isn't set on this server, so the receipt was simulated, not minted.";
    if (invoice.network !== this.config.network) {
      return `This server mints receipts on ${NETWORKS[this.config.network].label}, and this sale was on ${NETWORKS[invoice.network].label}, so its receipt was simulated.`;
    }
    return null;
  }

  private async attempt(invoice: InvoiceRecord, nft: UnderdogNft): Promise<Attempt> {
    const reason = this.simulatedReason(invoice);
    if (reason) return { outcome: "SIMULATED", reason };
    const base = this.config.apiUrl ?? UNDERDOG_API[this.config.network];
    try {
      // No redirects: the API key goes only where it was configured to go.
      const response = await fetch(`${base}/v2/projects/${encodeURIComponent(this.config.projectId ?? "")}/nfts`, {
        method: "POST",
        headers: { authorization: `Bearer ${this.config.apiKey ?? ""}`, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(nft),
        redirect: "manual",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const text = await response.text().catch(() => "");
      if (!response.ok) {
        // A request Underdog refuses (bad image, unknown project, wrong key) fails the same way every time.
        const permanent = response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429;
        const detail = text.replace(/\s+/g, " ").trim().slice(0, 160);
        return { outcome: "ERROR", error: `Underdog answered HTTP ${response.status}${detail ? `: ${detail}` : ""}`, permanent };
      }
      const body = (text ? JSON.parse(text) : {}) as { mintAddress?: unknown; transactionId?: unknown };
      return {
        outcome: "MINTED",
        mintAddress: typeof body.mintAddress === "string" ? body.mintAddress : null,
        transactionId: typeof body.transactionId === "string" ? body.transactionId : null,
      };
    } catch (error) {
      // A timeout may still have minted on Underdog's side; the retry can then mint a second receipt. Rare, and
      // a duplicate receipt is harmless next to a missing one.
      return { outcome: "ERROR", error: error instanceof Error ? error.message : String(error), permanent: false };
    }
  }

  private async mint(invoice: InvoiceRecord, owner: string, attempts: number): Promise<void> {
    const nft = receiptNft(invoice, owner, this.iconUrl(invoice));
    const about = { network: invoice.network, merchant: invoice.recipient, reference: invoice.reference };
    const report = (outcome: string, data: Record<string, unknown> = {}) =>
      this.emit({ type: "RECEIPT_MINT", ...about, data: { invoiceId: invoice.id, owner, outcome, attempt: attempts, name: nft?.name ?? null, ...data } });

    if (!nft) {
      const error = invoice.signature
        ? "The product has no image, and without SOLAGENT_APP_URL there's no public icon to use instead."
        : "The invoice has no settling transaction to put on the receipt.";
      await this.store.updateReceipt(invoice.reference, { status: "failed", attempts, note: error });
      report("FAILED", { error });
      return;
    }

    const result = await this.attempt(invoice, nft);
    const now = Date.now();
    if (result.outcome === "SIMULATED") {
      if (!this.warnedSimulated) {
        this.warnedSimulated = true;
        this.log(`receipts are simulated: ${result.reason} Set UNDERDOG_API_KEY and UNDERDOG_PROJECT_ID to mint real cNFTs.`);
      }
      this.log(`receipt ${invoice.id} (simulated): would mint "${nft.name}" to ${owner} · ${String(nft.attributes.Price)} · tx ${String(nft.attributes.TxSignature)}`);
      await this.store.updateReceipt(invoice.reference, { status: "simulated", attempts, mintedAt: now, note: result.reason });
      report("SIMULATED", { reason: result.reason, metadata: nft });
      return;
    }
    if (result.outcome === "MINTED") {
      await this.store.updateReceipt(invoice.reference, {
        status: "minted",
        attempts,
        mintedAt: now,
        mintAddress: result.mintAddress,
        transactionId: result.transactionId,
        note: null,
      });
      this.log(`receipt ${invoice.id} minted to ${owner}${result.mintAddress ? ` as ${result.mintAddress}` : ""}`);
      report("MINTED", { mintAddress: result.mintAddress, transactionId: result.transactionId, metadata: nft });
      return;
    }

    const wait = result.permanent ? undefined : RETRY_SCHEDULE_MS[attempts - 1];
    if (wait === undefined) {
      await this.store.updateReceipt(invoice.reference, { status: "failed", attempts, note: result.error });
      this.log(`receipt ${invoice.id} failed after ${attempts} attempt(s): ${result.error}`);
      report("FAILED", { error: result.error });
      return;
    }
    await this.store.updateReceipt(invoice.reference, { attempts, nextAttemptAt: now + jitter(wait), note: result.error });
    this.log(`receipt ${invoice.id} attempt ${attempts} failed (${result.error}); retrying in ~${Math.round(wait / 1000)} s`);
    report("RETRYING", { error: result.error, retryInSeconds: Math.round(wait / 1000) });
  }
}
