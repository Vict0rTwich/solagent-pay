"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, CircleAlert } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/cn";

// One toast at a time, bottom-center above the event stream bar. `toast()` works from anywhere on the client;
// <Toaster /> (in the dashboard shell) shows it. Announced politely to screen readers.

export type ToastTone = "success" | "error";

interface ToastMessage {
  id: number;
  text: string;
  tone: ToastTone;
}

const TOAST_EVENT = "solagent:toast";
const SHOW_MS = 3_200;
let nextId = 1;

export function toast(text: string, tone: ToastTone = "success"): void {
  window.dispatchEvent(new CustomEvent<ToastMessage>(TOAST_EVENT, { detail: { id: nextId++, text, tone } }));
}

export function Toaster() {
  const [current, setCurrent] = useState<ToastMessage | null>(null);

  useEffect(() => {
    const onToast = (event: Event) => setCurrent((event as CustomEvent<ToastMessage>).detail);
    window.addEventListener(TOAST_EVENT, onToast);
    return () => window.removeEventListener(TOAST_EVENT, onToast);
  }, []);

  useEffect(() => {
    if (!current) return;
    const timer = setTimeout(() => setCurrent(null), SHOW_MS);
    return () => clearTimeout(timer);
  }, [current]);

  const Icon = current?.tone === "error" ? CircleAlert : Check;
  return (
    <div aria-live="polite" role="status" className="pointer-events-none fixed inset-x-0 bottom-14 z-50 flex justify-center px-4 lg:left-60">
      <AnimatePresence>
        {current && (
          <motion.p
            key={current.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
            className="popover flex items-center gap-2 px-3 py-2 text-[13px] text-ink"
          >
            <Icon className={cn("size-4 shrink-0", current.tone === "error" ? "text-danger" : "text-success")} aria-hidden />
            {current.text}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}
