import { NETWORKS } from "@/lib/network";
import type { PriceQuote } from "@/lib/price";

import { rpcEndpoint } from "./config";

// Live USD prices from Pyth's on-chain price feeds on Solana mainnet (sponsored PriceUpdateV2 accounts), read with
// a plain getAccountInfo. Pyth's Hermes HTTP API wants an API key; the accounts don't, and each read is checked:
// owned by Pyth's receiver program, fully verified, and carrying the feed id it should.

const RECEIVER_PROGRAM = "rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ";

const FEEDS = {
  "SOL/USD": { account: "7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE", feedId: "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d" },
  "USDC/USD": { account: "Dpw1EAVrSB1ibxiDQyTAW6Zip3J4Btk2x4SgApQCeFbX", feedId: "eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a" },
} as const;

type Pair = keyof typeof FEEDS;

/** A quote older than this is refused rather than shown: the feed has stopped updating. */
const MAX_AGE_MS = 5 * 60_000;
/** Reads are cached this long, so any number of checkout pages cost one RPC call per interval. */
const CACHE_MS = 15_000;

interface FeedPrice {
  price: number;
  confidence: number;
  publishTime: number;
}

/** Decodes a PriceUpdateV2 account: discriminator, write authority, verification level, then the price message. */
function decode(data: Buffer, expectedFeedId: string): FeedPrice {
  let offset = 8 + 32;
  const level = data.readUInt8(offset);
  // 0 = Partial { num_signatures: u8 }, 1 = Full. Only fully verified updates are trusted.
  if (level !== 1) throw new Error("price update isn't fully verified");
  offset += 1;
  const feedId = data.subarray(offset, offset + 32).toString("hex");
  if (feedId !== expectedFeedId) throw new Error("unexpected feed id");
  offset += 32;
  const price = data.readBigInt64LE(offset);
  const confidence = data.readBigUInt64LE(offset + 8);
  const exponent = data.readInt32LE(offset + 16);
  const publishTime = Number(data.readBigInt64LE(offset + 20)) * 1000;
  return { price: Number(price) * 10 ** exponent, confidence: Number(confidence) * 10 ** exponent, publishTime };
}

async function readFeeds(): Promise<Record<Pair, FeedPrice>> {
  const pairs = Object.keys(FEEDS) as Pair[];
  const response = await fetch(rpcEndpoint(NETWORKS["mainnet-beta"].id), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getMultipleAccounts",
      params: [pairs.map((pair) => FEEDS[pair].account), { encoding: "base64", commitment: "confirmed" }],
    }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`RPC answered ${response.status}`);
  const body = (await response.json()) as { result?: { value: Array<{ owner: string; data: [string, string] } | null> } };
  const accounts = body.result?.value;
  if (!accounts) throw new Error("RPC returned no accounts");

  const prices = {} as Record<Pair, FeedPrice>;
  pairs.forEach((pair, index) => {
    const account = accounts[index];
    if (!account || account.owner !== RECEIVER_PROGRAM) throw new Error(`${pair} feed account is missing or not Pyth's`);
    const decoded = decode(Buffer.from(account.data[0], "base64"), FEEDS[pair].feedId);
    if (Date.now() - decoded.publishTime > MAX_AGE_MS) throw new Error(`${pair} price is stale`);
    prices[pair] = decoded;
  });
  return prices;
}

const CACHE = Symbol.for("solagent-pay.pyth-cache");
type Cache = { at: number; quote: Promise<PriceQuote> };

/** SOL and USDC in US dollars, from Pyth, at most CACHE_MS old (plus the feed's own publish delay). */
export function solUsdQuote(): Promise<PriceQuote> {
  const holder = globalThis as typeof globalThis & { [CACHE]?: Cache };
  const cached = holder[CACHE];
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.quote;
  const quote = readFeeds().then((prices) => ({
    solUsd: prices["SOL/USD"].price,
    solUsdConfidence: prices["SOL/USD"].confidence,
    usdcUsd: prices["USDC/USD"].price,
    publishTime: Math.min(prices["SOL/USD"].publishTime, prices["USDC/USD"].publishTime),
    fetchedAt: Date.now(),
    source: "Pyth Network (Solana mainnet)",
  }));
  holder[CACHE] = { at: Date.now(), quote };
  // A failed read isn't cached: the next request tries again.
  quote.catch(() => {
    if (holder[CACHE]?.quote === quote) delete holder[CACHE];
  });
  return quote;
}
