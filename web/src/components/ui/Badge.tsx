import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

export type Tone = "success" | "warning" | "danger" | "neutral";

// Muted fill, hairline border, solid text: emerald / amber / red / slate (see the status tokens in globals.css).
const TONES: Record<Tone, string> = {
  success: "border-success-line bg-success-bg text-success",
  warning: "border-warning-line bg-warning-bg text-warning",
  danger: "border-danger-line bg-danger-bg text-danger",
  neutral: "border-idle-line bg-idle-bg text-idle",
};

/** Status pill. The label carries the meaning; the dot (or icon) and color only confirm it. */
export function Badge({
  tone,
  icon: Icon,
  children,
  className,
}: {
  tone: Tone;
  /** Replaces the dot, e.g. a pause glyph. */
  icon?: LucideIcon;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1.5 whitespace-nowrap rounded-full border px-2 font-mono text-[11px] font-medium leading-none",
        TONES[tone],
        className,
      )}
    >
      {Icon ? (
        <Icon className="size-3 shrink-0" strokeWidth={2.25} aria-hidden />
      ) : (
        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />
      )}
      {children}
    </span>
  );
}
