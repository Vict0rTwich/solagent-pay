import { randomBase58 } from "@/lib/base58";
import { currencyMint, isCurrency, parseAmount } from "@/lib/currency";
import type { CreateProductRequest } from "@/lib/invoice-api";
import { NETWORKS, isNetworkId } from "@/lib/network";
import { parseProductInfo } from "@/lib/products";
import type { Product } from "@/lib/types";
import { requireMerchant } from "@/server/auth/session";
import { serverConfig } from "@/server/config";
import { allow, clientIp, error, guarded, isAddress, json, readJson, tooManyRequests } from "@/server/http";
import { paymentRuntime } from "@/server/runtime";
import { isStoreError } from "@/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseCreate(body: unknown): CreateProductRequest | string {
  if (!body || typeof body !== "object") return "Send a JSON body.";
  const input = body as Record<string, unknown>;
  if (!isNetworkId(input.network)) return "network must be devnet, localnet or mainnet-beta.";
  if (!isAddress(input.merchant)) return "merchant must be a Solana address.";
  const info = parseProductInfo({ title: input.title, description: input.description, image: input.image ?? null });
  if (!info.ok) return info.error;
  if (!isCurrency(input.currency)) return 'currency must be "USDC" or "SOL".';
  if (typeof input.amount !== "string") return `amount must be a decimal string in ${input.currency}, like "24.5".`;
  const amount = parseAmount(input.amount, input.currency);
  if (!amount.ok) return amount.error;
  return { network: input.network, merchant: input.merchant, ...info.info, currency: input.currency, amount: amount.amount };
}

/**
 * Lists a product for sale: signed-in merchants only (SIWS), and it pays the wallet they're signed in with. The
 * product's Blink (/api/actions/product/<id>) takes orders from then on, one invoice per purchase.
 */
async function handlePost(request: Request): Promise<Response> {
  if (!allow(`product-create:${clientIp(request)}`, 30)) return tooManyRequests();
  const runtime = paymentRuntime();
  const session = await requireMerchant(request, runtime.store);
  if (session instanceof Response) return session;

  const input = parseCreate(await readJson(request));
  if (typeof input === "string") return error(400, input);
  if (input.merchant !== session.address) return error(403, "A product's sales can only pay the wallet you're signed in with.");

  const product: Product = {
    id: `prod_${randomBase58(9)}`,
    network: input.network,
    merchant: input.merchant,
    title: input.title,
    description: input.description,
    image: input.image,
    // The mint comes from the network, never from the caller, like an invoice's.
    mint: currencyMint(input.currency, NETWORKS[input.network]),
    amount: input.amount,
    createdAt: Date.now(),
    archivedAt: null,
  };
  try {
    await runtime.store.createProduct(product, serverConfig.maxProductsPerMerchant);
  } catch (caught) {
    if (isStoreError(caught, "too_many_products")) return error(409, caught.message);
    throw caught;
  }
  return json({ product }, 201);
}

/** The signed-in merchant's products on sale on ?network=, newest first. */
async function handleGet(request: Request): Promise<Response> {
  if (!allow(`product-list:${clientIp(request)}`, 120)) return tooManyRequests();
  const runtime = paymentRuntime();
  const session = await requireMerchant(request, runtime.store);
  if (session instanceof Response) return session;
  const network = new URL(request.url).searchParams.get("network");
  if (!isNetworkId(network)) return error(400, "Pass ?network=devnet, localnet or mainnet-beta.");
  return json({ products: await runtime.store.listProducts(session.address, network) });
}

export const POST = guarded(handlePost);

export const GET = guarded(handleGet);
