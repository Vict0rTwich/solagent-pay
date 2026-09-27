import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { PublicKey } from "@solana/web3.js";

// Sign-in and "Create payment link" as a production build runs them on this machine (`next start` on localhost)
// with no .env at all: no SOLAGENT_APP_URL, no SOLAGENT_SESSION_SECRET. That used to answer every sign-in with an
// empty 500. The route handlers run here as Next runs them, from Request to Response.

type Handler = (request: Request) => Promise<Response>;

const ORIGIN = "http://localhost:3000";
let dataDir: string;
let routes: {
  nonce: Handler;
  verify: Handler;
  session: Handler;
  createInvoice: Handler;
};

before(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "solagent-auth-"));
  // Before any server module loads: settings are read when it does.
  for (const name of ["SOLAGENT_APP_URL", "SOLAGENT_SESSION_SECRET", "SOLAGENT_MERCHANT_WALLETS", "SOLAGENT_STORE"]) delete process.env[name];
  Object.assign(process.env, { NODE_ENV: "production", SOLAGENT_DATA_DIR: dataDir });

  routes = {
    nonce: (await import("@/app/api/auth/nonce/route")).POST,
    verify: (await import("@/app/api/auth/verify/route")).POST,
    session: (await import("@/app/api/auth/session/route")).GET,
    createInvoice: (await import("@/app/api/invoices/route")).POST,
  };
});

after(async () => {
  // Creating an invoice starts the payment engine: stop its timers and sockets so the test process can exit.
  const { paymentRuntime } = await import("@/server/runtime");
  const runtime = paymentRuntime();
  runtime.listener.stop();
  runtime.webhooks.stop();
  runtime.receipts.stop();
  await rm(dataDir, { recursive: true, force: true });
});

/** A browser request from this app's page: same origin, JSON, with whatever cookies it holds. */
function request(pathname: string, init: { method?: string; body?: unknown; cookie?: string; origin?: string } = {}): Request {
  const origin = init.origin ?? ORIGIN;
  return new Request(`${origin}${pathname}`, {
    method: init.method ?? "GET",
    headers: {
      origin,
      "content-type": "application/json",
      ...(init.cookie ? { cookie: init.cookie } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
}

/** "name=value" pairs from a response's Set-Cookie headers, as a browser would send them back. */
function cookiesFrom(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .filter((pair) => pair && !pair.endsWith("="))
    .join("; ");
}

/** A wallet, as Phantom holds one: an Ed25519 key pair and its base58 address. */
function wallet() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const x = publicKey.export({ format: "jwk" }).x ?? "";
  return {
    address: new PublicKey(Buffer.from(x, "base64url")).toBase58(),
    signMessage: (message: string) => sign(null, Buffer.from(message, "utf8"), privateKey),
  };
}

describe("sign-in and payment links on a production build, with no .env", () => {
  const merchant = wallet();
  let session = "";

  it("answers the session check (no session yet) instead of failing", async () => {
    const response = await routes.session(request("/api/auth/session"));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { session: null });
  });

  it("signs a Phantom wallet in with Sign-In with Solana", async () => {
    const nonce = await routes.nonce(request("/api/auth/nonce", { method: "POST", body: { address: merchant.address } }));
    assert.equal(nonce.status, 200, await nonce.clone().text());
    const challenge = (await nonce.json()) as { input: { domain: string }; message: string };
    assert.equal(challenge.input.domain, "localhost:3000", "the message names the page the wallet is signing on");

    const signature = merchant.signMessage(challenge.message);
    const verified = await routes.verify(
      request("/api/auth/verify", {
        method: "POST",
        cookie: cookiesFrom(nonce),
        body: { signedMessage: Buffer.from(challenge.message, "utf8").toString("base64"), signature: signature.toString("base64") },
      }),
    );
    assert.equal(verified.status, 200, await verified.clone().text());
    session = cookiesFrom(verified);
    assert.match(session, /^solagent_session=/);

    const check = await routes.session(request("/api/auth/session", { cookie: session }));
    assert.equal(((await check.json()) as { session: { address: string } }).session.address, merchant.address);
  });

  it("keeps sessions across a restart: the generated key is saved beside the store", async () => {
    assert.ok(existsSync(path.join(dataDir, "session-secret")));
    // What a restart loses: the key cached in memory.
    delete (globalThis as Record<symbol, unknown>)[Symbol.for("solagent-pay.local-session-secret")];
    const check = await routes.session(request("/api/auth/session", { cookie: session }));
    assert.equal(((await check.json()) as { session: { address: string } | null }).session?.address, merchant.address);
  });

  it("creates a payment link for the signed-in wallet", async () => {
    const response = await routes.createInvoice(
      request("/api/invoices", {
        method: "POST",
        cookie: session,
        // Localnet: nothing here should reach the public devnet RPC.
        body: { network: "localnet", recipient: merchant.address, currency: "USDC", amount: "25", memo: "Quick link", kind: "link" },
      }),
    );
    assert.equal(response.status, 201, await response.clone().text());
    const { invoice } = (await response.json()) as { invoice: { status: string; recipient: string; paymentUrl: string } };
    assert.equal(invoice.status, "pending");
    assert.equal(invoice.recipient, merchant.address);
    assert.match(invoice.paymentUrl, /^solana:/);
  });

  it("still refuses a public host without SOLAGENT_APP_URL, saying what to set", async () => {
    const response = await routes.nonce(
      request("/api/auth/nonce", { method: "POST", origin: "https://pay.example.com", body: { address: merchant.address } }),
    );
    assert.equal(response.status, 503);
    assert.match(((await response.json()) as { error: string }).error, /SOLAGENT_APP_URL/);
  });
});

describe("route error guard", () => {
  it("answers in JSON whatever a handler throws", async () => {
    const { ServerConfigError, guarded } = await import("@/server/http");
    const cases: Array<[unknown, number]> = [
      [new ServerConfigError("Set SOLAGENT_X."), 503],
      [Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), { code: "ECONNREFUSED" }), 503],
      [new TypeError("boom"), 500],
    ];
    const quiet = console.error;
    console.error = () => {};
    try {
      for (const [thrown, status] of cases) {
        const response = await guarded(async () => {
          throw thrown;
        })();
        assert.equal(response.status, status);
        assert.equal(typeof ((await response.json()) as { error: unknown }).error, "string");
      }
    } finally {
      console.error = quiet;
    }
  });
});
