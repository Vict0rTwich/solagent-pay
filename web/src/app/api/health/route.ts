import { json } from "@/server/http";
import { paymentRuntime } from "@/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Payment listener health: socket state per network, invoices by status, webhook backlog, RPC retries. */
export async function GET(): Promise<Response> {
  const payments = paymentRuntime();
  await payments.start();
  return json(await payments.stats());
}
