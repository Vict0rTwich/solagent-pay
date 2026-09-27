import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DAY_MS, LEDGER_DAYS, createDemoData } from "@/lib/demo-data";
import { buildSeries, invoiceStatus, splitRange } from "@/lib/metrics";

// Anchors across the calendar, including one minute past UTC midnight (today has barely begun) and a year boundary.
const ANCHORS = [
  Date.UTC(2026, 8, 25, 13, 4),
  Date.UTC(2027, 2, 10, 0, 1),
  Date.UTC(2026, 11, 31, 23, 59),
  Date.UTC(2027, 0, 1, 8, 30),
];

const iso = (ms: number) => new Date(ms).toISOString();

describe("sample data anchored to now", () => {
  for (const now of ANCHORS) {
    it(`dates every record in the 30 days up to ${iso(now)}`, () => {
      const demo = createDemoData(now);
      const earliest = now - LEDGER_DAYS * DAY_MS;
      const inWindow = (label: string, ms: number | undefined) => {
        if (ms === undefined) return;
        assert.ok(ms >= earliest && ms <= now, `${label} ${iso(ms)} is outside ${iso(earliest)} … ${iso(now)}`);
      };

      assert.ok(demo.ledger.length > 100);
      for (const tx of demo.ledger) inWindow(`tx ${tx.signature?.slice(0, 8)}`, tx.createdAt);
      for (const invoice of demo.invoices) {
        inWindow(`${invoice.id} created`, invoice.createdAt);
        inWindow(`${invoice.id} paid`, invoice.paidAt);
        inWindow(`${invoice.id} receipt`, invoice.receipt?.mintedAt ?? undefined);
        if (invoice.paidAt !== undefined) assert.ok(invoice.createdAt <= invoice.paidAt, `${invoice.id} was paid before it was sent`);
      }
      for (const agent of demo.agents) inWindow(agent.name, agent.createdAt);
      for (const product of demo.products) inWindow(product.title, product.createdAt);

      // Totals before the itemized window are totals only, and end where the itemized days begin.
      const firstLedgerDay = demo.today - (LEDGER_DAYS - 1) * DAY_MS;
      assert.ok(demo.history.every((day) => day.day < firstLedgerDay));
    });
  }

  it("builds the same data from the same anchor, so server and browser renders match", () => {
    const [first, second] = ANCHORS as [number, number];
    const snapshot = JSON.stringify(createDemoData(first));
    createDemoData(second);
    assert.equal(JSON.stringify(createDemoData(first)), snapshot);
  });

  it("puts every itemized payment in the last-30-days range, and the prior period in the totals", () => {
    const demo = createDemoData(Date.UTC(2026, 8, 25, 13, 4));
    const series = buildSeries(demo.history, demo.ledger, demo.today, LEDGER_DAYS);
    const { current, previous } = splitRange(series, 30);
    assert.equal(current[0]?.day, demo.today - 29 * DAY_MS);
    assert.equal(current.at(-1)?.day, demo.today);
    const settled = demo.ledger.filter((tx) => tx.status === "confirmed").length;
    assert.equal(current.reduce((sum, day) => sum + day.count, 0), settled, "the 30-day volume counts every settled payment");
    assert.equal(previous.length, 30, "the prior 30 days exist, so the volume card's trend can compare");
  });

  it("keeps open invoices open and old ones expired, relative to now", () => {
    const now = Date.UTC(2027, 2, 10, 0, 1);
    const demo = createDemoData(now);
    const unpaid = demo.invoices.filter((invoice) => invoice.paidAt === undefined);
    assert.equal(unpaid.filter((invoice) => invoiceStatus(invoice, now) === "pending").length, 7);
    assert.equal(unpaid.filter((invoice) => invoiceStatus(invoice, now) === "expired").length, 4);
  });

  it("dates memos by the anchor, not a fixed month", () => {
    const memos = createDemoData(Date.UTC(2027, 2, 10, 12, 0))
      .invoices.map((invoice) => invoice.memo)
      .join("\n");
    assert.match(memos, /Validator monitoring — March/);
    assert.match(memos, /Tasting menu · Mar 10/);
    assert.match(memos, /Event deposit — Feb 26/);
    assert.doesNotMatch(memos, /Sept|September|October|Oct 4/);
  });

  for (const now of ANCHORS) {
    it(`names no day in a memo after ${iso(now)}, or before the window`, () => {
      const demo = createDemoData(now);
      const year = new Date(now).getUTCFullYear();
      const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const texts = [...demo.ledger.map((tx) => tx.memo), ...demo.invoices.map((invoice) => invoice.memo)];
      for (const text of texts) {
        for (const [, month = "", day = ""] of text.matchAll(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2})\b/g)) {
          // A named day is in the anchor's year, or the one before it across New Year.
          const named = [year, year - 1].map((y) => Date.UTC(y, months.indexOf(month), Number(day))).find((ms) => ms <= now);
          assert.ok(named !== undefined && named >= demo.today - LEDGER_DAYS * DAY_MS, `"${text}" names a day outside the window`);
        }
      }
    });
  }
});
