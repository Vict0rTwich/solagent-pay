// HTTP 402 paywalls on SolAgent Pay: charge per request in USDC, paid by AI agents (or anyone) over Solana Pay.
//
// Server side (the API you're charging for):
//   1. A request arrives without payment: the paywall creates a USDC invoice through your SolAgent Pay gateway
//      (with one of your API keys) and answers 402 Payment Required, with the invoice in an x402-style `accepts` list.
//   2. The caller pays the invoice's Solana Pay link, then repeats the request with an `X-PAYMENT` header naming the
//      invoice's reference.
//   3. The paywall checks the invoice is for this price and wallet, and redeems it with the gateway. Redemption
//      succeeds once per invoice, ever, so one payment unlocks exactly one request, even across server instances.
//
// The 402 body follows x402's shape (`x402Version`, `accepts`, `X-PAYMENT`), but the scheme is SolAgent Pay's own:
// "solana-pay-reference", where the payment is a Solana Pay transfer found by its reference key. Clients built only
// for x402's "exact" scheme won't pay it automatically; `fetchWithPayment` below does.

export type PaywallNetwork = "devnet" | "localnet" | "mainnet-beta";

export const X402_VERSION = 1;
export const X402_SCHEME = "solana-pay-reference";
export const PAYMENT_HEADER = "x-payment";

export interface PaywallOptions {
  /** Price per request, in USDC: 0.1 or "0.10". At most 6 decimals. */
  amount: number | string;
  currency?: "USDC";
  /** The wallet that gets paid. It must be the wallet that created `apiKey`. */
  payTo: string;
  /** A SolAgent Pay API key: sp_test_… (devnet, localnet) or sp_live_… (mainnet-beta). Keep it server-side. */
  apiKey: string;
  /** Your SolAgent Pay dashboard's origin, e.g. "https://pay.example.com". */
  gatewayUrl: string;
  /** Defaults to devnet for test keys and mainnet-beta for live keys. */
  network?: PaywallNetwork;
  /** What the payer sees in their wallet, and what binds a payment to this route. Defaults to "<METHOD> <path>". */
  description?: string;
  /** For tests, or runtimes without a global fetch. */
  fetch?: typeof fetch;
}

/** One way to pay, in x402's PaymentRequirements shape. */
export interface PaymentRequirements {
  scheme: typeof X402_SCHEME;
  /** x402 network names: "solana", "solana-devnet", "solana-localnet". */
  network: string;
  /** Price in the asset's base units (USDC has 6 decimals): "100000" is 0.10 USDC. */
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: string;
  maxTimeoutSeconds: number;
  /** The USDC mint on `network`. */
  asset: string;
  extra: {
    /** The same price as a decimal USDC string, e.g. "0.1": what `SolAgentPayClient.pay` takes. */
    amount: string;
    invoiceId: string;
    /** The Solana Pay reference key: what `X-PAYMENT` names once it's paid. */
    reference: string;
    /** `solana:` transfer request: pay this with any Solana Pay wallet or library. */
    paymentUrl: string;
    /** A web checkout page for the same invoice, for a human payer. */
    checkoutUrl: string;
    /** Unix ms; after this the invoice can't be paid. */
    expiresAt: number;
  };
}

export interface PaymentRequiredBody {
  x402Version: typeof X402_VERSION;
  error: string;
  accepts: PaymentRequirements[];
}

/** An invoice as the gateway's API returns it (the fields the paywall reads). */
interface GatewayInvoice {
  id: string;
  reference: string;
  network: PaywallNetwork;
  recipient: string;
  mint: string | null;
  amount: string;
  memo: string;
  paymentUrl: string;
  expiresAt: number;
  status: "pending" | "paid" | "expired" | "canceled";
}

const X402_NETWORK: Record<PaywallNetwork, string> = { devnet: "solana-devnet", localnet: "solana-localnet", "mainnet-beta": "solana" };
const USDC_DECIMALS = 6;

/** "0.1" -> 100000n. Throws for more than 6 decimals or anything that isn't a positive decimal. */
function toBaseUnits(amount: number | string): bigint {
  const text = typeof amount === "number" ? amount.toFixed(USDC_DECIMALS) : amount.trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) throw new Error(`amount must be a positive decimal in USDC; got "${String(amount)}".`);
  const fraction = (match[2] ?? "").replace(/0+$/, "");
  if (fraction.length > USDC_DECIMALS) throw new Error(`USDC has ${USDC_DECIMALS} decimals; "${String(amount)}" has more.`);
  const units = BigInt(match[1] ?? "0") * 10n ** BigInt(USDC_DECIMALS) + BigInt(fraction.padEnd(USDC_DECIMALS, "0") || "0");
  if (units <= 0n) throw new Error("amount must be more than zero.");
  return units;
}

function toDecimal(units: bigint): string {
  const whole = units / 10n ** BigInt(USDC_DECIMALS);
  const fraction = (units % 10n ** BigInt(USDC_DECIMALS)).toString().padStart(USDC_DECIMALS, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : `${whole}`;
}

function checkoutUrl(gateway: string, paymentUrl: string, network: PaywallNetwork): string {
  const rest = paymentUrl.slice("solana:".length);
  const queryStart = rest.indexOf("?");
  const recipient = queryStart < 0 ? rest : rest.slice(0, queryStart);
  const query = queryStart < 0 ? "" : `&${rest.slice(queryStart + 1)}`;
  return `${gateway}/pay?recipient=${recipient}${query}&cluster=${network}`;
}

/** The `X-PAYMENT` header value an agent sends once it has paid the invoice with this reference. */
export function encodePaymentHeader(reference: string, network: PaywallNetwork): string {
  return btoa(JSON.stringify({ x402Version: X402_VERSION, scheme: X402_SCHEME, network: X402_NETWORK[network], payload: { reference } }));
}

/** The reference an `X-PAYMENT` header names, or null when it isn't one of ours. */
export function decodePaymentHeader(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(atob(value));
    if (!parsed || typeof parsed !== "object") return null;
    const envelope = parsed as { scheme?: unknown; payload?: { reference?: unknown } };
    const reference = envelope.payload?.reference;
    return envelope.scheme === X402_SCHEME && typeof reference === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(reference) ? reference : null;
  } catch {
    return null;
  }
}

function jsonResponse(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });
}

/**
 * The paywall as a function of a fetch-style Request: a Response to send instead (402, or 503 if the gateway is
 * unreachable), or null when the request carries a valid, unredeemed payment and should be served.
 */
export function createPaywall(options: PaywallOptions): (request: Request) => Promise<Response | null> {
  const doFetch = options.fetch ?? fetch;
  const gateway = options.gatewayUrl.replace(/\/+$/, "");
  const price = toBaseUnits(options.amount);
  const network: PaywallNetwork = options.network ?? (options.apiKey.startsWith("sp_live_") ? "mainnet-beta" : "devnet");
  const auth = { authorization: `Bearer ${options.apiKey}`, "content-type": "application/json" };

  async function gatewayCall<T>(path: string, method: "GET" | "POST", body?: unknown): Promise<{ status: number; body: T }> {
    const response = await doFetch(`${gateway}${path}`, { method, headers: auth, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: (await response.json().catch(() => ({}))) as T };
  }

  function requirements(invoice: GatewayInvoice, resource: string, description: string, error: string): Response {
    const body: PaymentRequiredBody = {
      x402Version: X402_VERSION,
      error,
      accepts: [
        {
          scheme: X402_SCHEME,
          network: X402_NETWORK[invoice.network],
          maxAmountRequired: price.toString(),
          resource,
          description,
          mimeType: "application/json",
          payTo: invoice.recipient,
          maxTimeoutSeconds: Math.max(0, Math.floor((invoice.expiresAt - Date.now()) / 1000)),
          asset: invoice.mint ?? "",
          extra: {
            amount: toDecimal(price),
            invoiceId: invoice.id,
            reference: invoice.reference,
            paymentUrl: invoice.paymentUrl,
            checkoutUrl: checkoutUrl(gateway, invoice.paymentUrl, invoice.network),
            expiresAt: invoice.expiresAt,
          },
        },
      ],
    };
    return jsonResponse(body, 402);
  }

  async function newInvoice(resource: string, description: string, error: string): Promise<Response> {
    const created = await gatewayCall<{ invoice?: GatewayInvoice; error?: string }>("/api/invoices", "POST", {
      network,
      recipient: options.payTo,
      currency: "USDC",
      amount: toDecimal(price),
      memo: description,
      kind: "link",
    });
    if (created.status !== 201 || !created.body.invoice) {
      return jsonResponse({ error: `The payment gateway couldn't create an invoice: ${created.body.error ?? `HTTP ${created.status}`}` }, 503);
    }
    return requirements(created.body.invoice, resource, description, error);
  }

  return async (request) => {
    const url = new URL(request.url);
    const resource = url.toString();
    const description = (options.description ?? `${request.method} ${url.pathname}`).slice(0, 80);
    try {
      const reference = decodePaymentHeader(request.headers.get(PAYMENT_HEADER));
      if (!reference) return await newInvoice(resource, description, "Payment required.");

      // The invoice must be this route's, at this price, for this wallet, before it's spent on this request.
      const found = await gatewayCall<GatewayInvoice & { error?: string }>(`/api/invoices/${reference}`, "GET");
      const invoice = found.status === 200 ? found.body : null;
      if (!invoice || invoice.recipient !== options.payTo || invoice.memo !== description || invoice.mint === null || toBaseUnits(invoice.amount) !== price) {
        return await newInvoice(resource, description, "That payment isn't for this resource.");
      }

      const redeemed = await gatewayCall<{ error?: string }>(`/api/invoices/${reference}/redeem`, "POST");
      if (redeemed.status === 200) return null;
      if (redeemed.status === 402 && invoice.status !== "expired" && invoice.status !== "canceled") {
        // Not paid yet (or still confirming): the same invoice stays payable.
        return requirements(invoice, resource, description, redeemed.body.error ?? "Payment not confirmed yet.");
      }
      return await newInvoice(resource, description, redeemed.body.error ?? "That payment can't be used.");
    } catch (caught) {
      return jsonResponse({ error: `The payment gateway is unreachable: ${caught instanceof Error ? caught.message : String(caught)}` }, 503);
    }
  };
}

/**
 * Wraps a fetch-style handler (a Next.js App Router route, Hono, Bun, Deno, Cloudflare Workers) so it only runs for
 * paid requests.
 *
 *   export const GET = withPaywall(async () => Response.json({ report }), { amount: "0.10", ... });
 */
export function withPaywall<Context extends unknown[]>(
  handler: (request: Request, ...context: Context) => Response | Promise<Response>,
  options: PaywallOptions,
): (request: Request, ...context: Context) => Promise<Response> {
  const paywall = createPaywall(options);
  return async (request, ...context) => (await paywall(request)) ?? handler(request, ...context);
}

/** The parts of an Express/Connect request and response the middleware uses. */
export interface NodeRequestLike {
  method?: string;
  url?: string;
  originalUrl?: string;
  protocol?: string;
  headers: Record<string, string | string[] | undefined>;
}

export interface NodeResponseLike {
  statusCode: number;
  setHeader(name: string, value: string): unknown;
  end(body?: string): unknown;
}

/**
 * Express/Connect middleware: `app.get("/api/report", solagentMiddleware({ amount: 0.1, ... }), handler)`.
 * Paid requests go on to `next()`; the rest get the paywall's 402 (or 503).
 */
export function solagentMiddleware(options: PaywallOptions): (req: NodeRequestLike, res: NodeResponseLike, next: (error?: unknown) => void) => void {
  const paywall = createPaywall(options);
  return (req, res, next) => {
    const host = req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost";
    const url = `${req.protocol ?? "http"}://${Array.isArray(host) ? host[0] : host}${req.originalUrl ?? req.url ?? "/"}`;
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (typeof value === "string") headers.set(name, value);
      else if (Array.isArray(value)) headers.set(name, value.join(", "));
    }
    paywall(new Request(url, { method: req.method ?? "GET", headers }))
      .then(async (blocked) => {
        if (!blocked) return next();
        res.statusCode = blocked.status;
        blocked.headers.forEach((value, name) => void res.setHeader(name, value));
        res.end(await blocked.text());
      })
      .catch(next);
  };
}

/**
 * The payer's side: fetches `input`, and on a SolAgent Pay 402 calls `pay` with the requirements (pay the
 * `extra.paymentUrl` Solana Pay link with your agent's wallet and wait for confirmation), then retries with the
 * `X-PAYMENT` header, a few times while the gateway catches up with the chain.
 */
export async function fetchWithPayment(
  input: string | URL,
  init: RequestInit & { pay: (requirements: PaymentRequirements) => Promise<void>; retries?: number; retryDelayMs?: number },
): Promise<Response> {
  const { pay, retries = 5, retryDelayMs = 2_000, ...request } = init;
  const first = await fetch(input, request);
  if (first.status !== 402) return first;
  const body = (await first.json()) as Partial<PaymentRequiredBody>;
  const requirement = body.accepts?.find((accept) => accept.scheme === X402_SCHEME);
  if (!requirement) return first;

  await pay(requirement);
  const network = (Object.entries(X402_NETWORK).find(([, name]) => name === requirement.network)?.[0] ?? "devnet") as PaywallNetwork;
  const headers = new Headers(request.headers);
  headers.set(PAYMENT_HEADER, encodePaymentHeader(requirement.extra.reference, network));
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(input, { ...request, headers });
    if (response.status !== 402 || attempt >= retries) return response;
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }
}
