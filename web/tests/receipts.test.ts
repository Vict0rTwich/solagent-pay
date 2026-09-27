import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { Keypair, PublicKey, type ParsedTransactionWithMeta } from "@solana/web3.js";

import { validateTransfer } from "@/lib/invoice-payments";
import { USDC_MINT_DEVNET } from "@/lib/network";
import type { Product } from "@/lib/types";
import type { EngineEventInput } from "@/server/events";
import { ReceiptMinter, receiptNft, type UnderdogConfig } from "@/server/receipts";
import { FileInvoiceStore } from "@/server/store/file-store";
import { isStoreError, toPublicInvoice, type InvoiceRecord, type NewInvoiceRecord } from "@/server/store/types";

// The settle -> receipt pipeline: who paid (from the transaction), the receipt the store queues with the settlement,
// and the minter that turns it into an Underdog cNFT, or a simulated one without a key.

const address = () => Keypair.generate().publicKey.toBase58();

function tokenBalance(accountIndex: number, owner: string, amount: string) {
  return { accountIndex, mint: USDC_MINT_DEVNET, owner, uiTokenAmount: { amount, decimals: 6, uiAmount: null, uiAmountString: "" } };
}

function parsedTx(keys: string[], signers: string[], meta: Partial<NonNullable<ParsedTransactionWithMeta["meta"]>>): ParsedTransactionWithMeta {
  return {
    slot: 1,
    blockTime: 1_750_000_000,
    transaction: {
      signatures: ["sig"],
      message: {
        accountKeys: keys.map((key) => ({ pubkey: new PublicKey(key), signer: signers.includes(key), writable: true })),
        instructions: [],
        recentBlockhash: "11111111111111111111111111111111",
      },
    },
    meta: { err: null, fee: 5000, preBalances: [], postBalances: [], preTokenBalances: [], postTokenBalances: [], ...meta },
  } as unknown as ParsedTransactionWithMeta;
}

describe("payer from the settling transaction", () => {
  it("is the token sender for USDC, even when a relayer pays the fee", () => {
    const [relayer, buyer, merchant, buyerAta, merchantAta] = [address(), address(), address(), address(), address()];
    const tx = parsedTx([relayer, buyer, buyerAta, merchantAta], [relayer, buyer], {
      preBalances: [1_000_000_000, 10_000_000, 2_039_280, 2_039_280],
      postBalances: [999_995_000, 10_000_000, 2_039_280, 2_039_280],
      preTokenBalances: [tokenBalance(2, buyer, "50000000"), tokenBalance(3, merchant, "0")],
      postTokenBalances: [tokenBalance(2, buyer, "5000000"), tokenBalance(3, merchant, "45000000")],
    });
    const check = validateTransfer(tx, "sig", { recipient: merchant, amount: "45", splToken: USDC_MINT_DEVNET });
    assert.equal(check.ok, true);
    assert.equal(check.ok && check.payer, buyer);
  });

  it("is the wallet whose SOL dropped the most for native SOL", () => {
    const [relayer, buyer, merchant] = [address(), address(), address()];
    const tx = parsedTx([relayer, buyer, merchant], [relayer, buyer], {
      preBalances: [1_000_000_000, 2_000_000_000, 0],
      postBalances: [999_995_000, 1_500_000_000, 500_000_000],
    });
    const check = validateTransfer(tx, "sig", { recipient: merchant, amount: "0.5", splToken: null });
    assert.equal(check.ok && check.payer, buyer);
  });
});

const MERCHANT = address();
const BUYER = address();

function product(id: string, overrides: Partial<Product> = {}): Product {
  return {
    id,
    network: "devnet",
    merchant: MERCHANT,
    title: "Solana Hacker Hoodie",
    description: "Heavyweight cotton fleece, edition 001",
    image: "https://example.com/hoodie.png",
    amount: "45",
    mint: USDC_MINT_DEVNET,
    createdAt: Date.now(),
    archivedAt: null,
    ...overrides,
  };
}

function order(input: Partial<NewInvoiceRecord> = {}): NewInvoiceRecord {
  const hoodie = product("prod_TestHoodie1");
  return {
    reference: address(),
    network: "devnet",
    kind: "link",
    recipient: MERCHANT,
    mint: USDC_MINT_DEVNET,
    amount: "45",
    memo: hoodie.title,
    paymentUrl: (id) => `solana:${MERCHANT}?amount=45&memo=${id}`,
    expiresAt: Date.now() + 60_000,
    product: { id: hoodie.id, info: { title: hoodie.title, description: hoodie.description, image: hoodie.image } },
    issueReceipt: true,
    ...input,
  };
}

async function paidOrder(store: FileInvoiceStore, input: Partial<NewInvoiceRecord> = {}, payer: string | null = BUYER): Promise<InvoiceRecord> {
  const created = await store.create(order(input), 100);
  const { invoice } = await store.markPaid(created.reference, { signature: `sig_${created.reference}`, blockTime: 1_750_000_000, payer });
  return invoice;
}

let dir: string;
let store: FileInvoiceStore;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "solagent-receipts-"));
  store = new FileInvoiceStore(dir);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("store: products and orders", () => {
  it("caps products on sale per merchant, and archived ones stop counting and listing", async () => {
    await store.createProduct(product("prod_TestOne111"), 2);
    await store.createProduct(product("prod_TestTwo222"), 2);
    await assert.rejects(store.createProduct(product("prod_TestThree3"), 2), (error) => isStoreError(error, "too_many_products"));

    assert.equal(await store.archiveProduct("prod_TestOne111", address()), null, "only its merchant can archive it");
    const archived = await store.archiveProduct("prod_TestOne111", MERCHANT);
    assert.ok(archived?.archivedAt);
    assert.deepEqual(
      (await store.listProducts(MERCHANT, "devnet")).map((p) => p.id),
      ["prod_TestTwo222"],
    );
    await store.createProduct(product("prod_TestThree3"), 2);
    assert.ok(await store.getProduct("prod_TestOne111"), "archived products are kept: their orders name them");
  });

  it("lists a merchant's product orders only", async () => {
    const sale = await store.create(order(), 100);
    await store.create(order({ product: null }), 100);
    const orders = await store.listOrders(MERCHANT, "devnet", 10);
    assert.deepEqual(
      orders.map((o) => o.reference),
      [sale.reference],
    );
    assert.equal(orders[0]?.product?.title, "Solana Hacker Hoodie");
  });
});

describe("store: receipts queued with the settlement", () => {
  it("records the payer and queues a pending receipt for them", async () => {
    const invoice = await paidOrder(store);
    assert.equal(invoice.payer, BUYER);
    assert.equal(invoice.receipt?.status, "pending");
    assert.equal(invoice.receipt?.owner, BUYER);
    // The public view leaves the retry bookkeeping out.
    assert.deepEqual(Object.keys(toPublicInvoice(invoice).receipt ?? {}).sort(), ["mintAddress", "mintedAt", "note", "owner", "status"]);
  });

  it("queues none when the invoice doesn't issue receipts, or the payer isn't known", async () => {
    assert.equal((await paidOrder(store, { issueReceipt: false })).receipt, null);
    assert.equal((await paidOrder(store, {}, null)).receipt, null);
  });

  it("leases a due receipt to one minter at a time", async () => {
    const invoice = await paidOrder(store);
    const now = Date.now();
    const claimed = await store.claimDueReceipt(30_000, now);
    assert.equal(claimed?.reference, invoice.reference);
    assert.equal(claimed?.receipt?.nextAttemptAt, now + 30_000);
    assert.equal(await store.claimDueReceipt(30_000, now), null, "leased: not due again until the lease runs out");
    assert.equal((await store.claimDueReceipt(30_000, now + 30_001))?.reference, invoice.reference);
  });

  it("queues again only a failed or simulated receipt, never a pending or minted one", async () => {
    const invoice = await paidOrder(store);
    await store.updateReceipt(invoice.reference, { status: "failed", note: "HTTP 400" });
    assert.equal((await store.queueReceipt(invoice.reference, BUYER))?.receipt?.status, "pending");

    await store.updateReceipt(invoice.reference, { status: "minted", mintAddress: "Mint1111" });
    assert.equal((await store.queueReceipt(invoice.reference, BUYER))?.receipt?.status, "minted");

    const open = await store.create(order(), 100);
    assert.equal((await store.queueReceipt(open.reference, BUYER))?.receipt, null, "not paid: nothing to receipt");
  });
});

describe("receipt metadata", () => {
  it("names the product and carries price, signature and timestamp", async () => {
    const invoice = await paidOrder(store);
    const nft = receiptNft(invoice, BUYER, null);
    assert.ok(nft);
    assert.equal(nft.name, "Receipt: Solana Hacker Hoodie");
    assert.equal(nft.image, "https://example.com/hoodie.png");
    assert.equal(nft.receiverAddress, BUYER);
    assert.equal(nft.attributes.Price, "45.00 USDC");
    assert.equal(nft.attributes.TxSignature, invoice.signature);
    assert.equal(nft.attributes.Timestamp, new Date(1_750_000_000_000).toISOString());
  });

  it("fits Underdog's 32-character name, and falls back to the token icon without a product image", async () => {
    const long = await paidOrder(store, {
      product: { id: "prod_TestLong111", info: { title: "Limited Edition Breakpoint Lisbon Hoodie", description: "", image: null } },
    });
    const nft = receiptNft(long, BUYER, "https://pay.example.com/api/actions/icon?currency=USDC");
    assert.ok(nft && nft.name.length <= 32 && nft.name.endsWith("…"));
    assert.equal(nft?.image, "https://pay.example.com/api/actions/icon?currency=USDC");
    assert.equal(receiptNft(long, BUYER, null), null, "no image at all: nothing to mint");
  });
});

describe("receipt minter", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function minter(config: Partial<UnderdogConfig>, events: EngineEventInput[] = []) {
    const full: UnderdogConfig = { apiKey: null, projectId: null, network: "devnet", apiUrl: null, ...config };
    const instance = new ReceiptMinter(store, full, () => null, () => {}, (event) => events.push(event));
    // The sweep kick() runs in the background, awaited here.
    return { run: () => (instance as unknown as { mintDue(): Promise<void> }).mintDue(), events };
  }

  it("simulates the receipt without an Underdog key, and never calls out", async () => {
    globalThis.fetch = () => assert.fail("no request without a key");
    const invoice = await paidOrder(store);
    const { run, events } = minter({});
    await run();
    const receipt = (await store.get(invoice.reference))?.receipt;
    assert.equal(receipt?.status, "simulated");
    assert.match(receipt?.note ?? "", /UNDERDOG_API_KEY/);
    assert.equal(events[0]?.type, "RECEIPT_MINT");
    assert.equal(events[0]?.data.outcome, "SIMULATED");
  });

  it("mints through Underdog's v2 API with the key and project", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ transactionId: "tx-1", nftId: 7, projectId: 3, mintAddress: "AssetMint111" }), { status: 202 });
    }) as typeof fetch;
    const invoice = await paidOrder(store);
    await minter({ apiKey: "key-1", projectId: "3" }).run();

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, "https://devnet.underdogprotocol.com/v2/projects/3/nfts");
    assert.equal((calls[0]?.init.headers as Record<string, string>).authorization, "Bearer key-1");
    const body = JSON.parse(String(calls[0]?.init.body)) as { name: string; receiverAddress: string; attributes: Record<string, string> };
    assert.equal(body.name, "Receipt: Solana Hacker Hoodie");
    assert.equal(body.receiverAddress, BUYER);
    assert.deepEqual(Object.keys(body.attributes), ["Price", "TxSignature", "Timestamp", "Order"]);

    const receipt = (await store.get(invoice.reference))?.receipt;
    assert.equal(receipt?.status, "minted");
    assert.equal(receipt?.mintAddress, "AssetMint111");
    assert.equal(receipt?.transactionId, "tx-1");
  });

  it("retries a server error later, and fails for good on a request Underdog refuses", async () => {
    const retry = await paidOrder(store);
    globalThis.fetch = (async () => new Response("upstream down", { status: 503 })) as typeof fetch;
    await minter({ apiKey: "key-1", projectId: "3" }).run();
    const retrying = (await store.get(retry.reference))?.receipt;
    assert.equal(retrying?.status, "pending");
    assert.equal(retrying?.attempts, 1);
    assert.ok((retrying?.nextAttemptAt ?? 0) > Date.now());
    assert.match(retrying?.note ?? "", /HTTP 503/);

    const refused = await paidOrder(store);
    globalThis.fetch = (async () => new Response('{"message":"image must be a URL"}', { status: 400 })) as typeof fetch;
    await minter({ apiKey: "key-1", projectId: "3" }).run();
    const failed = (await store.get(refused.reference))?.receipt;
    assert.equal(failed?.status, "failed");
    assert.match(failed?.note ?? "", /HTTP 400/);
  });

  it("simulates a sale on another network than the key mints on", async () => {
    globalThis.fetch = () => assert.fail("a devnet key never mints a mainnet sale");
    const invoice = await paidOrder(store, { network: "mainnet-beta" });
    await minter({ apiKey: "key-1", projectId: "3", network: "devnet" }).run();
    const receipt = (await store.get(invoice.reference))?.receipt;
    assert.equal(receipt?.status, "simulated");
    assert.match(receipt?.note ?? "", /Mainnet Beta/);
  });
});
