"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useCallback, useEffect, useRef, useState } from "react";

import { invoiceApi, toClientInvoice, type PublicInvoice } from "@/lib/invoice-api";
import { loadInvoices, saveInvoices } from "@/lib/live-invoices";
import {
  describeError,
  fetchLedger,
  fetchUsdcBalanceCents,
  readOnlyClient,
  toAgentWallet,
  withTimeout,
} from "@/lib/live-data";
import { useNetwork } from "@/lib/settings";
import type { AgentWallet, Invoice, LedgerTx } from "@/lib/types";

export type InvoicePatch = Partial<Pick<Invoice, "paidAt" | "signature" | "canceledAt" | "issue" | "payer" | "receipt">>;

const REFRESH_MS = 30_000;
/** Our own server, not the RPC: cheap to ask often, so a payment shows within seconds. */
const SERVER_SYNC_MS = 3_000;
/** Blink orders arrive from buyers' wallets, not this browser: how often to ask the server for new ones. */
const ORDERS_SYNC_MS = 10_000;
const SYNC_AFTER_EXPIRY_MS = 15 * 60_000;

/** Whether the server's copy says anything new about how the invoice settled, or about its receipt. */
function sameSettlement(a: Invoice, b: Invoice): boolean {
  return (
    a.paidAt === b.paidAt &&
    a.signature === b.signature &&
    a.canceledAt === b.canceledAt &&
    a.expiresAt === b.expiresAt &&
    a.issue?.signature === b.issue?.signature &&
    a.payer === b.payer &&
    a.receipt?.status === b.receipt?.status &&
    a.receipt?.mintAddress === b.receipt?.mintAddress
  );
}

/**
 * Server copies merged into the local list: known invoices updated, and with `addNew`, paid orders this browser
 * didn't create (Blink sales) added, newest first. Unpaid ones aren't: every buyer who opens a Blink's checkout and
 * walks away leaves an order that expires, and those would only bury the sales.
 */
function mergeServerInvoices(list: Invoice[], updates: readonly PublicInvoice[], addNew: boolean): Invoice[] {
  let changed = false;
  const next = list.map((inv) => {
    const server = updates.find((update) => update.reference === inv.reference);
    if (!server) return inv;
    const merged = toClientInvoice(server, inv);
    if (sameSettlement(inv, merged)) return inv;
    changed = true;
    return merged;
  });
  if (addNew) {
    const known = new Set(list.map((inv) => inv.reference));
    for (const server of updates) {
      if (known.has(server.reference) || server.status !== "paid") continue;
      // Nothing local to keep: a buyer's wallet opened this order, so there's no client name for it.
      next.push(toClientInvoice(server, { client: "" }));
      changed = true;
    }
    next.sort((a, b) => b.createdAt - a.createdAt);
  }
  return changed ? next : list;
}

export interface LiveSnapshot {
  balanceCents: number;
  ledger: LedgerTx[];
  agents: AgentWallet[];
  /** Set when the agent lookup failed but balance and ledger loaded. */
  agentsError: string | null;
  programDeployed: boolean;
  fetchedAt: number;
}

export type LiveStatus = "off" | "loading" | "ready" | "error";

export interface LiveData {
  status: LiveStatus;
  /** Why live data isn't showing, or why the last refresh failed. */
  reason: string | null;
  /** True when the last refresh failed and `snapshot` is from an earlier one. */
  stale: boolean;
  snapshot: LiveSnapshot | null;
  owner: string | null;
  invoices: readonly Invoice[];
  addInvoice: (invoice: Invoice) => void;
  /** Updates a stored invoice, found by its reference. No-op for invoices that aren't stored here. */
  patchInvoice: (invoice: Invoice, patch: InvoicePatch) => void;
  /** Asks the payment server for the latest status of open invoices now, instead of at the next round. */
  syncInvoices: () => void;
  refresh: () => void;
}

/**
 * Live chain data for the connected wallet on the selected network. Off when `enabled` is false or no
 * wallet is connected; "error" when the first load fails, so callers can fall back to demo data. With a merchant
 * session (`signedIn`), product orders opened through Blinks are pulled in from the payment server too.
 */
export function useLiveData(enabled: boolean, signedIn: boolean): LiveData {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const network = useNetwork();
  const owner = publicKey?.toBase58() ?? null;

  const [state, setState] = useState<{ status: LiveStatus; reason: string | null; stale: boolean; snapshot: LiveSnapshot | null }>({
    status: "off",
    reason: null,
    stale: false,
    snapshot: null,
  });
  const [refreshCount, setRefreshCount] = useState(0);
  const refresh = useCallback(() => setRefreshCount((n) => n + 1), []);

  // Invoices are stored per network and wallet.
  const storageKey = owner ? `${network.id}:${owner}` : null;
  const [invoiceState, setInvoiceState] = useState<{ key: string | null; list: Invoice[] }>({ key: null, list: [] });
  const invoicesRef = useRef<readonly Invoice[]>([]);
  const ledgerCache = useRef(new Map<string, LedgerTx | null>());

  useEffect(() => {
    setInvoiceState({ key: storageKey, list: storageKey ? loadInvoices(storageKey) : [] });
    ledgerCache.current = new Map();
  }, [storageKey]);

  useEffect(() => {
    invoicesRef.current = invoiceState.list;
  }, [invoiceState.list]);

  const updateInvoices = useCallback((change: (list: Invoice[]) => Invoice[]) => {
    setInvoiceState((current) => {
      if (!current.key) return current;
      const list = change(current.list);
      if (list === current.list) return current;
      saveInvoices(current.key, list);
      return { ...current, list };
    });
  }, []);

  const addInvoice = useCallback((invoice: Invoice) => updateInvoices((list) => [invoice, ...list]), [updateInvoices]);

  const patchInvoice = useCallback(
    (invoice: Invoice, patch: InvoicePatch) => {
      const apply = (list: Invoice[]) => list.map((inv) => (inv.reference === invoice.reference ? { ...inv, ...patch } : inv));
      // Invoices are stored under the wallet they pay. Usually that's the connected one; it isn't when the
      // merchant switched accounts in their wallet to pay their own invoice.
      const key = `${network.id}:${invoice.recipient}`;
      if (key === storageKey) {
        updateInvoices(apply);
        return;
      }
      const stored = loadInvoices(key);
      if (stored.some((inv) => inv.reference === invoice.reference)) saveInvoices(key, apply(stored));
    },
    [network.id, storageKey, updateInvoices],
  );

  // Balance, ledger and agent wallets: on connect, every 30 s while visible, and on refresh().
  useEffect(() => {
    if (!enabled || !owner) {
      setState({ status: "off", reason: null, stale: false, snapshot: null });
      return;
    }
    let cancelled = false;
    const ownerKey = new PublicKey(owner);
    const mint = new PublicKey(network.usdcMint);

    const load = async () => {
      setState((s) => (s.snapshot ? s : { ...s, status: "loading", reason: null }));
      try {
        const client = readOnlyClient(connection, ownerKey);
        const [balanceCents, ledger, agentResult] = await withTimeout(
          Promise.all([
            fetchUsdcBalanceCents(connection, ownerKey, mint),
            fetchLedger(connection, ownerKey, mint, ledgerCache.current, invoicesRef.current),
            // Agent lookup failing (e.g. an RPC without getProgramAccounts) shouldn't hide the rest.
            Promise.all([client.isDeployed(), client.listAgentWallets(ownerKey)]).then(
              ([deployed, wallets]) => ({ deployed, agents: wallets.map(toAgentWallet), error: null }),
              (error: unknown) => ({ deployed: false, agents: [] as AgentWallet[], error: describeError(error) }),
            ),
          ]),
        );
        if (cancelled) return;
        setState({
          status: "ready",
          reason: null,
          stale: false,
          snapshot: {
            balanceCents,
            ledger,
            agents: agentResult.agents,
            agentsError: agentResult.error,
            programDeployed: agentResult.deployed,
            fetchedAt: Date.now(),
          },
        });
      } catch (error) {
        if (cancelled) return;
        // Keep showing earlier live data after a failed refresh; only fall back when nothing loaded yet.
        setState((s) =>
          s.snapshot
            ? { ...s, stale: true, reason: describeError(error) }
            : { status: "error", reason: describeError(error), stale: false, snapshot: null },
        );
      }
    };

    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [enabled, owner, connection, network.usdcMint, refreshCount]);

  // Live invoices are settled by the payment server (app/api/invoices), never by this browser; this keeps the
  // local copies in step with it. Only invoices the server tracks, and only while they can still change: a
  // payment that landed just before the deadline is settled a little after it, and a paid order's receipt is
  // minted after that.
  const syncReferences = invoiceState.list
    .filter(
      (inv) =>
        inv.tracked &&
        ((inv.paidAt === undefined && inv.canceledAt === undefined && inv.expiresAt > Date.now() - SYNC_AFTER_EXPIRY_MS) ||
          inv.receipt?.status === "pending"),
    )
    .map((inv) => inv.reference)
    .join(",");
  const [syncRequests, setSyncRequests] = useState(0);
  const syncInvoices = useCallback(() => setSyncRequests((n) => n + 1), []);

  useEffect(() => {
    if (!enabled || !owner || !syncReferences) return;
    let cancelled = false;

    const sync = async () => {
      try {
        const updates = await invoiceApi.list(syncReferences.split(","));
        if (cancelled || updates.length === 0) return;
        const newlyPaid = updates.some(
          (server) => server.paidAt !== null && invoicesRef.current.find((inv) => inv.reference === server.reference)?.paidAt === undefined,
        );
        updateInvoices((list) => mergeServerInvoices(list, updates, false));
        // A payment moves the balance and the ledger too.
        if (newlyPaid) refresh();
      } catch {
        // Payment server unreachable: the next round tries again.
      }
    };

    void sync();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void sync();
    }, SERVER_SYNC_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [enabled, owner, syncReferences, syncRequests, updateInvoices, refresh]);

  // Orders opened through a product's Blink: the merchant's own browser never saw them being created.
  useEffect(() => {
    if (!enabled || !owner || !signedIn) return;
    let cancelled = false;

    const load = async () => {
      try {
        const orders = await invoiceApi.orders(network.id);
        if (cancelled || orders.length === 0) return;
        const newlyPaid = orders.some(
          (server) => server.paidAt !== null && invoicesRef.current.find((inv) => inv.reference === server.reference)?.paidAt === undefined,
        );
        updateInvoices((list) => mergeServerInvoices(list, orders, true));
        if (newlyPaid) refresh();
      } catch {
        // Session ended or server unreachable: the next round tries again.
      }
    };

    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, ORDERS_SYNC_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [enabled, owner, signedIn, network.id, updateInvoices, refresh]);

  return {
    ...state,
    owner,
    invoices: invoiceState.key === storageKey ? invoiceState.list : [],
    addInvoice,
    patchInvoice,
    syncInvoices,
    refresh,
  };
}
