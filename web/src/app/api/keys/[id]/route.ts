import { toKeySummary, utcDay } from "@/server/auth/api-keys";
import { requireMerchant } from "@/server/auth/session";
import { allow, clientIp, error, json, tooManyRequests } from "@/server/http";
import { paymentRuntime } from "@/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Revokes one of the signed-in merchant's keys, at once: its next request is refused. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!allow(`keys-revoke:${clientIp(request)}`, 30)) return tooManyRequests();
  const { store } = paymentRuntime();
  const merchant = await requireMerchant(request, store);
  if (merchant instanceof Response) return merchant;
  const { id } = await params;

  const revoked = await store.revokeApiKey(id, merchant.address);
  if (!revoked) return error(404, "You have no API key with that id.");
  const volume = await store.keyVolume([revoked.id], utcDay());
  return json({ apiKey: toKeySummary(revoked, volume[revoked.id] ?? 0) });
}
