"use client";

import { AnimatePresence, motion } from "framer-motion";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { Toaster } from "@/components/ui/Toaster";

import { DevLogDrawer } from "./DevLogDrawer";
import { Header } from "./Header";
import { POS_PATH } from "./nav";
import { PaymentCelebrations } from "./PaymentCelebrations";
import { Sidebar } from "./Sidebar";

/**
 * Sidebar + sticky header around every dashboard route; the sidebar becomes a drawer below `lg`. The PoS register
 * gets the whole screen instead, keeping only payment celebrations and toasts.
 */
export function DashboardShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);

  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  if (pathname === POS_PATH) {
    return (
      <>
        {children}
        <PaymentCelebrations />
        <Toaster />
      </>
    );
  }

  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 border-r border-line bg-canvas lg:block">
        <Sidebar />
      </aside>

      <AnimatePresence>
        {menuOpen && (
          <>
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.16 }}
              onClick={closeMenu}
              className="fixed inset-0 z-40 bg-[var(--scrim)] lg:hidden"
              aria-hidden
            />
            <motion.aside
              key="drawer"
              role="dialog"
              aria-modal="true"
              aria-label="Navigation"
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 520, damping: 50 }}
              className="fixed inset-y-0 left-0 z-50 w-[min(17rem,85vw)] border-r border-line-strong bg-canvas lg:hidden"
            >
              <Sidebar variant="drawer" onNavigate={closeMenu} onClose={closeMenu} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <div className="flex min-w-0 flex-1 flex-col">
        <Header onOpenMenu={() => setMenuOpen(true)} />
        {/* Bottom padding clears the event stream bar pinned below. */}
        <main className="flex-1 px-4 pb-20 pt-6 sm:px-6 lg:px-8 lg:pt-8">{children}</main>
      </div>

      <DevLogDrawer />
      <PaymentCelebrations />
      <Toaster />
    </div>
  );
}
