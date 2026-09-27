"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useLiveData, type InvoicePatch, type LiveStatus } from "@/hooks/use-live-data";
import { useMerchantSession } from "@/hooks/use-merchant-session";

import { findAgentWalletPda, newAgentKey } from "./agents";
import { randomBase58 } from "./base58";
import { currencyMint, type Currency } from "./currency";
import { DAY_MS, HISTORY_DAYS, INVOICE_TTL_MS, LEDGER_DAYS, createDemoData, nextSequence } from "./demo-data";
import { formatDayRange, formatMonth } from "./format";
import { describeApiError, invoiceApi, productApi, toClientInvoice } from "./invoice-api";
import {
  buildSeries,
  change,
  feesSavedCents,
  monthToDate,
  recentActivity,
  settledOn,
  splitRange,
  sumSeries,
  txToPayment,
  usdcCents,
  type Change,
} from "./metrics";
import { useNetwork, useSettings } from "./settings";
import { buildTransferRequest, createReference } from "./solana-pay";
import type { AgentWallet, DailySettlement, DataMode, Invoice, LedgerTx, Payment, Product, ProductInfo, RangeDays } from "./types";

export interface NewProduct extends ProductInfo {
  currency: Currency;
  /** In `currency`'s units, canonical (from parseAmount). */
  amount: string;
  /** The wallet its sales pay. */
  merchant: string;
}

export interface NewInvoice {
  kind: Invoice["kind"];
  currency: Currency;
  /** In `currency`'s units, canonical (from parseAmount). */
  amount: string;
  memo: string;
  client: string;
  recipient: string;
}

export interface NewAgent {
  name: string;
  purpose: string;
  dailyCapCents: number;
  maxPerTxCents: number;
  owner: string;
}

export type AgentPatch = Partial<Pick<AgentWallet, "status" | "dailyCapCents" | "maxPerTxCents">>;

/** Where the figures come from, and why. */
export interface DataSource {
  mode: DataMode;
  /** State of the live connection, whichever mode is showing. */
  liveStatus: LiveStatus;
  /** Why demo data is showing, or why the last live refresh failed. */
  reason: string | null;
  stale: boolean;
  /** Wallet the live data belongs to. */
  owner: string | null;
  fetchedAt: number | null;
  programDeployed: boolean;
  agentsError: string | null;
  refresh: () => void;
}

interface DashboardContextValue {
  source: DataSource;
  /** "Now" and today's UTC midnight for whichever data is showing (for demo data, the moment it was generated). */
  clock: { now: number; today: number };
  /** Demo data only: daily totals before the itemized ledger, for longer ranges and period comparisons. */
  history: readonly DailySettlement[];
  query: string;
  setQuery: (query: string) => void;
  rangeDays: RangeDays;
  setRangeDays: (range: RangeDays) => void;
  ledger: readonly LedgerTx[];
  invoices: readonly Invoice[];
  agents: readonly AgentWallet[];
  /** Overview feed: recent transactions and open invoices. */
  payments: readonly Payment[];
  balanceCents: number;
  pendingPayoutCents: number;
  /**
   * Live data: created by the payment server, which watches and settles it (signs the merchant in first if
   * needed). Demo data: created here.
   */
  createInvoice: (input: NewInvoice) => Promise<Invoice>;
  /** Demo data, and invoices the server doesn't track: records a payment outcome here. */
  updateInvoice: (invoice: Invoice, patch: InvoicePatch) => void;
  /** The merchant's products on sale: from the payment server on live data (once signed in), seeded on demo data. */
  products: readonly Product[];
  /** False until live products have loaded (they need a merchant session). */
  productsLoaded: boolean;
  /** Why live products didn't load, until they do. */
  productsError: string | null;
  /** Loads live products again, signing the merchant in first if the session has lapsed. */
  reloadProducts: () => Promise<void>;
  /** Live data: listed on the payment server (signs the merchant in first if needed). Demo data: created here. */
  createProduct: (input: NewProduct) => Promise<Product>;
  archiveProduct: (product: Product) => Promise<void>;
  /** An order of one of the products (a sale at the PoS): the price and title come from the product. */
  createProductOrder: (product: Product) => Promise<Invoice>;
  /** Mints the buyer's cNFT receipt for a paid invoice again (a failed or simulated one). */
  mintReceipt: (invoice: Invoice) => Promise<void>;
  /** Voids an open invoice (on the server for live ones) so nothing watches for its payment anymore. */
  cancelInvoice: (invoice: Invoice) => Promise<void>;
  /** Fetches the server's latest status for open live invoices now. */
  syncInvoices: () => void;
  /** Demo data only: live payments already settle straight into the connected wallet. */
  requestPayout: (input: { amountCents: number; destination: string }) => LedgerTx;
  /** Demo data only. */
  provisionAgent: (input: NewAgent) => AgentWallet;
  /** Demo data only. */
  updateAgent: (id: string, patch: AgentPatch) => void;
}

const DashboardContext = createContext<DashboardContextValue | null>(null);

/** Live data has no seeded totals: only what the chain returned. */
const NO_HISTORY: readonly DailySettlement[] = [];

function demoReason(liveStatus: LiveStatus, dataSource: "auto" | "demo", hasWallet: boolean, error: string | null): string {
  if (dataSource === "demo") return "Demo data is selected in Settings.";
  if (!hasWallet) return "Connect a wallet to load your live data.";
  if (liveStatus === "loading") return "Loading live data…";
  return error ? `Live data didn't load: ${error}` : "Live data isn't available.";
}

/**
 * `demoNow` anchors the sample data: the server reads it once per request, and the browser generates the same data
 * from it, so the page hydrates without a mismatch. It stays fixed while the dashboard is open.
 */
export function DashboardProvider({ children, demoNow }: { children: ReactNode; demoNow: number }) {
  const [settings] = useSettings();
  const network = useNetwork();
  const { withSession, status: sessionStatus } = useMerchantSession();
  const signedIn = sessionStatus === "signed-in";
  const live = useLiveData(settings.dataSource === "auto", signedIn);

  const [query, setQuery] = useState("");
  const [rangeDays, setRangeDays] = useState<RangeDays>(30);
  // The sample data as of `demoNow`, generated once when the dashboard mounts.
  const [demo] = useState(() => createDemoData(demoNow));
  const [demoLedger, setDemoLedger] = useState<readonly LedgerTx[]>(demo.ledger);
  const [demoInvoices, setDemoInvoices] = useState<readonly Invoice[]>(demo.invoices);
  const [demoAgents, setDemoAgents] = useState<readonly AgentWallet[]>(demo.agents);
  const [demoBalanceCents, setDemoBalanceCents] = useState(demo.balanceCents);
  const [demoProducts, setDemoProducts] = useState<readonly Product[]>(demo.products);
  // Live products, for the wallet and network they were loaded for (or why they didn't load).
  const [liveProducts, setLiveProducts] = useState<{ key: string; list: readonly Product[]; error?: string } | null>(null);
  const nextInvoice = useRef(nextSequence(demo.invoices.map((i) => i.id), "INV", 2000));
  const nextAgent = useRef(demo.agents.length + 1);

  const snapshot = live.status === "ready" ? live.snapshot : null;
  const mode: DataMode = snapshot ? "live" : "demo";

  const clock = useMemo(() => {
    if (!snapshot) return { now: demo.now, today: demo.today };
    return { now: snapshot.fetchedAt, today: snapshot.fetchedAt - (snapshot.fetchedAt % DAY_MS) };
  }, [snapshot, demo]);
  const history = snapshot ? NO_HISTORY : demo.history;

  const ledger = snapshot ? snapshot.ledger : demoLedger;
  const agents = snapshot ? snapshot.agents : demoAgents;
  const balanceCents = snapshot ? snapshot.balanceCents : demoBalanceCents;
  const liveInvoices = live.invoices;
  const invoices = mode === "live" ? liveInvoices : demoInvoices;
  const addLiveInvoice = live.addInvoice;
  const patchLiveInvoice = live.patchInvoice;

  const createInvoice = useCallback(
    async (input: NewInvoice): Promise<Invoice> => {
      if (mode === "live") {
        // The server numbers it, picks its reference key, token and expiry, and settles it once it's paid.
        const { invoice } = await withSession(() =>
          invoiceApi.create({
            network: network.id,
            recipient: input.recipient,
            currency: input.currency,
            amount: input.amount,
            memo: input.memo,
            kind: input.kind,
          }),
        );
        // The client name stays in this browser: it's for the merchant's records, not the server's.
        const local = toClientInvoice(invoice, { client: input.client });
        addLiveInvoice(local);
        return local;
      }

      const createdAt = Date.now();
      const id = `INV-${nextInvoice.current++}`;
      const reference = createReference();
      // The mint comes from the network the invoice is created on, never from the caller, so an invoice
      // can't ask for a mint that doesn't exist where it will be paid.
      const mint = currencyMint(input.currency, network);
      const invoice: Invoice = {
        id,
        kind: input.kind,
        client: input.client,
        memo: input.memo,
        amount: input.amount,
        createdAt,
        expiresAt: createdAt + INVOICE_TTL_MS,
        recipient: input.recipient,
        mint,
        reference,
        paymentUrl: buildTransferRequest({
          recipient: input.recipient,
          amount: input.amount,
          splToken: mint,
          reference,
          label: "SolAgent Pay",
          message: input.memo || undefined,
          memo: id,
        }),
      };
      setDemoInvoices((current) => [invoice, ...current]);
      return invoice;
    },
    [mode, addLiveInvoice, withSession, network],
  );

  const productsKey = live.owner ? `${network.id}:${live.owner}` : null;
  useEffect(() => {
    if (mode !== "live" || !signedIn || !productsKey) return;
    let cancelled = false;
    productApi.list(network.id).then(
      (list) => {
        if (!cancelled) setLiveProducts({ key: productsKey, list });
      },
      (error: unknown) => {
        if (!cancelled) setLiveProducts({ key: productsKey, list: [], error: describeApiError(error) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [mode, signedIn, productsKey, network.id]);

  const reloadProducts = useCallback(async () => {
    if (!productsKey) return;
    try {
      // With the session: a lapsed one is renewed (the wallet asks), since the merchant asked for this.
      const list = await withSession(() => productApi.list(network.id));
      setLiveProducts({ key: productsKey, list });
    } catch (error) {
      setLiveProducts({ key: productsKey, list: [], error: describeApiError(error) });
    }
  }, [productsKey, withSession, network.id]);

  const liveCurrent = liveProducts && liveProducts.key === productsKey ? liveProducts : null;
  const productsLoaded = mode === "demo" || (liveCurrent !== null && liveCurrent.error === undefined);
  const productsError = mode === "live" ? (liveCurrent?.error ?? null) : null;
  const products = useMemo(() => (mode === "live" ? (liveCurrent?.list ?? []) : demoProducts), [mode, liveCurrent, demoProducts]);

  const createProduct = useCallback(
    async (input: NewProduct): Promise<Product> => {
      const info = { title: input.title, description: input.description, image: input.image };
      if (mode === "live") {
        const { product } = await withSession(() =>
          productApi.create({ network: network.id, merchant: input.merchant, ...info, currency: input.currency, amount: input.amount }),
        );
        const key = `${network.id}:${input.merchant}`;
        setLiveProducts((current) => ({ key, list: [product, ...(current?.key === key ? current.list : [])] }));
        return product;
      }
      const product: Product = {
        id: `prod_${randomBase58(9)}`,
        network: network.id,
        merchant: input.merchant,
        ...info,
        amount: input.amount,
        mint: currencyMint(input.currency, network),
        createdAt: Date.now(),
        archivedAt: null,
      };
      setDemoProducts((current) => [product, ...current]);
      return product;
    },
    [mode, withSession, network],
  );

  const archiveProduct = useCallback(
    async (product: Product) => {
      const drop = (list: readonly Product[]) => list.filter((p) => p.id !== product.id);
      if (mode === "live") {
        await withSession(() => productApi.archive(product.id));
        setLiveProducts((current) => (current ? { ...current, list: drop(current.list) } : current));
        return;
      }
      setDemoProducts(drop);
    },
    [mode, withSession],
  );

  const createProductOrder = useCallback(
    async (product: Product): Promise<Invoice> => {
      if (mode === "live") {
        const { invoice } = await withSession(() => invoiceApi.create({ network: product.network, recipient: product.merchant, productId: product.id }));
        const local = toClientInvoice(invoice, { client: "" });
        addLiveInvoice(local);
        return local;
      }
      const createdAt = Date.now();
      const id = `INV-${nextInvoice.current++}`;
      const reference = createReference();
      const invoice: Invoice = {
        id,
        kind: "link",
        client: "",
        memo: product.title,
        amount: product.amount,
        createdAt,
        expiresAt: createdAt + INVOICE_TTL_MS,
        recipient: product.merchant,
        mint: product.mint,
        reference,
        productId: product.id,
        product: { title: product.title, description: product.description, image: product.image },
        paymentUrl: buildTransferRequest({
          recipient: product.merchant,
          amount: product.amount,
          splToken: product.mint,
          reference,
          label: "SolAgent Pay",
          message: product.title,
          memo: id,
        }),
      };
      setDemoInvoices((current) => [invoice, ...current]);
      return invoice;
    },
    [mode, withSession, addLiveInvoice],
  );

  // Found by reference wherever the invoice is kept; each store ignores invoices it doesn't hold.
  const updateInvoice = useCallback(
    (invoice: Invoice, patch: InvoicePatch) => {
      setDemoInvoices((current) =>
        current.some((inv) => inv.reference === invoice.reference)
          ? current.map((inv) => (inv.reference === invoice.reference ? { ...inv, ...patch } : inv))
          : current,
      );
      patchLiveInvoice(invoice, patch);
    },
    [patchLiveInvoice],
  );

  const cancelInvoice = useCallback(
    async (invoice: Invoice) => {
      if (invoice.tracked) {
        // Canceled on the server first (it stops watching); throws if it can't be, e.g. it was just paid.
        const canceled = await withSession(() => invoiceApi.cancel(invoice.reference));
        patchLiveInvoice(invoice, { canceledAt: canceled.canceledAt ?? Date.now() });
        return;
      }
      updateInvoice(invoice, { canceledAt: Date.now() });
    },
    [patchLiveInvoice, updateInvoice, withSession],
  );
  const syncInvoices = live.syncInvoices;

  const mintReceipt = useCallback(
    async (invoice: Invoice) => {
      if (invoice.tracked) {
        const server = await withSession(() => invoiceApi.mintReceipt(invoice.reference));
        if (server.receipt) patchLiveInvoice(invoice, { receipt: server.receipt });
        syncInvoices();
        return;
      }
      // Sample data and untracked links: there's no server record to mint from.
      const owner = invoice.receipt?.owner ?? invoice.payer;
      if (owner) {
        updateInvoice(invoice, {
          receipt: { status: "simulated", owner, mintAddress: null, mintedAt: Date.now(), note: "Sample data: no cNFT was minted." },
        });
      }
    },
    [withSession, patchLiveInvoice, syncInvoices, updateInvoice],
  );

  const requestPayout = useCallback(({ amountCents, destination }: { amountCents: number; destination: string }) => {
    const tx: LedgerTx = {
      signature: null,
      createdAt: Date.now(),
      senderName: "Payout to your wallet",
      wallet: destination,
      type: "payout",
      amountCents: -amountCents,
      status: "pending",
      memo: "Withdrawal",
    };
    setDemoBalanceCents((current) => current - amountCents);
    setDemoLedger((current) => [tx, ...current]);
    return tx;
  }, []);

  const provisionAgent = useCallback((input: NewAgent): AgentWallet => {
    const agent = newAgentKey();
    const wallet: AgentWallet = {
      id: `agent-${nextAgent.current++}`,
      name: input.name,
      purpose: input.purpose,
      agent,
      owner: input.owner,
      pda: findAgentWalletPda(input.owner, agent),
      dailyCapCents: input.dailyCapCents,
      maxPerTxCents: input.maxPerTxCents,
      spentTodayCents: 0,
      status: "active",
      createdAt: Date.now(),
    };
    setDemoAgents((current) => [...current, wallet]);
    return wallet;
  }, []);

  const updateAgent = useCallback((id: string, patch: AgentPatch) => {
    setDemoAgents((current) => current.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  }, []);

  // Live ledgers are short (latest transfers), so the overview lists all of it rather than just today.
  const payments = useMemo(
    () => recentActivity(ledger, invoices, mode === "live" ? 0 : clock.today, clock.now),
    [ledger, invoices, mode, clock],
  );

  const pendingPayoutCents = useMemo(
    () =>
      ledger.filter((tx) => tx.type === "payout" && tx.status === "pending").reduce((sum, tx) => sum - tx.amountCents, 0),
    [ledger],
  );

  const source = useMemo<DataSource>(
    () => ({
      mode,
      liveStatus: live.status,
      reason:
        mode === "live"
          ? live.stale
            ? `Couldn't refresh: ${live.reason ?? "unknown error"}`
            : null
          : demoReason(live.status, settings.dataSource, live.owner !== null, live.reason),
      stale: live.stale,
      owner: live.owner,
      fetchedAt: snapshot?.fetchedAt ?? null,
      programDeployed: snapshot?.programDeployed ?? false,
      agentsError: snapshot?.agentsError ?? null,
      refresh: live.refresh,
    }),
    [mode, live.status, live.stale, live.reason, live.owner, live.refresh, snapshot, settings.dataSource],
  );

  const value = useMemo<DashboardContextValue>(
    () => ({
      source,
      clock,
      history,
      query,
      setQuery,
      rangeDays,
      setRangeDays,
      ledger,
      invoices,
      agents,
      payments,
      balanceCents,
      pendingPayoutCents,
      createInvoice,
      updateInvoice,
      products,
      productsLoaded,
      productsError,
      reloadProducts,
      createProduct,
      archiveProduct,
      createProductOrder,
      mintReceipt,
      cancelInvoice,
      syncInvoices,
      requestPayout,
      provisionAgent,
      updateAgent,
    }),
    [
      source,
      clock,
      history,
      query,
      rangeDays,
      ledger,
      invoices,
      agents,
      payments,
      balanceCents,
      pendingPayoutCents,
      createInvoice,
      updateInvoice,
      products,
      productsLoaded,
      productsError,
      reloadProducts,
      createProduct,
      archiveProduct,
      createProductOrder,
      mintReceipt,
      cancelInvoice,
      syncInvoices,
      requestPayout,
      provisionAgent,
      updateAgent,
    ],
  );

  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>;
}

export function useDashboard(): DashboardContextValue {
  const context = useContext(DashboardContext);
  if (!context) throw new Error("useDashboard must be used inside <DashboardProvider>");
  return context;
}

export interface DashboardMetrics {
  now: number;
  today: number;
  series: DailySettlement[];
  range: { days: DailySettlement[]; volumeCents: number; count: number; change: Change };
  todaySettled: Payment[];
  todayVolumeCents: number;
  month: { name: string; volumeCents: number; change: Change };
  averageInvoice: { cents: number; change: Change };
  feesSaved: { cents: number };
}

/** Every overview figure, derived from the same ledger and date range so they always agree. */
export function useDashboardMetrics(): DashboardMetrics {
  const { ledger, history, rangeDays, clock, source } = useDashboard();
  const { now, today } = clock;
  const live = source.mode === "live";

  return useMemo(() => {
    // Demo data has seeded daily totals behind the itemized ledger; live data is only what the chain returned.
    const series = live ? buildSeries([], ledger, today, HISTORY_DAYS) : buildSeries(history, ledger, today, LEDGER_DAYS);
    const { current, previous } = splitRange(series, rangeDays);
    const rangeTotals = sumSeries(current);
    const previousTotals = sumSeries(previous);
    const priorLabel = `vs prior ${rangeDays} days`;

    const mtd = monthToDate(series, today);
    const monthTotals = sumSeries(mtd.current);
    const previousMonthTotals = sumSeries(mtd.previous);

    const average = rangeTotals.count ? Math.round(rangeTotals.volumeCents / rangeTotals.count) : 0;
    const previousAverage = previousTotals.count ? previousTotals.volumeCents / previousTotals.count : 0;

    const todaySettled = settledOn(ledger, today).map(txToPayment);

    return {
      now,
      today,
      series,
      range: {
        days: current,
        volumeCents: rangeTotals.volumeCents,
        count: rangeTotals.count,
        change: { ratio: change(rangeTotals.volumeCents, previousTotals.volumeCents), against: priorLabel },
      },
      todaySettled,
      todayVolumeCents: todaySettled.reduce((sum, p) => sum + usdcCents(p.amount), 0),
      month: {
        name: formatMonth(today),
        volumeCents: monthTotals.volumeCents,
        change: {
          ratio: change(monthTotals.volumeCents, previousMonthTotals.volumeCents),
          against: `vs ${formatDayRange(mtd.previousStart, mtd.previousEnd)}`,
        },
      },
      averageInvoice: { cents: average, change: { ratio: change(average, previousAverage), against: priorLabel } },
      feesSaved: { cents: feesSavedCents(rangeTotals.volumeCents, rangeTotals.count) },
    };
  }, [ledger, history, rangeDays, now, today, live]);
}
