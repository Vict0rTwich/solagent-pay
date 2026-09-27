"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

function isApple(): boolean {
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform;
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/** The modifier key label for shortcuts: "⌘" on Apple devices, "Ctrl" elsewhere. "⌘" while server rendering. */
export function useModKey(): string {
  return useSyncExternalStore(
    subscribe,
    () => (isApple() ? "⌘" : "Ctrl"),
    () => "⌘",
  );
}
