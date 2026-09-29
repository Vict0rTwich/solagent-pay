import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { Keypair } from "@solana/web3.js";

import {
  PAYMENT_HEADER,
  X402_SCHEME,
  createPaywall,
  decodePaymentHeader,
  encodePaymentHeader,
  fetchWithPayment,
  type PaymentRequiredBody,
  type PaywallOptions,
} from "../src/x402";

// The paywall against an in-memory gateway that answers like web/src/app/api/invoices: POST /api/invoices (201,
// memo trimmed), GET /api/invoices/<reference>, and POST .../redeem (200 once, 402 unpaid, 409 already redeemed).

const USDC_DEVNET = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const address = () => Keypair.generate().publicKey.toBase58();

interface MockInvoice {
  id: string;
  reference: string;
  network: "devnet";
  recipient: string;
  mint: string;
  amount: string;
  memo: string;
  paymentUrl: string;
  expiresAt: number;
  status: "pending" | "paid" | "expired" | "canceled";
  redeemed: boolean;
}

function mockGateway() {
  const invoices = new Map<string, MockInvoice>();
  const calls: { method: string; path: string; authorization: string | null }[] = [];
  let down = false;

  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (down) throw new Error("connect ECONNREFUSED");
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    calls.push({ method, path: url.pathname, authorization: new Headers(init?.headers).get("authorization") });

    if (method === "POST" && url.pathname === "/api/invoices") {
      const body = JSON.parse(String(init?.body)) as { recipient: string; amount: string; memo: string };
      const reference = address();
      const invoice: MockInvoice = {
        id: `INV-${invoices.size + 1}`,
        reference,
        network: "devnet",
        recipient: body.recipient,
        mint: USDC_DEVNET,
        amount: body.amount,
        memo: body.memo.trim(),
        paymentUrl: `solana:${body.recipient}?amount=${body.amount}&spl-token=${USDC_DEVNET}&reference=${reference}`,
        expiresAt: Date.now() + 600_000,
        status: "pending",
        redeemed: false,
      };
      invoices.set(reference, invoice);
      return reply({ invoice }, 201);
    }
    const redeem = /^\/api\/invoices\/([^/]+)\/redeem$/.exec(url.pathname);
    if (method === "POST" && redeem) {
      const invoice = invoices.get(redeem[1]!);
      if (!invoice) return reply({ error: "No invoice with that reference." }, 404);
      if (invoice.status !== "paid") return reply({ error: `Not paid: the invoice is ${invoice.status}.` }, 402);
      if (invoice.redeemed) return reply({ error: "This payment was already redeemed. Each payment unlocks one request." }, 409);
      invoice.redeemed = true;
      return reply({ redeemedAt: Date.now() });
    }
    const get = /^\/api\/invoices\/([^/]+)$/.exec(url.pathname);
    if (method === "GET" && get) {
      const invoice = invoices.get(get[1]!);
      return invoice ? reply(invoice) : reply({ error: "No invoice with that reference." }, 404);
    }
    return reply({ error: "not found" }, 404);
  }) as typeof globalThis.fetch;

  return {
    fetch,
    calls,
    invoices,
    pay: (reference: string) => void (invoices.get(reference)!.status = "paid"),
    setDown: (value: boolean) => void (down = value),
  };
}

function setup(overrides: Partial<PaywallOptions> = {}) {
  const gateway = mockGateway();
  const payTo = address();
  const paywall = createPaywall({
    amount: "0.10",
    payTo,
    apiKey: "sp_test_abc",
    gatewayUrl: "https://gateway.example/",
    fetch: gateway.fetch,
    ...overrides,
  });
  return { gateway, payTo, paywall };
}

const request = (reference?: string) =>
  new Request("https://api.example/api/report?city=lagos", {
    headers: reference ? { [PAYMENT_HEADER]: encodePaymentHeader(reference, "devnet") } : {},
  });

async function requirementsOf(response: Response | null) {
  assert.ok(response);
  assert.equal(response.status, 402);
  const body = (await response.json()) as PaymentRequiredBody;
  assert.equal(body.accepts.length, 1);
  return { body, requirement: body.accepts[0]! };
}

describe("x402 paywall", () => {
  it("answers an unpaid request with a 402 in x402's accepts shape", async () => {
    const { gateway, payTo, paywall } = setup();
    const { body, requirement } = await requirementsOf(await paywall(request()));

    assert.equal(body.x402Version, 1);
    assert.equal(body.error, "Payment required.");
    assert.equal(requirement.scheme, X402_SCHEME);
    assert.equal(requirement.network, "solana-devnet");
    assert.equal(requirement.maxAmountRequired, "100000");
    assert.equal(requirement.extra.amount, "0.1");
    assert.equal(requirement.payTo, payTo);
    assert.equal(requirement.asset, USDC_DEVNET);
    assert.equal(requirement.resource, "https://api.example/api/report?city=lagos");
    assert.equal(requirement.description, "GET /api/report");
    assert.ok(requirement.maxTimeoutSeconds > 590 && requirement.maxTimeoutSeconds <= 600);
    assert.ok(requirement.extra.paymentUrl.startsWith(`solana:${payTo}?`));
    assert.ok(requirement.extra.checkoutUrl.startsWith(`https://gateway.example/pay?recipient=${payTo}&amount=0.1&`));
    assert.ok(requirement.extra.checkoutUrl.endsWith("&cluster=devnet"));

    assert.deepEqual(gateway.calls, [{ method: "POST", path: "/api/invoices", authorization: "Bearer sp_test_abc" }]);
  });

  it("serves a paid request once, and asks again when the payment is reused", async () => {
    const { gateway, paywall } = setup();
    const { requirement } = await requirementsOf(await paywall(request()));
    gateway.pay(requirement.extra.reference);

    assert.equal(await paywall(request(requirement.extra.reference)), null);

    const reused = await requirementsOf(await paywall(request(requirement.extra.reference)));
    assert.match(reused.body.error, /already redeemed/);
    assert.notEqual(reused.requirement.extra.reference, requirement.extra.reference);
  });

  it("offers the same invoice again while the payment is unconfirmed", async () => {
    const { paywall } = setup();
    const { requirement } = await requirementsOf(await paywall(request()));

    const again = await requirementsOf(await paywall(request(requirement.extra.reference)));
    assert.match(again.body.error, /Not paid/);
    assert.equal(again.requirement.extra.reference, requirement.extra.reference);
  });

  it("won't accept a payment made for another price", async () => {
    const cheap = setup({ amount: "0.01" });
    const { requirement } = await requirementsOf(await cheap.paywall(request()));
    cheap.gateway.pay(requirement.extra.reference);

    const pricey = createPaywall({ amount: "0.10", payTo: cheap.payTo, apiKey: "sp_test_abc", gatewayUrl: "https://gateway.example", fetch: cheap.gateway.fetch });
    const refused = await requirementsOf(await pricey(request(requirement.extra.reference)));
    assert.equal(refused.body.error, "That payment isn't for this resource.");
    assert.equal(cheap.gateway.invoices.get(requirement.extra.reference)!.redeemed, false);
  });

  it("serves a paid request when the description has surrounding whitespace, which the gateway trims", async () => {
    const { gateway, paywall } = setup({ description: "  Weather report  " });
    const { requirement } = await requirementsOf(await paywall(request()));
    assert.equal(requirement.description, "Weather report");
    gateway.pay(requirement.extra.reference);

    assert.equal(await paywall(request(requirement.extra.reference)), null);
  });

  it("answers 503 when the gateway is unreachable", async () => {
    const { gateway, paywall } = setup();
    gateway.setDown(true);
    const response = await paywall(request());
    assert.ok(response);
    assert.equal(response.status, 503);
    assert.match(((await response.json()) as { error: string }).error, /unreachable/);
  });
});

describe("X-PAYMENT header", () => {
  it("round-trips a reference", () => {
    const reference = address();
    assert.equal(decodePaymentHeader(encodePaymentHeader(reference, "devnet")), reference);
  });

  it("rejects headers that aren't SolAgent Pay's", () => {
    assert.equal(decodePaymentHeader(null), null);
    assert.equal(decodePaymentHeader("not base64 json"), null);
    assert.equal(decodePaymentHeader(btoa(JSON.stringify({ scheme: "exact", payload: { reference: address() } }))), null);
    assert.equal(decodePaymentHeader(btoa(JSON.stringify({ scheme: X402_SCHEME, payload: { reference: "0OIl" } }))), null);
  });
});

describe("fetchWithPayment", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => void (globalThis.fetch = realFetch));

  it("pays a 402, then retries with X-PAYMENT until the gateway confirms", async () => {
    const { gateway, paywall } = setup();
    const seen: (string | null)[] = [];
    let confirmAfter = 2; // the first retry arrives before the payment confirms
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const incoming = new Request(String(input), init);
      seen.push(incoming.headers.get(PAYMENT_HEADER));
      const reference = decodePaymentHeader(incoming.headers.get(PAYMENT_HEADER));
      if (reference && --confirmAfter === 0) gateway.pay(reference);
      return (await paywall(incoming)) ?? Response.json({ report: "sunny" });
    }) as typeof globalThis.fetch;

    const paid: string[] = [];
    const response = await fetchWithPayment("https://api.example/api/report", {
      pay: async (requirement) => void paid.push(requirement.extra.reference),
      retryDelayMs: 0,
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { report: "sunny" });
    assert.equal(paid.length, 1);
    assert.equal(seen.length, 3);
    assert.equal(seen[0], null);
    assert.equal(decodePaymentHeader(seen[1]!), paid[0]);
    assert.equal(decodePaymentHeader(seen[2]!), paid[0]);
  });

  it("gives up after its retries while the payment stays unconfirmed", async () => {
    const { paywall } = setup();
    let requests = 0;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      requests++;
      return (await paywall(new Request(String(input), init))) ?? Response.json({});
    }) as typeof globalThis.fetch;

    const response = await fetchWithPayment("https://api.example/api/report", { pay: async () => {}, retries: 2, retryDelayMs: 0 });
    assert.equal(response.status, 402);
    assert.equal(requests, 1 + 3);
  });

  it("returns a 402 that isn't SolAgent Pay's untouched, body unread", async () => {
    globalThis.fetch = (async () => new Response("pay me elsewhere", { status: 402 })) as typeof globalThis.fetch;
    let paid = false;
    const response = await fetchWithPayment("https://api.example/other", { pay: async () => void (paid = true) });
    assert.equal(response.status, 402);
    assert.equal(await response.text(), "pay me elsewhere");
    assert.equal(paid, false);
  });
});
