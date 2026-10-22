/**
 * Last-known self-custody wallet reading, persisted on this device.
 *
 * The wallet's balance and next receive index come from a live chain
 * scan (chain.ts). When the network is unreachable the scan fails —
 * but the wallet must not blank out: the Receive address is derivable
 * locally, and the last successful reading is better than a red error
 * and no address. This module stores that last reading (keyed by the
 * account zpub, so importing a different wallet never mixes data).
 *
 * Only public data is stored: a balance figure, an address index and a
 * timestamp. Never key material — the zpub is a watch-only key the UI
 * already displays.
 */
export interface LastKnownWalletData {
  /** First unused external (receive) index from the last good scan. */
  receiveIndex: number;
  /** Confirmed balance in sats from the last good scan. */
  balanceSats: number;
  /** When the reading was taken (epoch ms). */
  updatedAt: number;
}

const STORAGE_KEY = "bmaglass.sc.lastknown.v1";

type Store = Record<string, LastKnownWalletData>;

function readStore(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Store) : {};
  } catch {
    return {};
  }
}

function writeStore(store: Store): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Storage full/blocked: the cache is a nicety, never fatal.
  }
}

function isValid(entry: unknown): entry is LastKnownWalletData {
  if (!entry || typeof entry !== "object") return false;
  const e = entry as Record<string, unknown>;
  return (
    Number.isInteger(e.receiveIndex) && (e.receiveIndex as number) >= 0 &&
    typeof e.balanceSats === "number" && Number.isFinite(e.balanceSats) && e.balanceSats >= 0 &&
    typeof e.updatedAt === "number" && Number.isFinite(e.updatedAt)
  );
}

export function loadLastKnown(xpub: string): LastKnownWalletData | null {
  const entry = readStore()[xpub];
  return isValid(entry) ? entry : null;
}

export function saveLastKnown(xpub: string, data: LastKnownWalletData): void {
  if (!isValid(data)) return;
  const store = readStore();
  store[xpub] = data;
  writeStore(store);
}

export function clearLastKnown(xpub: string): void {
  const store = readStore();
  if (xpub in store) {
    delete store[xpub];
    writeStore(store);
  }
}
