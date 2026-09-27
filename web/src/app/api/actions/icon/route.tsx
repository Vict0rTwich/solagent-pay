import { ImageResponse } from "next/og";

import { actionHeaders } from "@/server/actions";

export const runtime = "nodejs";

const SIZE = 1200;

/** Square card image for Solana Action (Blink) cards: the gateway's mark and the token the invoice is paid in. */
export function GET(request: Request): ImageResponse {
  const currency = new URL(request.url).searchParams.get("currency") === "SOL" ? "SOL" : "USDC";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 96,
          background: "#0b1121",
          color: "#e8edf7",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <div
            style={{
              width: 88,
              height: 88,
              borderRadius: 20,
              background: "#2563eb",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="52" height="52" viewBox="0 0 32 32">
              <path d="M17.5 6 9 18h6l-1.5 8L22 14h-6z" fill="#ffffff" />
            </svg>
          </div>
          <div style={{ display: "flex", fontSize: 60, fontWeight: 600, letterSpacing: -2 }}>
            SolAgent<span style={{ color: "#7b8daf", fontWeight: 400 }}>&nbsp;Pay</span>
          </div>
        </div>

        <div
          style={{
            width: 440,
            height: 440,
            borderRadius: 999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            alignSelf: "center",
            background: currency === "SOL" ? "#131b2f" : "#2775CA",
            border: currency === "SOL" ? "4px solid #2e3d61" : "16px solid rgba(255,255,255,0.28)",
          }}
        >
          {currency === "SOL" ? (
            <svg width="360" height="360" viewBox="0 0 32 32">
              <path d="M10 9.4h14.6l-2.6 2.9H7.4z" fill="#f4f4f5" />
              <path d="M7.4 14.55H22l2.6 2.9H10z" fill="#f4f4f5" />
              <path d="M10 19.7h14.6l-2.6 2.9H7.4z" fill="#f4f4f5" />
            </svg>
          ) : (
            <div style={{ display: "flex", fontSize: 280, fontWeight: 700, color: "#ffffff", lineHeight: 1 }}>$</div>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", borderTop: "2px solid #222f4d", paddingTop: 40 }}>
          <div style={{ display: "flex", fontSize: 44, color: "#a3b1cc" }}>{currency === "SOL" ? "Pay in native SOL" : "Pay in USDC"}</div>
          <div style={{ display: "flex", fontSize: 36, color: "#60a5fa" }}>Solana Pay invoice</div>
        </div>
      </div>
    ),
    {
      width: SIZE,
      height: SIZE,
      headers: { ...actionHeaders(), "cache-control": "public, max-age=86400, immutable" },
    },
  );
}
