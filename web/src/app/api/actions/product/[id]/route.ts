import { actionPreflight, getProductAction, postProductAction } from "@/server/actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Solana Action for one product: GET the card, POST { account } to open an order and get its transaction. */
export async function GET(request: Request, { params }: Params): Promise<Response> {
  return getProductAction(request, (await params).id);
}

export async function POST(request: Request, { params }: Params): Promise<Response> {
  return postProductAction(request, (await params).id);
}

export function OPTIONS(): Response {
  return actionPreflight();
}
