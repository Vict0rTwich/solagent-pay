"use client";

import type { Adapter, WalletError } from "@solana/wallet-adapter-base";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { MotionConfig } from "framer-motion";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import { useNetwork } from "@/lib/settings";

interface WalletErrorState {
  error: string | null;
  clearError: () => void;
}

const WalletErrorContext = createContext<WalletErrorState>({ error: null, clearError: () => {} });

/** The last wallet connection error, in words a merchant can act on. */
export function useWalletError(): WalletErrorState {
  return useContext(WalletErrorContext);
}

const SIGNING_ERRORS = new Set(["WalletSignTransactionError", "WalletSendTransactionError", "WalletSignMessageError", "WalletSignInError"]);

function describeWalletError(error: WalletError): string {
  const message = error.message || error.error?.message || "";
  if (/reject|denied|cancel/i.test(message)) return "Connection request was declined in the wallet.";
  if (error.name === "WalletNotReadyError") return "That wallet isn't available in this browser.";
  return message ? `Wallet error: ${message}` : "Couldn't connect to the wallet. Try again.";
}

export function AppProviders({ children }: { children: ReactNode }) {
  const network = useNetwork();
  const [error, setError] = useState<string | null>(null);
  // Empty list: Wallet Standard wallets (Phantom, Solflare, Backpack, …) register themselves.
  const wallets = useMemo<Adapter[]>(() => [], []);

  const onError = useCallback((walletError: WalletError) => {
    // Signing and sending errors are shown by whatever asked for the signature (e.g. "Pay with wallet");
    // this state is for connecting, where "declined" means the connection request.
    if (SIGNING_ERRORS.has(walletError.name)) return;
    setError(describeWalletError(walletError));
  }, []);
  const clearError = useCallback(() => setError(null), []);
  const errorState = useMemo(() => ({ error, clearError }), [error, clearError]);

  return (
    // Switching networks in Settings swaps the endpoint, which gives every hook a fresh Connection.
    <ConnectionProvider endpoint={network.endpoint} config={{ commitment: "confirmed" }}>
      <WalletProvider wallets={wallets} autoConnect onError={onError}>
        <WalletErrorContext.Provider value={errorState}>
          <MotionConfig reducedMotion="user">{children}</MotionConfig>
        </WalletErrorContext.Provider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
