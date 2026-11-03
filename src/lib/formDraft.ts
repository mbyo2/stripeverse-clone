// formDraft — durable per-user form drafts in localStorage.
//
// Why this exists: form state held only in React state dies with the
// page. On desktop that rarely matters; on a phone the browser
// routinely discards background tabs, the user can be pulled away
// mid-form (a call, checking a document number in another app), and
// every entry is gone when they come back — the form "does not keep
// things in the fields". A localStorage draft survives page reloads,
// discarded tabs and full browser restarts, so a form can always be
// resumed exactly where it was left.
//
// Drafts are keyed per user (never shared across accounts on the
// same device) and are cleared by the form itself once its work has
// been submitted successfully.

export function loadFormDraft<T extends Record<string, unknown>>(
  key: string,
): Partial<T> | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Partial<T>;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveFormDraft(key: string, value: Record<string, unknown>): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full/blocked — the in-memory state still protects the
    // current session.
  }
}

export function clearFormDraft(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Nothing to clear.
  }
}

/** A string field from a draft, only when it really is a string. */
export function draftString(
  draft: Record<string, unknown> | null,
  field: string,
): string | undefined {
  const v = draft?.[field];
  return typeof v === "string" ? v : undefined;
}

/** A string-array field from a draft (e.g. selected method types). */
export function draftStringArray(
  draft: Record<string, unknown> | null,
  field: string,
): string[] | undefined {
  const v = draft?.[field];
  return Array.isArray(v) && v.every((x) => typeof x === "string")
    ? (v as string[])
    : undefined;
}
