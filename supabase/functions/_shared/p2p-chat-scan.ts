// p2p-chat-scan: content controls for P2P trade chat (scope §3.7).
//
// Pure module (no imports, no Deno globals) so the exact code the edge
// function runs is unit-testable under vitest — the btc-core pattern.
//
// What it does:
//   1. Detects contact details — phone numbers, URLs, email addresses,
//      and messaging-app solicitation (WhatsApp / Telegram keywords and
//      wa.me / t.me links). Hits are MASKED in the text that gets
//      stored (and therefore in what the counterparty reads — the
//      stored body is the only body; see the storage decision in
//      functions/p2p/index.ts). One strike per message, not per hit.
//   2. Detects release-pressure phrases ("release first", "I am in a
//      hurry release", …). These are NOT masked or blocked — context
//      matters — the caller arms the seller with an interstitial
//      system message restating the §3.5 checklist.
//
// The phrase/keyword lists live in exported consts so Phase 2 can grow
// them (chat phrase-list expansion from real scam transcripts, §5.3)
// without touching the detection logic.

export type ScanCategory =
  | "phone"
  | "url"
  | "email"
  | "messaging_app"
  | "release_pressure";

export interface ScanFlag {
  category: ScanCategory;
  /** The masked replacement that was written into the stored text
   *  (for detection-only categories this is the matched text itself). */
  masked: string;
}

export interface ChatScanResult {
  /** The text to store: contact details masked, everything else intact. */
  maskedText: string;
  /** One flag per matched span, in order of appearance. */
  flags: ScanFlag[];
  /** Deduplicated categories present in the message. */
  categories: ScanCategory[];
  /** True when any contact-detail category hit (phone/url/email/app). */
  hasContactDetails: boolean;
  /** True when a release-pressure phrase hit. */
  hasReleasePressure: boolean;
}

/** Categories that count as a contact-detail strike (§3.7). */
export const CONTACT_CATEGORIES: ScanCategory[] = [
  "phone",
  "url",
  "email",
  "messaging_app",
];

/** Messaging-app solicitation keywords (§3.7: WhatsApp/Telegram "in any
 *  language mix the platform supports" — the launch set is English plus
 *  the transliterations traders actually type). wa.me / t.me are caught
 *  by the URL patterns as well; they are listed here so a bare mention
 *  still flags the category. */
export const MESSAGING_KEYWORDS: RegExp =
  /\b(whats\s?app|telegram|wa\.me|t\.me|viber|signal\s+app)\b/i;

/** Release-pressure phrases (§3.7). Lowercase substring matching.
 *  Phase 2 grows this from real scam transcripts (§5.3). */
export const RELEASE_PRESSURE_PHRASES: string[] = [
  "release first",
  "release it first",
  "release the btc first",
  "release my btc first",
  "release now",
  "release it now",
  "just release",
  "release quickly",
  "quickly release",
  "confirm release now",
  "send first",
  "send the btc first",
  "i am in a hurry",
  "i'm in a hurry",
  "in a hurry",
  "hurry up",
  "release before",
  "trust me and release",
];

// ---------------------------------------------------------------------
// Masking
// ---------------------------------------------------------------------

/** Mask a phone number keeping the first two and last two digits —
 *  the §3.7 shape (`07•• ••• 21`). Separators are preserved so the
 *  masked text keeps the rhythm of the original. */
export function maskPhone(raw: string): string {
  const digitPositions: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    if (/\d/.test(raw[i])) digitPositions.push(i);
  }
  const keep = new Set<number>([
    ...digitPositions.slice(0, 2),
    ...digitPositions.slice(-2),
  ]);
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    if (/\d/.test(raw[i]) && !keep.has(i)) out += "•";
    else out += raw[i];
  }
  return out;
}

/** Mask an email: first char of the local part and of the domain name
 *  survive (`j•••@g•••.com`) so the recipient can tell an address was
 *  there without being able to use it. */
export function maskEmail(raw: string): string {
  const at = raw.indexOf("@");
  if (at < 1) return "•••";
  const local = raw.slice(0, at);
  const domain = raw.slice(at + 1);
  const dot = domain.lastIndexOf(".");
  const domainName = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : "";
  return `${local[0]}•••@${domainName[0] ?? ""}•••${tld}`;
}

export const MASKED_URL = "[link hidden]";

// ---------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------

const URL_RE =
  /\b(?:https?:\/\/|www\.)[^\s]+|\b(?:wa\.me|t\.me|bit\.ly|tinyurl\.com|shorturl\.at)\/[^\s]*|\b[a-z0-9-]+\.(?:com|net|org|io|me|link|zm|co\.zm)\/[^\s]+/gi;

const EMAIL_RE = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi;

// Candidate phone spans: optional +, then digits mixed with the
// separators people type (spaces, dashes, dots, parens), 8+ chars,
// ending in a digit. Candidates are validated by looksLikePhone — the
// regex alone would eat amounts and references.
const PHONE_CANDIDATE_RE = /\+?\d[\d\s().-]{6,}\d/g;

/** Does this candidate actually look like a phone number (as opposed
 *  to an amount, a rail reference, or a date)?
 *
 *  Accepted shapes:
 *    - Zambian mobile in any dress: 09[5-7]XXXXXXX, +260 9[5-7]…,
 *      2609[5-7]…, or 9[5-7]… written without the trunk 0.
 *    - Anything starting with '+' (explicit international format).
 *    - Anything starting with '0' with 9–13 digits (local format).
 *  A bare run of digits with no '+', no leading 0, no separators and
 *  no Zambian shape is NOT flagged — that is how rail references and
 *  amounts survive chat unmasked. */
export function looksLikePhone(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 9 || digits.length > 15) return false;
  if (/^(\d)\1+$/.test(digits)) return false; // 000000000 etc.
  // Zambian mobile shape, with or without country/trunk prefix.
  if (/^(?:260|0)?9[567]\d{7}$/.test(digits)) return true;
  if (raw.trimStart().startsWith("+")) return true;
  if (digits.startsWith("0")) return true;
  if (digits.startsWith("260")) return true;
  // Separated digit groups (e.g. "977 123 456") read as a number the
  // sender spaced out — flag when the digits total 9+ and the raw
  // span actually contains separators.
  if (/[\s().-]/.test(raw) && digits.length >= 9) return true;
  return false;
}

interface Span {
  start: number;
  end: number;
  category: ScanCategory;
  replacement: string;
}

/** Scan a chat message. Returns the masked text to store plus the
 *  flags to persist on the message row (scan_flags) and to feed the
 *  risk pipeline. */
export function scanChatText(text: string): ChatScanResult {
  const spans: Span[] = [];
  const taken: Array<[number, number]> = [];
  const overlaps = (s: number, e: number) =>
    taken.some(([a, b]) => s < b && e > a);
  const claim = (category: ScanCategory, m: RegExpMatchArray, replacement: string) => {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (overlaps(start, end)) return;
    taken.push([start, end]);
    spans.push({ start, end, category, replacement });
  };

  // Emails, then URLs, first: their spans can contain digits that
  // must not be re-interpreted as phone numbers (wa.me/260977…).
  // Email before URL matters: in "john.doe@gmail.com" the domain
  // alone would otherwise be claimed as a bare-domain link and the
  // address would never be recognised (or masked) as an email. A
  // standalone domain with no @ is still claimed by the URL pass.
  for (const m of text.matchAll(EMAIL_RE)) claim("email", m, maskEmail(m[0]));
  for (const m of text.matchAll(URL_RE)) claim("url", m, MASKED_URL);
  for (const m of text.matchAll(PHONE_CANDIDATE_RE)) {
    if (!looksLikePhone(m[0])) continue;
    claim("phone", m, maskPhone(m[0]));
  }

  // Rebuild the masked text left to right.
  spans.sort((a, b) => a.start - b.start);
  let maskedText = "";
  let cursor = 0;
  const flags: ScanFlag[] = [];
  for (const span of spans) {
    maskedText += text.slice(cursor, span.start) + span.replacement;
    cursor = span.end;
    flags.push({ category: span.category, masked: span.replacement });
  }
  maskedText += text.slice(cursor);

  // Detection-only categories, evaluated on the original text.
  const categories = new Set<ScanCategory>(flags.map((f) => f.category));
  if (MESSAGING_KEYWORDS.test(text)) {
    categories.add("messaging_app");
    if (!flags.some((f) => f.category === "messaging_app")) {
      flags.push({ category: "messaging_app", masked: "" });
    }
  }
  const lower = text.toLowerCase();
  const pressureHit = RELEASE_PRESSURE_PHRASES.find((p) => lower.includes(p));
  if (pressureHit) {
    categories.add("release_pressure");
    flags.push({ category: "release_pressure", masked: pressureHit });
  }

  return {
    maskedText,
    flags,
    categories: [...categories],
    hasContactDetails: [...categories].some((c) =>
      CONTACT_CATEGORIES.includes(c),
    ),
    hasReleasePressure: categories.has("release_pressure"),
  };
}

/** Scan ad terms (§3.7: the same scan at posting). The caller refuses
 *  the ad on a contact-detail hit — terms are contract text and are
 *  never silently rewritten the way a chat message is masked. */
export function scanAdTerms(terms: string): ChatScanResult {
  return scanChatText(terms);
}
