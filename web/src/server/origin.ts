import { serverConfig, warnOnce } from "./config";
import { ServerConfigError } from "./http";

/** This machine: localhost, 127.x.x.x or [::1]. */
const LOOPBACK = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])$/i;

/**
 * This app's public origin: what sign-in messages name, and what Solana Action responses link to (icons).
 *
 * SOLAGENT_APP_URL when it's set. Without it, the request's own origin, in development, and in a production build
 * served on this machine (`next start` on localhost, e.g. to try it on devnet). Not for a public host: there the
 * Host header is the caller's to choose, so a phishing site could have the server accept sign-in signatures it
 * collected for its own domain. That case is refused with an error naming the setting, instead of guessed at.
 */
export function publicOrigin(request: Request): URL {
  if (serverConfig.appUrl) return serverConfig.appUrl;
  const own = new URL(new URL(request.url).origin);
  if (process.env.NODE_ENV !== "production") return own;
  if (LOOPBACK.test(own.hostname)) {
    warnOnce(
      "local-origin",
      `SOLAGENT_APP_URL isn't set: using ${own.origin}, since this request came to this machine. Set it before serving this build on a public address.`,
    );
    return own;
  }
  throw new ServerConfigError(
    `Set SOLAGENT_APP_URL to this app's public origin (e.g. ${own.origin}) to serve sign-in and Blinks on a public address. See web/.env.example.`,
  );
}
