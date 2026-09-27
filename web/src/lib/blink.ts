import type { NetworkId } from "./network";

// Sharing an invoice or a product as a Solana Action (Blink). The actions live at /api/actions/pay/<reference> and
// /api/actions/product/<id> (see src/server/actions.ts); these build the links that point wallets and blink clients
// at them.

/** An invoice's action, as an https URL. */
export function actionUrl(origin: string, reference: string): string {
  return `${origin}/api/actions/pay/${reference}`;
}

/** A product's action, as an https URL. Every buyer who opens it gets an order of their own. */
export function productActionUrl(origin: string, productId: string): string {
  return `${origin}/api/actions/product/${productId}`;
}

/** `solana-action:<url>`, the URI scheme Actions clients and wallets recognize. */
export function actionUri(origin: string, reference: string): string {
  return `solana-action:${actionUrl(origin, reference)}`;
}

/** Dialect's dial.to page for an action URL: a blink that works in any browser. */
export function dialToActionUrl(action: string, network: NetworkId): string {
  const url = new URL("https://dial.to/");
  url.searchParams.set("action", `solana-action:${action}`);
  if (network === "devnet") url.searchParams.set("cluster", "devnet");
  return url.toString();
}

/** Dialect's dial.to page for an invoice's action. */
export function dialToUrl(origin: string, reference: string, network: NetworkId): string {
  return dialToActionUrl(actionUrl(origin, reference), network);
}

/** A post on X that unfurls as the product's Blink (once the domain is registered with Dialect). */
export function shareOnXUrl(text: string, link: string): string {
  const url = new URL("https://x.com/intent/post");
  url.searchParams.set("text", text);
  url.searchParams.set("url", link);
  return url.toString();
}

/** Blink clients fetch the action from their own servers: only a public https origin is reachable. */
export function isPublicOrigin(origin: string): boolean {
  try {
    const { protocol, hostname } = new URL(origin);
    return protocol === "https:" && hostname !== "localhost" && !/^127\.|^\[?::1\]?$/.test(hostname);
  } catch {
    return false;
  }
}
