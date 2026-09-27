import { actionPreflight, getPayAction, postPayAction } from "@/server/actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Where actions.json sends checkout links: a blink client that finds /pay?…&reference=<key> comes here with the same
// query, so a checkout link shared anywhere unfurls as a blink, not only the /api/actions/pay/<reference> form.

const reference = (request: Request) => new URL(request.url).searchParams.get("reference");

export function GET(request: Request): Promise<Response> {
  return getPayAction(request, reference(request));
}

export function POST(request: Request): Promise<Response> {
  return postPayAction(request, reference(request));
}

export function OPTIONS(): Response {
  return actionPreflight();
}
