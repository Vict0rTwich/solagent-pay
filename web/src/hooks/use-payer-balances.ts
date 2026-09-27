"use client";

import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useEffect, useState } from "react";

import { withTimeout } from "@/lib/live-data";
import { fetchPayerBalances, type PayerBalances } from "@/lib/wallet-payment";

export interface PayerBalanceState {
  balances: PayerBalances | null;
  loading: boolean;
  /** The lookup failed; the payment itself re-checks balances, so this only affects the display. */
  failed: boolean;
}

/** SOL and `mint` balances of `owner` on the current network. A new `refreshKey` reloads them. */
export function usePayerBalances(owner: string | null, mint: string | null, refreshKey: string | number): PayerBalanceState {
  const { connection } = useConnection();
  const key = owner ? `${connection.rpcEndpoint}|${owner}|${mint ?? "SOL"}|${refreshKey}` : null;
  const [result, setResult] = useState<{ key: string; balances: PayerBalances | null } | null>(null);

  useEffect(() => {
    if (!key || !owner) return;
    let cancelled = false;
    withTimeout(fetchPayerBalances(connection, new PublicKey(owner), mint ? new PublicKey(mint) : null)).then(
      (balances) => {
        if (!cancelled) setResult({ key, balances });
      },
      () => {
        if (!cancelled) setResult({ key, balances: null });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [connection, key, owner, mint]);

  const current = result?.key === key ? result : null;
  return { balances: current?.balances ?? null, loading: key !== null && current === null, failed: current !== null && current.balances === null };
}
