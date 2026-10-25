/**
 * App-wide auth-failure net (see lib/authFailure.ts for the why).
 *
 * The React Query cache in App.tsx forwards every query error here;
 * AuthProvider registers the handler that runs session recovery.
 * This is what makes the dashboard fix APP-WIDE without editing
 * every page: any page whose query fails with an auth error gets
 * the same treatment — silent refresh, or a clean sign-out that
 * routes to /login — instead of an error card blaming the
 * connection. Non-auth errors are ignored here; they keep their
 * normal per-page error states.
 */

import { isAuthFailure } from "@/lib/authFailure";

type AuthFailureHandler = (error: unknown) => void;

let handler: AuthFailureHandler | null = null;

export function setAuthFailureHandler(next: AuthFailureHandler | null): void {
  handler = next;
}

export function notifyAuthFailure(error: unknown): void {
  if (!handler) return;
  if (!isAuthFailure(error)) return;
  handler(error);
}
