"use client";

import { useEffect, useState, type CSSProperties } from "react";

/** How long the splash holds before it fades, and how long the fade takes. */
const HOLD_MS = 1_800;
const FADE_MS = 450;

/**
 * The first thing a full page load shows: the SolAgent Pay mark, pulsing, over the midnight canvas, while the app
 * loads underneath. It's server-rendered, so it's there from the first paint, and the fade-out is a CSS animation
 * (see .splash in globals.css), so it lifts even before (or without) JavaScript. React only removes it from the
 * page once it has faded. Client-side navigation keeps the root layout mounted, so it never shows again until a
 * reload.
 */
export function SplashScreen() {
  const [shown, setShown] = useState(true);

  // animationend removes it right after the fade; this timer covers browsers where animations don't run (a
  // background tab, animations disabled), so it's never left in the page.
  useEffect(() => {
    const timer = setTimeout(() => setShown(false), HOLD_MS + FADE_MS + 250);
    return () => clearTimeout(timer);
  }, []);

  if (!shown) return null;

  return (
    <div
      aria-hidden
      className="splash"
      style={{ "--splash-hold": `${HOLD_MS}ms`, "--splash-fade": `${FADE_MS}ms` } as CSSProperties}
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget) setShown(false);
      }}
    >
      <div className="splash-content flex flex-col items-center">
        <div className="relative grid size-16 place-items-center">
          {/* Two rings leave the mark in turn: a payment signal going out. Strokes only, no glow. */}
          <span className="splash-ring absolute inset-0 rounded-[18px] border-[1.5px] border-[#3b82f6]" />
          <span className="splash-ring splash-ring-late absolute inset-0 rounded-[18px] border-[1.5px] border-[#3b82f6]" />
          <svg viewBox="0 0 32 32" className="splash-mark relative size-16">
            <rect width="32" height="32" rx="9" fill="#2563eb" />
            <path d="M17.5 6 9 18h6l-1.5 8L22 14h-6z" fill="#ffffff" />
          </svg>
        </div>

        <p className="mt-7 font-mono text-[22px] font-semibold leading-none tracking-[-0.02em] text-[#e8edf7]">
          SolAgent<span className="font-normal text-[#7b8daf]"> Pay</span>
        </p>
        <p className="mt-3 font-mono text-[10.5px] uppercase tracking-[0.22em] text-[#7b8daf]">Payments on Solana</p>

        {/* Fills over the hold, so the wait reads as progress. */}
        <div className="mt-7 h-px w-28 overflow-hidden bg-[#222f4d]">
          <div className="splash-progress h-full bg-[#3b82f6]" />
        </div>
      </div>
    </div>
  );
}
