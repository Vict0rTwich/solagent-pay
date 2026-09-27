import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BUSINESS_TIME_ZONE, formatUtc, formatZoned, zonedTime } from "@/lib/time-zones";

describe("Nigeria time beside UTC", () => {
  it("shows West Africa Time, one hour ahead of UTC", () => {
    const ms = Date.UTC(2026, 8, 25, 13, 2);
    assert.equal(formatUtc(ms), "Sep 25, 13:02 UTC");
    assert.equal(formatZoned(ms, BUSINESS_TIME_ZONE), "14:02 WAT");
    assert.equal(zonedTime(ms, BUSINESS_TIME_ZONE).zoneName, "West Africa Standard Time");
  });

  it("names the day when Lagos is already past midnight", () => {
    assert.equal(formatZoned(Date.UTC(2026, 8, 25, 23, 30), BUSINESS_TIME_ZONE), "Sep 26, 00:30 WAT");
  });

  it("formats other zones by their own rules", () => {
    const ms = Date.UTC(2026, 0, 15, 13, 2);
    assert.equal(formatZoned(ms, { id: "America/New_York", locale: "en-US", place: "New York" }), "08:02 EST");
    assert.equal(formatZoned(ms, { id: "Asia/Kolkata", locale: "en-US", place: "Kolkata" }), "18:32 GMT+5:30");
  });
});
