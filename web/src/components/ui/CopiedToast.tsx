"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, Copy } from "lucide-react";

import { cn } from "@/lib/cn";

/**
 * A small "Copied" tooltip above whatever copied. Put it inside a `relative` element. Announced politely to screen
 * readers.
 */
export function CopiedToast({ show, label = "Copied", className }: { show: boolean; label?: string; className?: string }) {
  return (
    <span aria-live="polite" className="contents">
      <AnimatePresence>
        {show && (
          <motion.span
            role="status"
            initial={{ opacity: 0, y: 4, x: "-50%" }}
            animate={{ opacity: 1, y: 0, x: "-50%" }}
            exit={{ opacity: 0, y: -2, x: "-50%" }}
            transition={{ duration: 0.14, ease: "easeOut" }}
            className={cn(
              "popover pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 inline-flex items-center gap-1.5 whitespace-nowrap px-2 py-1 text-[11px] font-medium text-ink",
              className,
            )}
          >
            <Check className="size-3 text-success" strokeWidth={3} aria-hidden />
            {label}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

/** Copy icon that crossfades to a check, and back. */
export function CopyIcon({ copied, className }: { copied: boolean; className?: string }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.span
        key={copied ? "copied" : "copy"}
        initial={{ scale: 0.7, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.7, opacity: 0 }}
        transition={{ duration: 0.12, ease: "easeOut" }}
        className="grid place-items-center"
      >
        {copied ? <Check className={cn("size-4", className)} strokeWidth={2.5} aria-hidden /> : <Copy className={cn("size-4", className)} aria-hidden />}
      </motion.span>
    </AnimatePresence>
  );
}
