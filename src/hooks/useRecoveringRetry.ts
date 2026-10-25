import { useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";

/**
 * "Try Again" that can actually recover (CEO report, 2026-10-25):
 * before refetching, re-verify the session — refresh the access
 * token if it died — so a single tap recovers from a stale-session
 * failure instead of re-running the same doomed fetch until the
 * user thinks to sign out and back in. If recovery finds there is
 * no usable session, it ends the session and ProtectedRoute routes
 * to /login; the refetch is skipped because this page is leaving.
 */
export function useRecoveringRetry() {
  const { recoverSession } = useAuth();

  return useCallback(
    async (refetch: () => unknown): Promise<void> => {
      const outcome = await recoverSession();
      if (outcome !== "signed-out") {
        await refetch();
      }
    },
    [recoverSession],
  );
}
