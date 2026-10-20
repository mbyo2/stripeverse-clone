/**
 * In-memory unlocked session for the SELF-CUSTODY wallet.
 *
 * The decrypted mnemonic lives ONLY in this module's memory while the
 * wallet is unlocked — never in localStorage/sessionStorage (that's the
 * encrypted vault's job), never in a network payload. JavaScript cannot
 * reliably zero a string's memory; the practical controls are: keep the
 * reference in exactly one place, drop it on lock, and auto-lock after
 * 5 minutes without user activity in the wallet UI.
 */
import { useSyncExternalStore } from "react";

export const AUTO_LOCK_MS = 5 * 60 * 1000;

interface SessionState {
  mnemonic: string | null;
}

let state: SessionState = { mnemonic: null };
let lockTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function scheduleAutoLock(): void {
  if (lockTimer) clearTimeout(lockTimer);
  lockTimer = setTimeout(() => lockSession(), AUTO_LOCK_MS);
}

export function unlockSession(mnemonic: string): void {
  state = { mnemonic };
  scheduleAutoLock();
  emit();
}

export function lockSession(): void {
  if (lockTimer) clearTimeout(lockTimer);
  lockTimer = null;
  state = { mnemonic: null };
  emit();
}

export function isUnlocked(): boolean {
  return state.mnemonic !== null;
}

export function getSessionMnemonic(): string | null {
  return state.mnemonic;
}

/** Reset the auto-lock countdown (call on wallet UI interactions). */
export function touchSession(): void {
  if (state.mnemonic !== null) scheduleAutoLock();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): SessionState {
  return state;
}

/** React hook: re-renders when the session locks/unlocks. */
export function useSession(): SessionState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
