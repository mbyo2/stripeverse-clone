/**
 * Zambian phone-number normalization — the single shared rule used
 * wherever a user-entered phone number is matched to an account.
 *
 * Why this exists (live QA, 2026-10-22): on /transfer, typing the
 * recipient's number in local format `0970000000` was refused with
 * "No account found for that phone number", while the stored profile
 * format `+260 97 000 0000` was accepted. The recipient lookup compared
 * raw digit strings, so `0970000000` (10 digits, trunk 0) never equalled
 * `260970000000` (12 digits, country code). Real Zambian users type the
 * local format; every format of the SAME number must match.
 *
 * Canonical form: the 12-digit string `260` + 9-digit subscriber number
 * (e.g. `260970000000`), or the same with a leading `+` for display /
 * query use (`+260970000000`).
 *
 * Accepted inputs (all → `260970000000`):
 *   `0970000000`        local, trunk 0
 *   `097 000 0000`      local, spaced
 *   `260970000000`      country code, no plus
 *   `+260970000000`     full international
 *   `+260 97 000 0000`  full international, spaced (the stored format)
 *   `970000000`         bare 9-digit subscriber number
 *
 * Anything else (other country codes, wrong lengths, letters) is NOT a
 * Zambian number we can canonicalize and returns null — callers must
 * treat null as "cannot canonicalize", never as "matches".
 */

export const ZAMBIA_COUNTRY_CODE = "260";

/** Strip everything except digits. */
export function phoneDigits(input: string | null | undefined): string {
  return (input ?? "").replace(/\D/g, "");
}

/**
 * Canonical digit-only Zambian form (`260` + 9-digit subscriber), or
 * null when the input is not a recognizable Zambian number.
 */
export function canonicalZambianPhoneDigits(
  input: string | null | undefined,
): string | null {
  const digits = phoneDigits(input);
  // Full international: 260 + 9 digits.
  if (/^260\d{9}$/.test(digits)) return digits;
  // Local: trunk 0 + 9 digits → swap the 0 for the country code.
  if (/^0\d{9}$/.test(digits)) return ZAMBIA_COUNTRY_CODE + digits.slice(1);
  // Bare subscriber number: 9 digits starting 7 or 9 (Zambian mobile ranges).
  if (/^[79]\d{8}$/.test(digits)) return ZAMBIA_COUNTRY_CODE + digits;
  return null;
}

/** Canonical `+260…` form, or null when not a Zambian number. */
export function normalizeZambianPhone(
  input: string | null | undefined,
): string | null {
  const canonical = canonicalZambianPhoneDigits(input);
  return canonical ? `+${canonical}` : null;
}

/**
 * Do two phone strings refer to the same number? Canonical Zambian
 * comparison when both sides canonicalize; otherwise exact digit
 * equality (the legacy behaviour for anything non-Zambian). Two empty /
 * unparseable inputs never count as a match.
 */
export function phonesMatch(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const digitsA = phoneDigits(a);
  const digitsB = phoneDigits(b);
  if (!digitsA || !digitsB) return false;
  const canonA = canonicalZambianPhoneDigits(a);
  const canonB = canonicalZambianPhoneDigits(b);
  if (canonA && canonB) return canonA === canonB;
  return digitsA === digitsB;
}

export const INVALID_RECIPIENT_MESSAGE =
  "That doesn't look like a valid phone number. Enter a Zambian number " +
  "(e.g. 097 000 0000 or +260 97 000 0000) or the recipient's email address.";

export type PreparedRecipientQuery =
  | { ok: true; query: string }
  | { ok: false; message: string };

/**
 * Prepare a recipient string typed into Send Money / Transfer for the
 * find_transfer_recipient lookup:
 *  - Email (contains '@') passes through trimmed.
 *  - A Zambian phone in ANY accepted format is canonicalized to
 *    `+260…`, so the lookup matches however the recipient's number is
 *    stored.
 *  - Any other plausible number (7+ digits, e.g. non-Zambian) passes
 *    through as typed; the lookup keeps its exact-match behaviour and
 *    answers with the honest "no account" refusal when nothing matches.
 *  - Garbage (letters, or fewer than 7 digits) is refused here with a
 *    clear invalid-format message instead of a misleading "no account".
 */
export function prepareRecipientQuery(raw: string): PreparedRecipientQuery {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { ok: false, message: INVALID_RECIPIENT_MESSAGE };
  if (trimmed.includes("@")) return { ok: true, query: trimmed };

  // Phone-ish input must be digits and phone punctuation only.
  if (/[a-zA-Z]/.test(trimmed)) {
    return { ok: false, message: INVALID_RECIPIENT_MESSAGE };
  }
  const digits = phoneDigits(trimmed);
  if (digits.length < 7) {
    return { ok: false, message: INVALID_RECIPIENT_MESSAGE };
  }
  const canonical = normalizeZambianPhone(trimmed);
  return { ok: true, query: canonical ?? trimmed };
}
