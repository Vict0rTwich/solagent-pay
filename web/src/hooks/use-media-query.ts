"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Whether a media query matches. The server render (and hydration) always sees `false`, then the real value
 * takes over, so reading it never causes a hydration mismatch.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}
