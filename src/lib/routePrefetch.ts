/**
 * Wallet-route chunk prefetching (speed pass, 2026-10-25).
 *
 * The wallet surfaces are route-level lazy chunks. Before this
 * module, tapping "Bitcoin wallet" paid the full chunk fetch on
 * the click path — worst for the self-custody page (~223 kB,
 * ~75 kB gzip) on a slow connection. Once a user is signed in,
 * the app prefetches the wallet chunks during idle time so the
 * navigation is instant when it comes. The chunks are
 * content-hashed and served with long-lived cache headers, so a
 * prefetch costs bandwidth once per deploy, not per visit.
 *
 * Data discipline: prefetching is skipped entirely on a
 * data-saver connection or a slow (2G-class) effective connection
 * — idle bandwidth is not free for every user.
 */

/** Connection facts the prefetch decision uses (Network Information API shape). */
export interface ConnectionFacts {
  saveData?: boolean;
  effectiveType?: string;
}

/** Whether prefetching is allowed on this connection. Pure — unit-tested. */
export function shouldPrefetch(facts: ConnectionFacts | undefined): boolean {
  if (!facts) return true;
  if (facts.saveData) return false;
  if (facts.effectiveType && /^(slow-)?2g$/.test(facts.effectiveType)) return false;
  return true;
}

function currentConnectionFacts(): ConnectionFacts | undefined {
  if (typeof navigator === "undefined") return undefined;
  const conn = (navigator as Navigator & { connection?: ConnectionFacts }).connection;
  return conn ? { saveData: conn.saveData, effectiveType: conn.effectiveType } : undefined;
}

// The loaders deliberately use the same module specifiers as the
// React.lazy definitions in AnimatedRoutes, so a prefetch lands in
// the same chunks the router will request.
const WALLET_ROUTE_LOADERS: Record<string, () => Promise<unknown>> = {
  "/wallet": () => import("@/pages/Wallet"),
  "/bitcoin-wallet": () => import("@/pages/BitcoinWallet"),
  "/bitcoin-wallet/self-custody": () => import("@/pages/SelfCustodyWallet"),
};

const prefetched = new Set<string>();

/** Prefetch one wallet route's chunk (idempotent; failures are silent — the real navigation retries). */
export function prefetchRoute(path: string): void {
  const loader = WALLET_ROUTE_LOADERS[path];
  if (!loader || prefetched.has(path)) return;
  if (!shouldPrefetch(currentConnectionFacts())) return;
  prefetched.add(path);
  loader().catch(() => {
    // A failed prefetch must not mark the route done: the actual
    // navigation (and the chunk-recovery guard) handles it there.
    prefetched.delete(path);
  });
}

/** Prefetch every wallet surface's chunk. Call once the user is signed in. */
export function prefetchWalletRoutes(): void {
  for (const path of Object.keys(WALLET_ROUTE_LOADERS)) prefetchRoute(path);
}

/**
 * Run `fn` when the browser is idle (requestIdleCallback where
 * available, a short timer otherwise). Returns a cancel function.
 */
export function scheduleIdle(fn: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const ric = (
    window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    }
  ).requestIdleCallback;
  if (ric) {
    const id = ric(fn, { timeout: 3000 });
    return () => {
      const cic = (
        window as Window & { cancelIdleCallback?: (id: number) => void }
      ).cancelIdleCallback;
      if (cic) cic(id);
    };
  }
  const timer = setTimeout(fn, 1500);
  return () => clearTimeout(timer);
}
