import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * One-time entrance for page sections, staggered by `index`. Pure CSS (see `.reveal` in globals.css),
 * so server-rendered content is never stuck invisible waiting for JavaScript.
 */
export function Reveal({ index = 0, className, children }: { index?: number; className?: string; children: ReactNode }) {
  return (
    <div className={cn("reveal", className)} style={{ "--reveal-delay": `${20 + index * 40}ms` } as CSSProperties}>
      {children}
    </div>
  );
}
