"use client";

import { WalletReadyState, type WalletName } from "@solana/wallet-adapter-base";
import { useWallet } from "@solana/wallet-adapter-react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, CircleAlert, Copy, ExternalLink, LoaderCircle, LogOut, Wallet } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { useWalletError } from "@/components/providers/AppProviders";
import { useCopy } from "@/hooks/use-copy";
import { useDetectedWallets } from "@/hooks/use-detected-wallets";
import { useDismiss } from "@/hooks/use-dismiss";
import { cn } from "@/lib/cn";
import { truncateAddress } from "@/lib/format";
import { explorerAddressUrl } from "@/lib/network";
import { useNetwork } from "@/lib/settings";

interface WalletButtonProps {
  label?: string;
  /** Which edge of the button the menu lines up with. */
  align?: "start" | "end";
  /** Open the menu upward, e.g. near the bottom of the sidebar or inside a dialog. */
  side?: "bottom" | "top";
  fullWidth?: boolean;
  /** Hide the text below the `sm` breakpoint so the button fits a phone header. */
  collapseLabel?: boolean;
  /** Header height (32px) instead of the form-control height (36px). */
  compact?: boolean;
  className?: string;
}

/** Wallet Standard connect button: lists wallets installed in the browser, then shows the connected address. */
export function WalletButton({
  label = "Connect wallet",
  align = "end",
  side = "bottom",
  fullWidth = false,
  collapseLabel = false,
  compact = false,
  className,
}: WalletButtonProps) {
  const { wallet, publicKey, connected, connecting, select, disconnect } = useWallet();
  const network = useNetwork();
  const { error, clearError } = useWalletError();
  const [open, setOpen] = useState(false);
  const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false));
  const startedHere = useRef(false);
  const { copied, copy } = useCopy();

  const address = publicKey?.toBase58() ?? null;
  const detected = useDetectedWallets();

  // Reopen this menu if a connection started from it fails, so the reason is visible.
  useEffect(() => {
    if (error && startedHere.current) setOpen(true);
  }, [error]);

  useEffect(() => {
    if (connected) startedHere.current = false;
  }, [connected]);

  const choose = (name: WalletName) => {
    clearError();
    startedHere.current = true;
    select(name);
    setOpen(false);
  };

  const menuPosition = cn(
    "absolute z-50 w-72",
    side === "bottom" ? "top-full mt-2" : "bottom-full mb-2",
    align === "end" ? "right-0" : "left-0",
  );
  const labelClass = collapseLabel ? "hidden sm:inline" : undefined;
  const height = compact ? "h-8 text-xs" : "h-9 text-[13px]";

  return (
    <div ref={ref} className={cn("relative", fullWidth && "w-full", className)}>
      {connected && address ? (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`Wallet ${truncateAddress(address)}`}
          className={cn(
            "inline-flex items-center gap-2 rounded-lg border border-line bg-panel pl-1 pr-2 transition-colors hover:border-line-strong hover:bg-raised",
            height,
            fullWidth && "w-full",
          )}
        >
          <AddressAvatar address={address} compact={compact} />
          <span className={cn("font-mono text-ink", compact ? "text-[11px]" : "text-xs", labelClass)}>{truncateAddress(address)}</span>
          <ChevronDown className="ml-auto size-3.5 text-ink-3" aria-hidden />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          disabled={connecting}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={collapseLabel ? label : undefined}
          className={cn(
            "btn-ghost inline-flex items-center justify-center gap-2 rounded-lg px-3 font-medium disabled:cursor-wait disabled:opacity-70",
            height,
            fullWidth && "w-full",
          )}
        >
          {connecting ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> : <Wallet className="size-3.5" aria-hidden />}
          <span className={labelClass}>{connecting ? "Connecting…" : label}</span>
        </button>
      )}

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: side === "bottom" ? -4 : 4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: side === "bottom" ? -4 : 4, scale: 0.98 }}
            transition={{ duration: 0.14, ease: "easeOut" }}
            className={cn(menuPosition, "popover p-1")}
          >
            {connected && address ? (
              <>
                <div className="flex items-center gap-3 px-2.5 pb-2.5 pt-2">
                  {wallet && <img src={wallet.adapter.icon} alt="" className="size-7 rounded-md" />}
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">{wallet?.adapter.name ?? "Wallet"}</p>
                    <p className="text-xs text-ink-3">Connected to {network.label}</p>
                  </div>
                </div>
                <p className="mx-2 mb-1.5 break-all rounded-md border border-line bg-canvas px-2.5 py-2 font-mono text-[11px] leading-relaxed text-ink-2">
                  {address}
                </p>
                <MenuItem onClick={() => void copy(address)}>
                  {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
                  {copied ? "Address copied" : "Copy address"}
                </MenuItem>
                <a
                  role="menuitem"
                  href={explorerAddressUrl(address, network)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={menuItemClass}
                  onClick={() => setOpen(false)}
                >
                  <ExternalLink className="size-4" />
                  View on Solana Explorer
                </a>
                <div className="my-1 h-px bg-line" />
                <MenuItem
                  className="hover:text-danger"
                  onClick={() => {
                    setOpen(false);
                    void disconnect();
                  }}
                >
                  <LogOut className="size-4" />
                  Disconnect
                </MenuItem>
              </>
            ) : (
              <>
                <p className="eyebrow px-2.5 pb-1.5 pt-2">Choose a wallet</p>
                {detected.length > 0 ? (
                  detected.map((w) => (
                    <MenuItem key={w.adapter.name} onClick={() => choose(w.adapter.name)}>
                      <img src={w.adapter.icon} alt="" className="size-5 rounded" />
                      <span className="flex-1 text-left">{w.adapter.name}</span>
                      <span className="text-[11px] text-ink-3">
                        {w.readyState === WalletReadyState.Installed ? "Detected" : "Available"}
                      </span>
                    </MenuItem>
                  ))
                ) : (
                  <div className="px-2.5 pb-2.5 text-sm text-ink-2">
                    <p>No Solana wallet found in this browser.</p>
                    <p className="mt-1.5 text-xs text-ink-3">
                      Install{" "}
                      <a href="https://phantom.com" target="_blank" rel="noopener noreferrer" className="link">
                        Phantom
                      </a>{" "}
                      or{" "}
                      <a href="https://solflare.com" target="_blank" rel="noopener noreferrer" className="link">
                        Solflare
                      </a>
                      , then reload this page.
                    </p>
                  </div>
                )}
                {error && (
                  <p role="alert" className="mx-1 mb-1 mt-1.5 flex gap-2 rounded-md border border-danger-line bg-danger-bg px-2.5 py-2 text-xs text-danger">
                    <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
                    {error}
                  </p>
                )}
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const menuItemClass =
  "flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-[13px] text-ink-2 transition-colors hover:bg-raised hover:text-ink";

function MenuItem({ children, onClick, className }: { children: ReactNode; onClick: () => void; className?: string }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className={cn(menuItemClass, className)}>
      {children}
    </button>
  );
}

/** The address's first two characters on a flat tile: stable per wallet, no color. */
function AddressAvatar({ address, compact }: { address: string; compact: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center rounded-md border border-accent-line bg-accent-soft font-mono font-medium text-accent-ink",
        compact ? "size-6 text-[10px]" : "size-7 text-[11px]",
      )}
    >
      {address.slice(0, 2)}
    </span>
  );
}
