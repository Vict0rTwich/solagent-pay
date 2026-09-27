"use client";

import { createContext, useCallback, useContext, useSyncExternalStore } from "react";

import { DEFAULT_NETWORK, NETWORKS, isNetworkId, type NetworkConfig, type NetworkId } from "./network";

export interface Settings {
  network: NetworkId;
  /** "auto": live chain data while a wallet is connected, demo data otherwise. */
  dataSource: "auto" | "demo";
  /** Chime when a payment lands. The confetti follows the system's reduced-motion setting instead. */
  sounds: boolean;
}

const STORAGE_KEY = "solagent-settings";
const DEFAULTS: Settings = {
  network: DEFAULT_NETWORK,
  dataSource: "auto",
  sounds: true,
};

let cached: Settings | null = null;
const listeners = new Set<() => void>();

function sanitize(value: unknown): Settings {
  if (!value || typeof value !== "object") return DEFAULTS;
  const v = value as Partial<Record<keyof Settings, unknown>>;
  return {
    network: isNetworkId(v.network) ? v.network : DEFAULTS.network,
    dataSource: v.dataSource === "demo" ? "demo" : "auto",
    sounds: v.sounds !== false,
  };
}

function read(): Settings {
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    cached = raw ? sanitize(JSON.parse(raw)) : DEFAULTS;
  } catch {
    cached = DEFAULTS;
  }
  return cached;
}

function write(next: Settings): void {
  cached = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage can be blocked (private mode); settings still apply for this visit.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) {
      cached = null;
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** Workspace settings, persisted in this browser and shared across tabs. */
export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const settings = useSyncExternalStore(subscribe, read, () => DEFAULTS);
  const update = useCallback((patch: Partial<Settings>) => write({ ...read(), ...patch }), []);
  return [settings, update];
}

/** Set by <NetworkScope> for pages pinned to one network, like a checkout link for a devnet invoice. */
export const NetworkOverrideContext = createContext<NetworkConfig | null>(null);

/** The network every RPC call, link and explorer URL uses: the page's own, or the one chosen in Settings. */
export function useNetwork(): NetworkConfig {
  const override = useContext(NetworkOverrideContext);
  const [settings] = useSettings();
  return override ?? NETWORKS[settings.network];
}
