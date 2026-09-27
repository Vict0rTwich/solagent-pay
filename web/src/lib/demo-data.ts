import { Keypair } from "@solana/web3.js";

import { findAgentWalletPda } from "./agents";
import { encodeBase58 } from "./base58";
import { formatDay, formatMonth } from "./format";
import { USDC_MINT_DEVNET } from "./network";
import { buildTransferRequest, centsToAmount } from "./solana-pay";
import type { AgentWallet, DailySettlement, Invoice, LedgerTx, PaymentType, Product } from "./types";

// Seeded demo ledger, anchored to "now": every record falls in the 30 days up to the moment it's generated, and
// dates written into memos ("Validator monitoring — September") follow the same clock. Generation is a pure
// function of the anchor (fixed seeds, no clock reads), so the server and the browser, given the same anchor, build
// the same data and the page hydrates cleanly. The dashboard layout reads the anchor once per request and hands it
// down. Replace with indexer data when it exists.

export const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

export const INITIAL_BALANCE_CENTS = 771_150;
/** Merchant wallet that the seeded invoices pay and that owns the seeded agents. */
export const DEMO_MERCHANT = "Dx1GcUKx9QCWPQ5z3tARahdq1ierxsRkZwq6ALo7MNJz";
export const INVOICE_TTL_MS = 7 * DAY_MS;

/**
 * Days (including today) with itemized records: transactions, invoices, agents, products. Nothing itemized is older
 * than this many days before the anchor.
 */
export const LEDGER_DAYS = 30;
/**
 * Days of daily totals, for the 90-day range and the "vs prior period" comparisons. Beyond the itemized window they
 * are totals only: no record, date or memo from before it is ever shown.
 */
export const HISTORY_DAYS = 120;
const AVERAGE_TICKET_DOLLARS = 104;

/** A memo written at the record's own date, so any month, quarter or day it names moves with the anchor. */
type Memo = string | ((at: number) => string);

const quarter = (at: number) => `Q${Math.floor(new Date(at).getUTCMonth() / 3) + 1}`;
const shortMonth = (at: number) => formatDay(at).split(" ")[0] ?? "";

function memoAt(memo: Memo, at: number): string {
  return typeof memo === "string" ? memo : memo(at);
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function pick<T>(items: readonly T[], rand: () => number): T {
  const item = items[Math.floor(rand() * items.length)];
  if (item === undefined) throw new Error("pick() needs a non-empty list");
  return item;
}

function randomBytes(rand: () => number, length: number): Uint8Array {
  return Uint8Array.from({ length }, () => Math.floor(rand() * 256));
}

interface DemoClient {
  name: string;
  wallet: string;
  type: Exclude<PaymentType, "payout" | "transfer">;
  memos: readonly Memo[];
  minCents: number;
  maxCents: number;
}

const AGENT_CLIENTS: readonly DemoClient[] = [
  {
    name: "Kite Procurement Agent",
    wallet: "j584jqjt8JTVazrph2SiaNnmJvLQ99o5A4JPuLGbbNU",
    type: "agent",
    memos: ["Supplier price feed · 10k calls", "Quote API credits", "Catalog sync"],
    minCents: 180,
    maxCents: 4_800,
  },
  {
    name: "Ledgerline Research Agent",
    wallet: "6vj3SmbhNzudKxmJ5o9CeDE6JUDgf1QLDuYqJVFSshe7",
    type: "agent",
    memos: [(at) => `Filings dataset · ${quarter(at)}`, "Report generation", "Entity lookup batch"],
    minCents: 250,
    maxCents: 6_500,
  },
  {
    name: "Halcyon Support Agent",
    wallet: "Ax2wBXgo9gNUST6qrcBYTE91crq5PTwtiy179cm5mm3o",
    type: "agent",
    memos: ["Translation batch", "Voice minutes", "Ticket triage credits"],
    minCents: 90,
    maxCents: 2_400,
  },
  {
    name: "Atlas Scout Agent",
    wallet: "8K1BvzVo8YC3NcxFxYcey9AMMjfCd6ajtrxUHUburHiY",
    type: "agent",
    memos: ["Web crawl · 2k pages", "Geocoding batch", "Image tagging"],
    minCents: 120,
    maxCents: 3_900,
  },
];

const PEOPLE_CLIENTS: readonly DemoClient[] = [
  {
    name: "Mosswood Design",
    wallet: "3jRPLemxWv1SaEQ5ZAF76Ep5G95DuMeNqTvnqxxxGugU",
    type: "invoice",
    memos: ["Brand refresh — milestone 2", "Illustration set"],
    minCents: 18_000,
    maxCents: 64_000,
  },
  {
    name: "Cobalt Harbor Freight",
    wallet: "8qwssPB2QCLDC4yhbsr6DLKW1XqwhbKVyw3k8ajqxGra",
    type: "invoice",
    memos: [(at) => `Route optimization — ${shortMonth(at)}`, "Dispatch seats ×12"],
    minCents: 21_000,
    maxCents: 58_000,
  },
  {
    name: "Juniper Health Collective",
    wallet: "2R6Dgz5xPEMdZxEBUo8vMqmz2UfBuP5mHvJnnA2JBx9y",
    type: "link",
    memos: ["Scheduling seats", "Onboarding session"],
    minCents: 4_900,
    maxCents: 22_000,
  },
  {
    name: "Tessellate Studio",
    wallet: "8xFtweCsZ6gY64SPEzYANMP2neRyvQVBDui1abt1oz74",
    type: "link",
    memos: ["Workshop tickets ×4", "Asset license"],
    minCents: 6_000,
    maxCents: 18_000,
  },
  {
    name: "Ferro Analytics",
    wallet: "DgfPeSYMA6cFVSrXqcvqKFVafPdAJgsnRTubeSFdpCeJ",
    type: "invoice",
    memos: ["Retainer top-up"],
    minCents: 25_000,
    maxCents: 75_000,
  },
  {
    name: "Lumen Caterers",
    wallet: "Ebz5h8xfJAsbo3K6yXTKwRrbQk73e9SrR9QhbZC4a7bh",
    type: "link",
    memos: ["Event deposit", "Tasting menu"],
    minCents: 8_500,
    maxCents: 30_000,
  },
];

// Errors the payer's own SolAgent wallet raises when its policy blocks a payment.
const PAYER_POLICY_ERRORS = [
  { code: "ExceedsDailyLimit", message: "Payer agent's daily limit reached" },
  { code: "ExceedsPerTxLimit", message: "Above the payer agent's per-payment limit" },
  { code: "WalletPaused", message: "Payer agent's wallet is paused" },
] as const;

/** Target settled dollars for a day: growth over time, quieter weekends, daily noise. */
function dailyTargetDollars(day: number, today: number, rand: () => number): number {
  const index = HISTORY_DAYS - Math.round((today - day) / DAY_MS);
  const weekday = new Date(day).getUTCDay();
  const weekend = weekday === 0 || weekday === 6;
  return 2_200 * (1 + index * 0.0035) * (weekend ? 0.62 : 1) * (0.78 + rand() * 0.44);
}

/** Daily totals for the days before the itemized ledger. */
function generateHistory(today: number): DailySettlement[] {
  const rand = mulberry32(0x0a11ce55);
  const days: DailySettlement[] = [];
  for (let ago = HISTORY_DAYS; ago >= LEDGER_DAYS; ago--) {
    const day = today - ago * DAY_MS;
    const dollars = dailyTargetDollars(day, today, rand);
    days.push({
      day,
      volumeCents: Math.round(dollars * 100),
      count: Math.max(4, Math.round((dollars / AVERAGE_TICKET_DOLLARS) * (0.85 + rand() * 0.3))),
    });
  }
  return days;
}

/** Itemized inbound payments from the start of the itemized window up to two minutes before `now`, newest first. */
function generateLedger(now: number, today: number): LedgerTx[] {
  const rand = mulberry32(0x5eed0923);
  const txs: LedgerTx[] = [];

  for (let ago = LEDGER_DAYS - 1; ago >= 0; ago--) {
    const day = today - ago * DAY_MS;
    const end = ago === 0 ? now - 2 * MINUTE_MS : day + DAY_MS;
    const count = Math.max(4, Math.round(dailyTargetDollars(day, today, rand) / AVERAGE_TICKET_DOLLARS));
    const meanGap = DAY_MS / count;

    for (let t = day + rand() * meanGap; t < end; t += meanGap * (0.3 + rand() * 1.4)) {
      const client = pick(rand() < 0.7 ? AGENT_CLIENTS : PEOPLE_CLIENTS, rand);
      const failed = client.type === "agent" && rand() < 0.025;
      const createdAt = Math.round(t / 1000) * 1000;
      txs.push({
        signature: encodeBase58(randomBytes(rand, 64)),
        createdAt,
        senderName: client.name,
        wallet: client.wallet,
        type: client.type,
        amountCents: Math.round(client.minCents + rand() * (client.maxCents - client.minCents)),
        status: failed ? "failed" : "confirmed",
        memo: memoAt(pick(client.memos, rand), createdAt),
        ...(failed ? { failure: { ...pick(PAYER_POLICY_ERRORS, rand) } } : {}),
      });
    }
  }

  // The newest payment is still confirming.
  const newest = txs[txs.length - 1];
  if (newest) {
    newest.status = "pending";
    delete newest.failure;
  }
  return txs.reverse();
}

interface UnpaidSeed {
  /** How long before `now` it was created: [days, hours, minutes]. */
  ago: readonly [number, number, number];
  client: string;
  kind: Invoice["kind"];
  memo: Memo;
  /** USDC in cents; or `sol`, for an invoice in native SOL. */
  cents?: number;
  sol?: string;
}

// Invoices nobody has paid yet: ones under 7 days old are open, older ones are past their expiry. A day or month a
// memo names is the invoice's own, never a later one: no sample date is in the future.
const UNPAID: readonly UnpaidSeed[] = [
  { ago: [0, 0, 47], client: "Mosswood Design", kind: "invoice", memo: "Brand refresh — milestone 3", cents: 48_000 },
  { ago: [0, 0, 11], client: "Lumen Caterers", kind: "link", memo: (at) => `Tasting menu · ${formatDay(at)}`, cents: 12_500 },
  { ago: [0, 3, 22], client: "Tessellate Studio", kind: "link", memo: "Priority support hour", sol: "0.75" },
  { ago: [1, 5, 54], client: "Orbit Relay Labs", kind: "invoice", memo: (at) => `Validator monitoring — ${formatMonth(at)}`, sol: "2.5" },
  { ago: [2, 5, 30], client: "Cobalt Harbor Freight", kind: "invoice", memo: (at) => `Dispatch seats ×12 — ${formatMonth(at)}`, cents: 52_000 },
  { ago: [3, 23, 2], client: "Juniper Health Collective", kind: "link", memo: "Onboarding session", cents: 9_900 },
  { ago: [6, 6, 37], client: "Tessellate Studio", kind: "link", memo: "Asset license — extended", cents: 14_500 },
  { ago: [9, 4, 22], client: "Ferro Analytics", kind: "invoice", memo: (at) => `Retainer top-up — ${quarter(at)}`, cents: 60_000 },
  { ago: [12, 1, 57], client: "Lumen Caterers", kind: "link", memo: (at) => `Event deposit — ${formatDay(at)}`, cents: 22_000 },
  { ago: [17, 7, 12], client: "Mosswood Design", kind: "invoice", memo: "Illustration set — revisions", cents: 26_000 },
  { ago: [23, 0, 32], client: "Juniper Health Collective", kind: "link", memo: "Scheduling seats — pilot", cents: 7_500 },
];

/**
 * Invoices behind the ledger's link and invoice payments, plus unpaid ones. Links each paid tx to its invoice. An
 * invoice is sent a while before it's paid, but never earlier than the start of the itemized window.
 */
function generateInvoices(ledger: LedgerTx[], now: number): Invoice[] {
  const windowStart = now - LEDGER_DAYS * DAY_MS;
  const rand = mulberry32(0x1a701ce5);
  // Its own sequence, so adding receipts didn't change any other seeded value.
  const receiptRand = mulberry32(0x7ece1975);
  const drafts: Array<Omit<Invoice, "id" | "paymentUrl"> & { tx?: LedgerTx }> = [];

  for (const tx of ledger) {
    if ((tx.type !== "link" && tx.type !== "invoice") || tx.status !== "confirmed") continue;
    const delay = tx.type === "link" ? 2 * MINUTE_MS + rand() ** 2 * 6 * HOUR_MS : HOUR_MS + rand() ** 2 * 4 * DAY_MS;
    const createdAt = Math.max(windowStart, Math.round((tx.createdAt - delay) / 1000) * 1000);
    drafts.push({
      kind: tx.type,
      client: tx.senderName,
      memo: tx.memo,
      amount: centsToAmount(tx.amountCents),
      createdAt,
      expiresAt: createdAt + INVOICE_TTL_MS,
      paidAt: tx.createdAt,
      signature: tx.signature ?? undefined,
      ...(tx.wallet
        ? {
            payer: tx.wallet,
            receipt: {
              status: "minted" as const,
              owner: tx.wallet,
              mintAddress: encodeBase58(randomBytes(receiptRand, 32)),
              mintedAt: tx.createdAt + Math.round(8_000 + receiptRand() * 20_000),
              note: null,
            },
          }
        : {}),
      recipient: DEMO_MERCHANT,
      mint: USDC_MINT_DEVNET,
      reference: encodeBase58(randomBytes(rand, 32)),
      tx,
    });
  }

  for (const seed of UNPAID) {
    const [days, hours, minutes] = seed.ago;
    const createdAt = now - days * DAY_MS - hours * HOUR_MS - minutes * MINUTE_MS;
    drafts.push({
      kind: seed.kind,
      client: seed.client,
      memo: memoAt(seed.memo, createdAt),
      amount: seed.sol ?? centsToAmount(seed.cents ?? 0),
      createdAt,
      expiresAt: createdAt + INVOICE_TTL_MS,
      recipient: DEMO_MERCHANT,
      mint: seed.sol ? null : USDC_MINT_DEVNET,
      reference: encodeBase58(randomBytes(rand, 32)),
    });
  }

  drafts.sort((a, b) => a.createdAt - b.createdAt);
  return drafts
    .map(({ tx, ...draft }, i) => {
      const id = `INV-${2001 + i}`;
      if (tx) tx.invoiceId = id;
      return {
        ...draft,
        id,
        paymentUrl: buildTransferRequest({
          recipient: draft.recipient,
          amount: draft.amount,
          splToken: draft.mint,
          reference: draft.reference,
          label: "SolAgent Pay",
          message: draft.memo,
          memo: id,
        }),
      };
    })
    .reverse();
}

const AGENT_SEEDS = [
  { name: "Sourcing Agent", purpose: "Buys supplier quotes and price feeds", daily: 25_000, perTx: 5_000, spent: 18_340, paused: false },
  { name: "Inbox Triage Agent", purpose: "Pays for translation and voice minutes", daily: 8_000, perTx: 1_000, spent: 2_215, paused: false },
  { name: "Market Data Agent", purpose: "Buys market data per request", daily: 50_000, perTx: 10_000, spent: 46_890, paused: false },
  { name: "Ad Buyer Agent", purpose: "Bids on sponsored placements", daily: 30_000, perTx: 7_500, spent: 0, paused: true },
] as const;

/** The merchant's own agents. Keys come from fixed seeds; PDAs are derived exactly as the program does. */
function generateAgents(now: number): AgentWallet[] {
  return AGENT_SEEDS.map((seed, i) => {
    const keySeed = new Uint8Array(32);
    keySeed[0] = 0x5a;
    keySeed[1] = i + 1;
    const agent = Keypair.fromSeed(keySeed).publicKey.toBase58();
    return {
      id: `agent-${i + 1}`,
      name: seed.name,
      purpose: seed.purpose,
      agent,
      owner: DEMO_MERCHANT,
      pda: findAgentWalletPda(DEMO_MERCHANT, agent),
      dailyCapCents: seed.daily,
      maxPerTxCents: seed.perTx,
      spentTodayCents: seed.spent,
      status: seed.paused ? "paused" : "active",
      // Provisioned over the last four weeks, the oldest first.
      createdAt: now - (28 - i * 6) * DAY_MS - 3 * HOUR_MS,
    };
  });
}

/** The demo shop's listings: what the Blinks and the PoS product grid show on sample data. */
const PRODUCT_SEEDS = [
  {
    id: "prod_DemoHoodie01",
    title: "Solana Hacker Hoodie",
    description: "Heavyweight cotton fleece, edition 001.",
    amount: "45",
    mint: USDC_MINT_DEVNET,
    daysAgo: 12,
  },
  {
    id: "prod_DemoColdBrew",
    title: "Validator Cold Brew",
    description: "Single-origin, 12 oz can. Keeps you in consensus.",
    amount: "4.5",
    mint: USDC_MINT_DEVNET,
    daysAgo: 9,
  },
  {
    id: "prod_DemoStickers",
    title: "Breakpoint Sticker Pack",
    description: "Six die-cut vinyl stickers.",
    amount: "0.05",
    mint: null,
    daysAgo: 4,
  },
  {
    id: "prod_DemoTote01",
    title: "Proof-of-History Tote",
    description: "Canvas tote, screen-printed in Lisbon.",
    amount: "18",
    mint: USDC_MINT_DEVNET,
    daysAgo: 2,
  },
] as const;

function generateProducts(now: number): Product[] {
  return PRODUCT_SEEDS.map(({ daysAgo, ...product }): Product => ({
    ...product,
    network: "devnet",
    merchant: DEMO_MERCHANT,
    image: null,
    createdAt: now - daysAgo * DAY_MS - 5 * HOUR_MS,
    archivedAt: null,
  }));
}

/** Everything the dashboard shows on sample data, as of one moment. */
export interface DemoData {
  /** The anchor: "now" for every figure. */
  now: number;
  /** UTC midnight of the anchor's day. */
  today: number;
  /** Daily totals before the itemized window, for longer ranges and period comparisons. */
  history: readonly DailySettlement[];
  ledger: readonly LedgerTx[];
  invoices: readonly Invoice[];
  agents: readonly AgentWallet[];
  products: readonly Product[];
  balanceCents: number;
}

let last: DemoData | null = null;

/**
 * The sample dataset as of `now` (unix ms): every itemized record falls between `now` minus LEDGER_DAYS days and
 * `now`. The same anchor always gives the same data, so pass the one the server rendered with.
 */
export function createDemoData(now: number): DemoData {
  // Every provider on the page asks for the same anchor: build it once.
  if (last?.now === now) return last;
  const today = now - (now % DAY_MS);
  const ledger = generateLedger(now, today);
  last = {
    now,
    today,
    history: generateHistory(today),
    ledger,
    // Links each paid ledger transaction to its invoice (tx.invoiceId).
    invoices: generateInvoices(ledger, now),
    agents: generateAgents(now),
    products: generateProducts(now),
    balanceCents: INITIAL_BALANCE_CENTS,
  };
  return last;
}

/** Next number for an id prefix, e.g. INV-2181. */
export function nextSequence(ids: readonly string[], prefix: string, base: number): number {
  const numbers = ids
    .filter((id) => id.startsWith(`${prefix}-`))
    .map((id) => Number(id.slice(prefix.length + 1)))
    .filter(Number.isFinite);
  return Math.max(base, ...numbers) + 1;
}
