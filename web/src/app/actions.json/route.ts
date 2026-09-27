import { actionJson, actionPreflight } from "@/server/actions";

// Tells Actions clients which URLs on this site are Solana Actions. Served at /actions.json (where the spec says
// clients look) and at /.well-known/actions.json (a rewrite in next.config.ts).

// Dynamic so every response carries the CORS headers Actions clients check.
export const dynamic = "force-dynamic";

export function GET(): Response {
  return actionJson({
    rules: [
      // Checkout links: /pay?recipient=…&reference=<key>&… (the query is passed along to the action).
      { pathPattern: "/pay", apiPath: "/api/actions/pay" },
      // The action URLs themselves.
      { pathPattern: "/api/actions/**", apiPath: "/api/actions/**" },
    ],
  });
}

export function OPTIONS(): Response {
  return actionPreflight();
}
