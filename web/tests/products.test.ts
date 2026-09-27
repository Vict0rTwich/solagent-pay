import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { pressKey, trimDecimals, type KeypadKey } from "@/components/pos/Keypad";
import { recentActivity } from "@/lib/metrics";
import { USDC_MINT_DEVNET } from "@/lib/network";
import { parseImageUrl, parseProductInfo, receiptName } from "@/lib/products";
import type { Invoice, LedgerTx, Receipt } from "@/lib/types";

describe("product listing rules", () => {
  it("takes only https image links, and none at all", () => {
    assert.deepEqual(parseImageUrl(""), { ok: true, image: null });
    assert.deepEqual(parseImageUrl(" https://cdn.example.com/hoodie.png "), { ok: true, image: "https://cdn.example.com/hoodie.png" });
    assert.equal(parseImageUrl("http://cdn.example.com/hoodie.png").ok, false);
    assert.equal(parseImageUrl("hoodie.png").ok, false);
    assert.equal(parseImageUrl("https://user:pass@cdn.example.com/a.png").ok, false);
  });

  it("needs a title, and names the field that's wrong", () => {
    const missing = parseProductInfo({ title: "  ", description: "", image: null });
    assert.equal(missing.ok, false);
    assert.equal(!missing.ok && missing.field, "title");
    const tooLong = parseProductInfo({ title: "Hoodie", description: "x".repeat(281), image: null });
    assert.equal(!tooLong.ok && tooLong.field, "description");
    assert.deepEqual(parseProductInfo({ title: " Hoodie ", description: " Fleece ", image: "" }), {
      ok: true,
      info: { title: "Hoodie", description: "Fleece", image: null },
    });
  });

  it("cuts receipt names to Underdog's 32 characters", () => {
    assert.equal(receiptName("Solana Hacker Hoodie"), "Receipt: Solana Hacker Hoodie");
    const long = receiptName("Limited Edition Breakpoint Lisbon Hoodie");
    assert.equal(long.length, 32);
    assert.ok(long.endsWith("…"));
  });
});

describe("PoS keypad", () => {
  const type = (keys: string, decimals = 2) => [...keys].reduce((entry, key) => pressKey(entry, (key === "<" ? "back" : key) as KeypadKey, decimals), "");

  it("builds amounts the way a till does", () => {
    assert.equal(type("0"), "0");
    assert.equal(type("05"), "5", "no leading zeros");
    assert.equal(type(".5"), "0.5");
    assert.equal(type("24.5.0"), "24.50", "one decimal point");
    assert.equal(type("24.505"), "24.50", "no more decimals than the currency takes");
    assert.equal(type("24.50<<"), "24.");
    assert.equal(type("123456789"), "1234567", "seven whole digits at most");
    assert.equal(type("0.1234", 4), "0.1234");
  });

  it("drops extra decimals when switching currency", () => {
    assert.equal(trimDecimals("1.2345", 2), "1.23");
    assert.equal(trimDecimals("12", 2), "12");
  });
});

describe("overview feed with receipts", () => {
  const receipt: Receipt = { status: "minted", owner: "Buyer1111", mintAddress: "Asset1111", mintedAt: 2_000, note: null };
  const base = {
    kind: "link" as const,
    client: "",
    memo: "Solana Hacker Hoodie",
    recipient: "Merchant111",
    reference: "Ref",
    paymentUrl: "solana:Merchant111",
    createdAt: 1_000,
    expiresAt: 10_000_000,
    product: { title: "Solana Hacker Hoodie", description: "", image: null },
    productId: "prod_TestHoodie1",
  };

  it("puts the buyer's receipt on the ledger row that settled the order", () => {
    const invoice: Invoice = { ...base, id: "INV-1", amount: "45", mint: USDC_MINT_DEVNET, paidAt: 1_500, signature: "SigUsdc", receipt };
    const tx: LedgerTx = { signature: "SigUsdc", createdAt: 1_500, senderName: "Solana Hacker Hoodie", wallet: "Buyer1111", type: "link", amountCents: 4500, status: "confirmed", memo: "Order INV-1", invoiceId: "INV-1" };
    const rows = recentActivity([tx], [invoice], 0, 5_000);
    assert.equal(rows.length, 1, "the ledger row stands for the paid order: no duplicate");
    assert.deepEqual(rows[0]?.receipt, receipt);
  });

  it("lists a paid order the USDC ledger doesn't (a SOL sale), labeled by its product", () => {
    const sol: Invoice = { ...base, id: "INV-2", reference: "Ref2", amount: "0.05", mint: null, paidAt: 2_500, signature: "SigSol", payer: "Buyer1111", receipt };
    const [row] = recentActivity([], [sol], 0, 5_000);
    assert.equal(row?.status, "paid");
    assert.equal(row?.client, "Solana Hacker Hoodie");
    assert.equal(row?.memo, "Order INV-2");
    assert.equal(row?.wallet, "Buyer1111");
    assert.deepEqual(row?.amount, { currency: "SOL", amount: "0.05" });
    assert.deepEqual(row?.receipt, receipt);
  });
});
