"use client";

import { useCopy } from "@/hooks/use-copy";
import { cn } from "@/lib/cn";

import { CopiedToast, CopyIcon } from "./CopiedToast";

/** Copies `text`: the icon flips to a check and a "Copied" bubble pops up, so people know it worked. */
export function CopyButton({
  text,
  label,
  copiedLabel = "Copied",
  disabled = false,
  disabledReason,
  className,
}: {
  text: string;
  /** Accessible name, e.g. "Copy payment link". */
  label: string;
  copiedLabel?: string;
  disabled?: boolean;
  disabledReason?: string;
  className?: string;
}) {
  const { copied, copy } = useCopy();
  const name = disabled && disabledReason ? disabledReason : label;

  return (
    <button
      type="button"
      onClick={() => void copy(text)}
      disabled={disabled}
      aria-label={name}
      title={name}
      className={cn(
        "relative grid shrink-0 place-items-center rounded-md transition-colors hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-ink-3",
        // cn doesn't merge conflicting utilities, so the default size only applies when the caller sets none.
        className?.includes("size-") ? undefined : "size-8",
        copied ? "text-success" : "text-accent-ink/70 hover:text-accent-ink",
        className,
      )}
    >
      <CopyIcon copied={copied} />
      <CopiedToast show={copied} label={copiedLabel} />
    </button>
  );
}
