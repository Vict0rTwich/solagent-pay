import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { MerchantSession, SignInChallenge, SignInInput } from "@/lib/auth-api";
import { encodeBase58 } from "@/lib/base58";

import { serverConfig, warnOnce } from "../config";
import { ServerConfigError, error } from "../http";
import { publicOrigin as appOrigin } from "../origin";
import type { AuthStore } from "../store";

import { signInMessage } from "./siws";
import { signToken, verifyToken } from "./tokens";

// Merchant sessions. Signing in is two requests:
//
// 1. POST /api/auth/nonce issues a sign-in request (fresh nonce, 10 minutes) and pins it to this browser in a
//    signed, HTTP-only cookie. Nothing is stored server-side, so asking costs the server nothing.
// 2. POST /api/auth/verify checks the wallet's signature of exactly that request, spends the nonce in the store
//    (once, across every instance), and swaps the request cookie for a session cookie: a signed token naming the
//    wallet, HTTP-only and SameSite=Strict, so page scripts can't read it and other sites can't send it.
//
// Signing out revokes the session's id in the store, so the token is dead even if a copy survived somewhere.

const CHALLENGE_AUDIENCE = "solagent-pay/siws-request";
const SESSION_AUDIENCE = "solagent-pay/merchant-session";
const CHALLENGE_COOKIE = "solagent_siws";
const SESSION_COOKIE = "solagent_session";

/** How long the wallet has to sign a sign-in request. */
const CHALLENGE_TTL_MS = 10 * 60_000;
/** Spent nonces are remembered a little past their request's expiry, to cover clock skew between instances. */
const NONCE_RETENTION_MS = 5 * 60_000;
const STATEMENT = "Sign in to the SolAgent Pay merchant dashboard. This proves you own this wallet. It doesn't send a transaction or cost a fee.";

export interface VerifiedSession extends MerchantSession {
  /** Server-side only: never sent to the browser. */
  sessionId: string;
}

const seconds = (ms: number) => Math.floor(ms / 1000);

const LOCAL_SECRET = Symbol.for("solagent-pay.local-session-secret");
/** Where the generated key is kept, in the data directory. */
export const LOCAL_SECRET_FILE = "session-secret";

/** A saved key: 32 random bytes, base64url. Null when there's none, or it isn't one. */
function readSavedKey(file: string): Buffer | null {
  try {
    const saved = readFileSync(file, "utf8").trim();
    return /^[A-Za-z0-9_-]{43}$/.test(saved) ? Buffer.from(saved, "base64url") : null;
  } catch {
    return null;
  }
}

/**
 * The key sessions are signed with when SOLAGENT_SESSION_SECRET isn't set. Random, never a fixed value anyone could
 * know: generated once and kept in the data directory (beside the file store, readable by this user only), so
 * sign-ins survive a restart; for this process only if it can't be kept there (a read-only disk). Kept on
 * globalThis, like the runtime, so every route bundle signs with the same one.
 */
function localSecret(): Buffer {
  const holder = globalThis as typeof globalThis & { [LOCAL_SECRET]?: Buffer };
  if (holder[LOCAL_SECRET]) return holder[LOCAL_SECRET];

  const file = path.join(serverConfig.dataDir, LOCAL_SECRET_FILE);
  let key = readSavedKey(file);
  if (!key) {
    const fresh = randomBytes(32);
    try {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, fresh.toString("base64url"), { mode: 0o600 });
      // Read back: if another process wrote at the same moment, both then use the same key.
      key = readSavedKey(file) ?? fresh;
    } catch {
      key = fresh;
      warnOnce("session-secret", "SOLAGENT_SESSION_SECRET isn't set and the data directory can't be written: using a key for this process, so sign-ins end when it restarts.");
    }
  }
  warnOnce(
    "session-secret",
    `SOLAGENT_SESSION_SECRET isn't set: signing sessions with a random key kept in ${file}.${
      serverConfig.store === "postgres" ? " Set SOLAGENT_SESSION_SECRET, the same on every instance, or sessions only work on the instance that started them." : ""
    }`,
  );
  holder[LOCAL_SECRET] = key;
  return key;
}

function secret(): Buffer {
  const configured = serverConfig.sessionSecret;
  if (!configured) return localSecret();
  if (configured.length < 32) {
    // Set, but too weak to sign with: said plainly rather than quietly replaced, since it was set on purpose.
    throw new ServerConfigError(
      "SOLAGENT_SESSION_SECRET must be at least 32 characters. Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64url'))\"",
    );
  }
  return Buffer.from(configured, "utf8");
}

/** Secure cookies, with the __Host- prefix (no Domain, so subdomains can't plant one), except over local http. */
function cookieName(base: string, request: Request): { name: string; secure: boolean } {
  const secure = appOrigin(request).protocol === "https:";
  return { name: secure ? `__Host-${base}` : base, secure };
}

function setCookie(base: string, request: Request, value: string, maxAgeMs: number): string {
  const { name, secure } = cookieName(base, request);
  const parts = [`${name}=${value}`, "Path=/", `Max-Age=${seconds(maxAgeMs)}`, "HttpOnly", "SameSite=Strict"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

function readCookie(base: string, request: Request): string | null {
  const { name } = cookieName(base, request);
  for (const pair of request.headers.get("cookie")?.split(";") ?? []) {
    const split = pair.indexOf("=");
    if (split > 0 && pair.slice(0, split).trim() === name) return pair.slice(split + 1).trim();
  }
  return null;
}

/** SOLAGENT_MERCHANT_WALLETS, when set, is the list of wallets that may sign in. */
export function isAllowedMerchant(address: string): boolean {
  return serverConfig.merchantWallets.size === 0 || serverConfig.merchantWallets.has(address);
}

/**
 * Refuses requests another site's page sent. Browsers put Origin on every POST and DELETE; SameSite=Strict already
 * keeps such requests from carrying the session, so this is the second lock. Clients without an Origin header
 * (curl, servers) aren't browsers riding someone's cookies, so they pass.
 */
export function rejectCrossSite(request: Request): Response | null {
  const origin = request.headers.get("origin");
  if (request.headers.get("sec-fetch-site") === "cross-site" || (origin !== null && origin !== appOrigin(request).origin)) {
    return error(403, "Requests from other sites aren't accepted.");
  }
  return null;
}

/** A new sign-in request for `address`, and the cookie that ties it to this browser. */
export function createChallenge(request: Request, address: string): { challenge: SignInChallenge; cookie: string } {
  const origin = appOrigin(request);
  const now = Date.now();
  const input: SignInInput = {
    domain: origin.host,
    address,
    statement: STATEMENT,
    uri: origin.origin,
    version: "1",
    nonce: encodeBase58(randomBytes(16)),
    issuedAt: new Date(now).toISOString(),
    expirationTime: new Date(now + CHALLENGE_TTL_MS).toISOString(),
  };
  const token = signToken({ aud: CHALLENGE_AUDIENCE, iat: seconds(now), exp: seconds(now + CHALLENGE_TTL_MS), input }, secret());
  return {
    challenge: { input, message: signInMessage(input) },
    cookie: setCookie(CHALLENGE_COOKIE, request, token, CHALLENGE_TTL_MS),
  };
}

/** The sign-in request this browser holds, if it's ours, unexpired and for this origin. */
export function readChallenge(request: Request): SignInInput | null {
  const token = readCookie(CHALLENGE_COOKIE, request);
  const claims = token ? verifyToken(token, secret(), CHALLENGE_AUDIENCE) : null;
  const input = claims?.input as SignInInput | undefined;
  return input && input.uri === appOrigin(request).origin ? input : null;
}

/**
 * Spends the request's nonce. False if it was already spent: the same signed message sent twice. Done after the
 * signature checks, so only real sign-ins write to the store.
 */
export function spendNonce(store: AuthStore, input: SignInInput): Promise<boolean> {
  return store.consumeNonce(input.nonce, Date.parse(input.expirationTime) + NONCE_RETENTION_MS);
}

/** A session for `address`: what to tell the browser, and the cookies that carry it (the request cookie is spent). */
export function startSession(request: Request, address: string): { session: MerchantSession; cookies: string[] } {
  const now = Date.now();
  const exp = seconds(now + serverConfig.sessionTtlMs);
  const token = signToken(
    { aud: SESSION_AUDIENCE, iss: appOrigin(request).origin, sub: address, sid: randomUUID(), iat: seconds(now), exp },
    secret(),
  );
  return {
    session: { address, expiresAt: exp * 1000 },
    cookies: [setCookie(SESSION_COOKIE, request, token, serverConfig.sessionTtlMs), setCookie(CHALLENGE_COOKIE, request, "", 0)],
  };
}

/**
 * The session this request carries, if it's valid, unexpired and not signed out, and its wallet is still allowed
 * (taking a wallet off SOLAGENT_MERCHANT_WALLETS ends its sessions).
 */
export async function readSession(request: Request, store: AuthStore): Promise<VerifiedSession | null> {
  const token = readCookie(SESSION_COOKIE, request);
  const claims = token ? verifyToken(token, secret(), SESSION_AUDIENCE) : null;
  if (!claims || claims.iss !== appOrigin(request).origin || typeof claims.sub !== "string" || typeof claims.sid !== "string") return null;
  if (!isAllowedMerchant(claims.sub) || (await store.isSessionRevoked(claims.sid))) return null;
  return { address: claims.sub, expiresAt: claims.exp * 1000, sessionId: claims.sid };
}

/** Cookies that clear this browser's session and any pending sign-in request. */
export function endSessionCookies(request: Request): string[] {
  return [setCookie(SESSION_COOKIE, request, "", 0), setCookie(CHALLENGE_COOKIE, request, "", 0)];
}

/**
 * Guard for merchant-only endpoints: the signed-in wallet, or the response to send instead (403 from another site,
 * 401 without a valid session). Routes then check the wallet owns what it's acting on.
 */
export async function requireMerchant(request: Request, store: AuthStore): Promise<VerifiedSession | Response> {
  const crossSite = rejectCrossSite(request);
  if (crossSite) return crossSite;
  return (await readSession(request, store)) ?? error(401, "Sign in with your merchant wallet first.");
}
