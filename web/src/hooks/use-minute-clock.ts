"use client";

import { useEffect, useState } from "react";

/**
 * The current time, updated as each minute turns over. Null until the page has mounted: pages are prerendered,
 * and a clock read on the server (or at build time) would never match the browser's.
 */
export function useMinuteClock(): number | null {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const current = Date.now();
      setNow(current);
      // Wake just after the next minute begins, so the label changes when a wall clock would.
      timer = setTimeout(tick, 60_000 - (current % 60_000) + 50);
    };
    tick();
    return () => clearTimeout(timer);
  }, []);

  return now;
}
