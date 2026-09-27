"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useNow } from "@/hooks/use-now";
import { SignInError, authApi, type MerchantSession } from "@/lib/auth-api";
import { InvoiceApiError, describeApiError } from "@/lib/invoice-api";
import { useSettings } from "@/lib/settings";

export type SessionStatus =
  /** No wallet connected. */
  | "disconnected"
  /** Asking the server whether this browser holds a session. */
  | "checking"
  | "signed-out"
  /** Waiting on the wallet's signature, or the server's check of it. */
  | "signing-in"
  | "signed-in";

interface MerchantSessionValue {
  status: SessionStatus;
  /** The session for the connected wallet; null for no session, or one for a different wallet. */
  session: MerchantSession | null;
  /** Why the last sign-in or sign-out failed. */
  error: string | null;
  /** The connected wallet can sign messages, which signing in needs. */
  canSignIn: boolean;
  /** Asks the wallet to sign a Sign-In with Solana message, and starts a session with it. */
  signIn: () => Promise<MerchantSession>;
  signOut: () => Promise<void>;
  /**
   * Runs a merchant-only request with a session: signs in first if there's none, and once more if the server
   * turned the session down (expired, or signed out elsewhere).
   */
  withSession: <T>(request: () => Promise<T>) => Promise<T>;
}

const MerchantSessionContext = createContext<MerchantSessionValue | null>(null);

function describeSignInFailure(error: unknown): string {
  if (error instanceof InvoiceApiError) return error.message;
  const message = error instanceof Error ? error.message || (error as { error?: Error }).error?.message || "" : "";
  if (/reject|denied|declin|cancel/i.test(message)) return "Sign-in was declined in the wallet.";
  if (error instanceof Error && error.name.startsWith("Wallet")) return message ? `Wallet error: ${message}` : "The wallet couldn't sign in.";
  return describeApiError(error);
}

/**
 * The merchant's server session (Sign-In with Solana) for the connected wallet. When a wallet connects and there's
 * no session for it, asks it to sign in once; after that, signing in waits for the merchant (the header, or an
 * action that needs it). Disconnecting or switching wallets ends the session.
 */
export function MerchantSessionProvider({ children }: { children: ReactNode }) {
  const { publicKey, connected, signIn: walletSignIn, signMessage } = useWallet();
  const [settings] = useSettings();
  const address = connected && publicKey ? publicKey.toBase58() : null;
  const now = useNow(30_000);

  // What the server said, for whichever wallet: the cookie belongs to the browser, not to a wallet.
  const [server, setServer] = useState<{ checked: boolean; session: MerchantSession | null }>({ checked: false, session: null });
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<Promise<MerchantSession> | null>(null);

  const session = server.session && server.session.address === address && server.session.expiresAt > now ? server.session : null;
  const canSignIn = Boolean(walletSignIn || signMessage);

  useEffect(() => {
    let cancelled = false;
    authApi.session().then(
      (current) => !cancelled && setServer({ checked: true, session: current }),
      () => !cancelled && setServer((s) => ({ ...s, checked: true })),
    );
    return () => {
      cancelled = true;
    };
  }, [address]);

  const signIn = useCallback((): Promise<MerchantSession> => {
    // One wallet prompt at a time, however many callers ask.
    if (pending.current) return pending.current;
    const run = (async () => {
      if (!address) throw new SignInError("Connect your wallet to sign in.");
      setSigning(true);
      setError(null);
      try {
        const { input, message } = await authApi.challenge(address);
        let signed: { signedMessage: Uint8Array; signature: Uint8Array };
        if (walletSignIn) {
          // The wallet's own sign-in screen, with its own domain check. It signs the same message.
          signed = await walletSignIn(input);
        } else if (signMessage) {
          const bytes = new TextEncoder().encode(message);
          signed = { signedMessage: bytes, signature: await signMessage(bytes) };
        } else {
          throw new SignInError("This wallet can't sign messages, so it can't sign in.");
        }
        const started = await authApi.verify(signed.signedMessage, signed.signature);
        setServer({ checked: true, session: started });
        return started;
      } catch (failure) {
        const reason = describeSignInFailure(failure);
        setError(reason);
        throw new SignInError(reason);
      } finally {
        setSigning(false);
        pending.current = null;
      }
    })();
    pending.current = run;
    return run;
  }, [address, walletSignIn, signMessage]);

  // Accounts that were already asked on this page, so a declined prompt isn't repeated on its own.
  const prompted = useRef(new Set<string>());

  const signOut = useCallback(async () => {
    if (address) prompted.current.add(address);
    setError(null);
    setServer({ checked: true, session: null });
    try {
      await authApi.signOut();
    } catch (failure) {
      setError(describeApiError(failure));
    }
  }, [address]);

  // Sign in when a wallet connects without a session, once per account. Only when live data is wanted:
  // the demo dashboard never talks to the payment server.
  useEffect(() => {
    if (!address || !server.checked || session || signing || !canSignIn || settings.dataSource !== "auto") return;
    if (prompted.current.has(address)) return;
    prompted.current.add(address);
    signIn().catch(() => {
      // Shown in the header, which offers to try again.
    });
  }, [address, server.checked, session, signing, canSignIn, settings.dataSource, signIn]);

  // Disconnecting, or switching to another account, ends the previous account's session.
  const previous = useRef<string | null>(null);
  useEffect(() => {
    const was = previous.current;
    previous.current = address;
    if (!was || was === address || server.session?.address !== was) return;
    setServer({ checked: true, session: null });
    authApi.signOut().catch(() => {
      // Best effort: the session still expires on its own.
    });
  }, [address, server.session]);

  const withSession = useCallback(
    async <T,>(request: () => Promise<T>): Promise<T> => {
      if (!session) await signIn();
      try {
        return await request();
      } catch (failure) {
        if (!(failure instanceof InvoiceApiError && failure.status === 401)) throw failure;
        setServer({ checked: true, session: null });
        await signIn();
        return request();
      }
    },
    [session, signIn],
  );

  const status: SessionStatus = !address
    ? "disconnected"
    : signing
      ? "signing-in"
      : session
        ? "signed-in"
        : server.checked
          ? "signed-out"
          : "checking";

  const value = useMemo<MerchantSessionValue>(
    () => ({ status, session, error, canSignIn, signIn, signOut, withSession }),
    [status, session, error, canSignIn, signIn, signOut, withSession],
  );

  return <MerchantSessionContext.Provider value={value}>{children}</MerchantSessionContext.Provider>;
}

export function useMerchantSession(): MerchantSessionValue {
  const context = useContext(MerchantSessionContext);
  if (!context) throw new Error("useMerchantSession must be used inside <MerchantSessionProvider>");
  return context;
}
