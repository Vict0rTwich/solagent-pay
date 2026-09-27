"use client";

import { WalletReadyState } from "@solana/wallet-adapter-base";
import { useWallet, type Wallet } from "@solana/wallet-adapter-react";
import { useMemo } from "react";

/** Wallets this browser can connect to right now: installed extensions and Wallet Standard wallets. */
export function useDetectedWallets(): Wallet[] {
  const { wallets } = useWallet();
  return useMemo(
    () => wallets.filter((w) => w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable),
    [wallets],
  );
}
