"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { motion } from "framer-motion";
import { LogOut, Moon, Sun, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useTheme } from "@/hooks/use-theme";
import { cn } from "@/lib/cn";
import { truncateAddress } from "@/lib/format";

import { BrandMark } from "./BrandMark";
import { NAV, isActive } from "./nav";
import { NetworkStatus } from "./NetworkStatus";
import { WalletButton } from "./WalletButton";

interface SidebarProps {
  /** `drawer` is the mobile off-canvas version, with a close button and the network pill. */
  variant?: "desktop" | "drawer";
  onNavigate?: () => void;
  onClose?: () => void;
}

export function Sidebar({ variant = "desktop", onNavigate, onClose }: SidebarProps) {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center justify-between px-4">
        <BrandMark onNavigate={onNavigate} />
        {variant === "drawer" && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="grid size-8 place-items-center rounded-md text-ink-2 transition-colors hover:bg-raised hover:text-ink"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      <nav aria-label="Main" className="flex-1 overflow-y-auto px-2.5 py-4">
        <p className="eyebrow px-2.5 pb-2">Merchant console</p>
        <ul className="space-y-px">
          {NAV.map((item) => {
            const active = isActive(pathname, item.href);
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group relative flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] transition-colors",
                    active ? "font-medium text-ink" : "text-ink-2 hover:bg-raised hover:text-ink",
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId={`nav-active-${variant}`}
                      className="absolute inset-0 rounded-md border border-accent-line bg-accent-soft"
                      transition={{ type: "spring", stiffness: 600, damping: 50 }}
                    />
                  )}
                  <Icon
                    className={cn("relative size-4 shrink-0 transition-colors", active ? "text-accent-ink" : "text-accent-ink/60 group-hover:text-accent-ink")}
                    aria-hidden
                  />
                  <span className="relative truncate">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {variant === "drawer" && (
        <div className="px-3 pb-3">
          <NetworkStatus display="flex" className="w-full" />
        </div>
      )}

      <SidebarFooter />
    </div>
  );
}

function SidebarFooter() {
  const { wallet, publicKey, connected, connecting, disconnect } = useWallet();
  const { theme, toggleTheme } = useTheme();
  const address = publicKey?.toBase58();

  return (
    <div className="shrink-0 space-y-1.5 border-t border-line p-2.5">
      <div className="rounded-lg border border-line bg-panel p-2.5">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className={cn("size-1.5 shrink-0 rounded-full", connected ? "bg-success" : connecting ? "bg-warning" : "bg-ink-3")}
          />
          <span className="truncate text-xs text-ink-2">
            {connected ? `Connected · ${wallet?.adapter.name ?? "Wallet"}` : connecting ? "Connecting…" : "No wallet connected"}
          </span>
        </div>
        {connected && address ? (
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <p className="font-mono text-xs text-ink" title={address}>
              {truncateAddress(address, 5)}
            </p>
            <button
              type="button"
              onClick={() => void disconnect()}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-ink-3 transition-colors hover:bg-raised hover:text-danger"
            >
              <LogOut className="size-3.5" aria-hidden />
              Log out
            </button>
          </div>
        ) : (
          <WalletButton fullWidth align="start" side="top" className="mt-2" />
        )}
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={theme === "dark"}
        onClick={toggleTheme}
        className="flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-xs text-ink-2 transition-colors hover:bg-raised hover:text-ink"
      >
        {theme === "dark" ? <Moon className="size-3.5 text-accent-ink" aria-hidden /> : <Sun className="size-3.5 text-accent-ink" aria-hidden />}
        <span className="flex-1 text-left">Dark theme</span>
        <span aria-hidden className={cn("relative h-4 w-7 rounded-full transition-colors", theme === "dark" ? "bg-accent" : "bg-line-strong")}>
          <span
            className={cn(
              "absolute top-0.5 size-3 rounded-full transition-[left]",
              theme === "dark" ? "left-3.5 bg-accent-fg" : "left-0.5 bg-panel",
            )}
          />
        </span>
      </button>
    </div>
  );
}
