// Runs once when the Next.js server starts: begins watching open invoices and delivering webhooks right away,
// rather than on the first API request. Needs a long-running server (`next start`, or `next dev`); on
// serverless hosts nothing stays up to listen, though the verify endpoint still settles invoices on demand.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { paymentRuntime } = await import("./server/runtime");
  await paymentRuntime()
    .start()
    .catch((error: unknown) => console.error("[solagent-pay] payment listener failed to start:", error));
}
