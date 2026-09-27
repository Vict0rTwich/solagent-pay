"use client";

import { AnimatePresence, motion } from "framer-motion";
import { CircleAlert, KeyRound, LoaderCircle, LogOut, ShieldCheck } from "lucide-react";
import { useState } from "react";

import { useDismiss } from "@/hooks/use-dismiss";
import { useMerchantSession } from "@/hooks/use-merchant-session";
import { useNow } from "@/hooks/use-now";
import { cn } from "@/lib/cn";
import { formatDateTime, formatDuration, truncateAddress } from "@/lib/format";

/**
 * Header control for the merchant session (Sign-In with Solana): which wallet is signed in and until when, with
 * "Sign out"; or "Sign in" when the connected wallet has no session. Hidden until a wallet is connected.
 */
export function SessionBadge() {
  const { status, session, error, canSignIn, signIn, signOut } = useMerchantSession();
  const now = useNow(30_000);
  const [open, setOpen] = useState(false);
  const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false));

  if (status === "disconnected" || status === "checking") return null;
  const signingIn = status === "signing-in";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={session ? `Signed in as ${truncateAddress(session.address)}` : signingIn ? "Signing in" : "Sign in"}
        className={cn(
          "inline-flex h-8 items-center gap-2 rounded-lg border bg-panel px-2.5 text-xs font-medium transition-colors hover:bg-raised",
          session ? "border-line text-ink" : error ? "border-warning-line text-ink" : "border-line text-ink-2",
        )}
      >
        {signingIn ? (
          <LoaderCircle className="size-3.5 animate-spin text-ink-3" aria-hidden />
        ) : session ? (
          <ShieldCheck className="size-3.5 text-success" aria-hidden />
        ) : (
          <KeyRound className={cn("size-3.5", error ? "text-warning" : "text-accent-ink")} aria-hidden />
        )}
        <span className="hidden sm:inline">{signingIn ? "Signing in…" : session ? "Signed in" : "Sign in"}</span>
        {session && (
          <span className="hidden font-mono text-[11px] font-normal text-ink-3 xl:inline" title="Session time left">
            {formatDuration(session.expiresAt - now)}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-label="Merchant session"
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.14, ease: "easeOut" }}
            className="popover absolute right-0 top-full z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] p-4 sm:w-80"
          >
            {session ? (
              <>
                <p className="flex items-center gap-2 text-sm font-medium text-ink">
                  <ShieldCheck className="size-4 text-success" aria-hidden />
                  Signed in as merchant
                </p>
                <p className="mt-3 break-all rounded-md bg-raised px-2.5 py-2 font-mono text-[11px] leading-relaxed text-ink-2">
                  {session.address}
                </p>
                <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                  <dt className="text-ink-3">Expires in</dt>
                  <dd className="text-ink-2">{formatDuration(session.expiresAt - now)}</dd>
                  <dt className="text-ink-3">Until</dt>
                  <dd className="text-ink-2">{formatDateTime(session.expiresAt)} UTC</dd>
                </dl>
                <p className="mt-3 text-xs leading-relaxed text-ink-3">
                  Creating and canceling invoices needs this session. Checkout pages and payment status stay public.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    void signOut();
                  }}
                  className="btn-ghost mt-4 inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs hover:text-danger"
                >
                  <LogOut className="size-3.5" aria-hidden />
                  Sign out
                </button>
              </>
            ) : (
              <>
                <p className="flex items-center gap-2 text-sm font-medium text-ink">
                  <KeyRound className="size-4 text-accent-ink" aria-hidden />
                  Sign in to manage invoices
                </p>
                <p className="mt-2 text-xs leading-relaxed text-ink-2">
                  {signingIn
                    ? "Approve the sign-in request in your wallet."
                    : "Your wallet signs a one-time message to prove it's yours. It doesn't send a transaction or cost a fee."}
                </p>
                {error && !signingIn && (
                  <p role="alert" className="mt-3 flex gap-2 rounded-md border border-danger-line bg-danger-bg px-2.5 py-2 text-xs text-danger">
                    <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
                    {error}
                  </p>
                )}
                {!canSignIn && (
                  <p className="mt-3 text-xs text-warning">This wallet can&rsquo;t sign messages. Connect one that can, like Phantom or Solflare.</p>
                )}
                <button
                  type="button"
                  disabled={signingIn || !canSignIn}
                  onClick={() => {
                    signIn().then(
                      () => setOpen(false),
                      () => {
                        // The reason shows above.
                      },
                    );
                  }}
                  className="btn-primary mt-4 inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {signingIn ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <KeyRound className="size-4" aria-hidden />}
                  {signingIn ? "Waiting for wallet…" : "Sign in with wallet"}
                </button>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
