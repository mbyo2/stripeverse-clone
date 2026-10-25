/**
 * Stale-chunk auto-recovery for ROUTE chunks (the 2026-10-22 owed
 * item "stale-file auto-refresh", completed for the whole app).
 *
 * After a redeploy, a tab still running the old build references
 * hashed JS chunks that no longer exist on the server. When the
 * user navigates, the lazy route import fails and — before this
 * module — the only way out was the error boundary's manual reload
 * button. Vite emits a `vite:preloadError` event for exactly this
 * failure; on it we reload the page ONCE (the fresh HTML points at
 * the new chunks). A sessionStorage flag makes a loop impossible:
 * if the import still fails after one reload, the error propagates
 * to the error boundary honestly instead of reloading forever.
 *
 * The Spark SDK chunk has its own equivalent guard in
 * lib/selfcustody/spark.ts (separate storage key): the two guards
 * protect different imports and must not share a flag, or one
 * recovery could disarm the other.
 */

export const ROUTE_CHUNK_RELOAD_KEY = "bmaglass.routeChunkReload.v1";

function reloadAttempted(): boolean {
  try {
    return sessionStorage.getItem(ROUTE_CHUNK_RELOAD_KEY) === "1";
  } catch {
    return false;
  }
}

function markReloadAttempted(): void {
  try {
    sessionStorage.setItem(ROUTE_CHUNK_RELOAD_KEY, "1");
  } catch {
    // Storage unavailable: the reload still happens once per event;
    // the error boundary remains the backstop.
  }
}

function clearReloadMark(): void {
  try {
    sessionStorage.removeItem(ROUTE_CHUNK_RELOAD_KEY);
  } catch {
    // Non-fatal.
  }
}

/**
 * Handle a preload (chunk-load) failure: returns true when a
 * one-time reload was triggered and the caller should swallow the
 * error (the page is being replaced). Pure apart from the injected
 * storage/reload seams — unit-tested.
 */
export function handleChunkPreloadError(input: {
  alreadyReloaded: boolean;
  markReloadAttempted: () => void;
  reload: () => void;
}): boolean {
  if (input.alreadyReloaded) return false;
  input.markReloadAttempted();
  input.reload();
  return true;
}

/**
 * A route chunk loaded successfully: the build in this tab is
 * current, so re-arm the one-time recovery for the NEXT deploy.
 * (Clearing the mark on page load instead would defeat the loop
 * guard — the recovery reload is itself a page load.)
 */
export function noteChunkLoadSuccess(): void {
  clearReloadMark();
}

/**
 * Install the recovery: listen for Vite's preload-error event for
 * the app's lifetime.
 */
export function installChunkRecovery(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("vite:preloadError", (event) => {
    const recovered = handleChunkPreloadError({
      alreadyReloaded: reloadAttempted(),
      markReloadAttempted,
      reload: () => window.location.reload(),
    });
    if (recovered) {
      // Stop the error from reaching the error boundary in the page
      // that is about to be replaced.
      event.preventDefault();
    }
  });
}
