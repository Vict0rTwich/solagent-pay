import { allow, clientIp, error, json, tooManyRequests } from "@/server/http";
import { solUsdQuote } from "@/server/pyth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** SOL/USD and USDC/USD from Pyth's on-chain feeds, cached 15 s. Public: it's market data, nothing merchant-specific. */
export async function GET(request: Request): Promise<Response> {
  if (!allow(`price:${clientIp(request)}`, 120)) return tooManyRequests();
  try {
    return json(await solUsdQuote(), 200, { "cache-control": "public, max-age=10" });
  } catch (caught) {
    const reason = caught instanceof Error ? caught.message : String(caught);
    return error(502, `Couldn't read the price feed: ${reason}`);
  }
}
