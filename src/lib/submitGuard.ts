// A one-at-a-time submit guard for forms whose submit handler is
// async. The first begin() wins; every later begin() is refused until
// end() is called. Used by the registration form so a double-tap (or
// an impatient double-click before React re-renders the disabled
// button) can never fire two sign-up attempts.
//
// Pure and dependency-free so the guard itself is unit testable; the
// form component holds one instance in a ref for its lifetime.

export interface SubmitGuard {
  /** Claim the single in-flight slot. False when already claimed. */
  begin(): boolean;
  /** Release the slot. Safe to call when not claimed. */
  end(): void;
  /** Whether a submission is currently in flight. */
  readonly active: boolean;
}

export function createSubmitGuard(): SubmitGuard {
  let active = false;
  return {
    begin() {
      if (active) return false;
      active = true;
      return true;
    },
    end() {
      active = false;
    },
    get active() {
      return active;
    },
  };
}
