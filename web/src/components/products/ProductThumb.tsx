"use client";

import { useState } from "react";

import { cn } from "@/lib/cn";

// A product without a picture (or whose picture won't load) gets a monogram tile in one of the metric cards' tints,
// picked from its title so the same product always looks the same.
const TINTS = [
  "border-blue-900/60 bg-blue-950/50 text-blue-300 light:border-blue-200 light:bg-blue-50 light:text-blue-700",
  "border-purple-900/60 bg-purple-950/50 text-purple-300 light:border-purple-200 light:bg-purple-50 light:text-purple-700",
  "border-amber-900/60 bg-amber-950/40 text-amber-300 light:border-amber-200 light:bg-amber-50 light:text-amber-700",
  "border-emerald-900/60 bg-emerald-950/40 text-emerald-300 light:border-emerald-200 light:bg-emerald-50 light:text-emerald-700",
] as const;

function tintFor(title: string): string {
  let hash = 0;
  for (const char of title) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return TINTS[hash % TINTS.length] ?? TINTS[0];
}

/** "Solana Hacker Hoodie" -> "SH". */
function monogram(title: string): string {
  const letters = title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "");
  return letters.join("") || "?";
}

/**
 * The product's image, cropped square, or its monogram tile. Decorative: the title is always shown beside it. The
 * image is the merchant's own URL, loaded without a referrer. Border colors are set here; callers pick the width
 * (`border`, `border-b`), since cn doesn't merge conflicting utilities.
 */
export function ProductThumb({ title, image, className }: { title: string; image: string | null; className?: string }) {
  const [broken, setBroken] = useState<string | null>(null);
  if (image && broken !== image) {
    // A plain <img>: the host is whatever the merchant pasted, and next/image only loads hosts listed in its config.
    return (
      <img
        src={image}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setBroken(image)}
        className={cn("shrink-0 border-line bg-raised object-cover", className)}
      />
    );
  }
  return (
    <span aria-hidden className={cn("grid shrink-0 select-none place-items-center font-mono font-semibold tracking-[-0.02em]", tintFor(title), className)}>
      {monogram(title)}
    </span>
  );
}
