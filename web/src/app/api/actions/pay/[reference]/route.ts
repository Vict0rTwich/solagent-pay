import { actionPreflight, getPayAction, postPayAction } from "@/server/actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ reference: string }> };

/** Solana Action for one invoice: GET the card, POST { account } for the transaction. */
export async function GET(request: Request, { params }: Params): Promise<Response> {
  return getPayAction(request, (await params).reference);
}

export async function POST(request: Request, { params }: Params): Promise<Response> {
  return postPayAction(request, (await params).reference);
}

export function OPTIONS(): Response {
  return actionPreflight();
}
