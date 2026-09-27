"use client";

import { ConnectionProvider } from "@solana/wallet-adapter-react";
import type { ReactNode } from "react";

import type { NetworkConfig } from "@/lib/network";
import { NetworkOverrideContext } from "@/lib/settings";

/**
 * Pins everything below it to one network, whatever this browser's Settings say: `useNetwork()` returns it
 * and `useConnection()` talks to its RPC. A checkout link carries its invoice's network, so a payer whose
 * Settings are on mainnet still pays a devnet invoice on devnet. The wallet connection itself is shared.
 */
export function NetworkScope({ network, children }: { network: NetworkConfig; children: ReactNode }) {
  return (
    <NetworkOverrideContext.Provider value={network}>
      <ConnectionProvider endpoint={network.endpoint} config={{ commitment: "confirmed" }}>
        {children}
      </ConnectionProvider>
    </NetworkOverrideContext.Provider>
  );
}
