"use client";

import { QRCodeSVG } from "qrcode.react";

/**
 * Solana Pay QR for a payment link. Dark modules on white in both themes: wallet scanners read that most reliably.
 */
export function PaymentQr({
  url,
  label,
  size = 168,
  caption = "Scan with any Solana wallet to pay",
}: {
  url: string;
  label: string;
  size?: number;
  /** Null for none. */
  caption?: string | null;
}) {
  return (
    <figure className="flex flex-col items-center gap-2.5">
      <div className="rounded-lg border border-line bg-white p-3">
        <QRCodeSVG value={url} size={size} level="M" marginSize={0} bgColor="#ffffff" fgColor="#0a0b0f" title={label} />
      </div>
      {caption && <figcaption className="text-xs text-ink-3">{caption}</figcaption>}
    </figure>
  );
}
