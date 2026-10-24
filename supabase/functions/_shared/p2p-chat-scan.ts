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
// NORMALISATION (delta-audit E2): detection used to run regexes over
// the raw text, so a zero-width character inside a number, full-width
// or Arabic-Indic digits, a Cyrillic homoglyph in "telegram", or a
// spelled-out number all walked straight past it. Detection now runs
// over a NORMALISED copy of the text — NFKC, format/zero-width
// characters stripped, confusable letters and non-ASCII digits folded
// to ASCII — with an index map back to the original, so a hit found
// on the normalised text masks exactly the original span it came
// from (including any zero-width characters embedded in it). A second
// pass decodes spelled-out digit words ("zero nine seven seven …")
// into a digit string and phone-checks that. URL coverage includes
// bare domains, hxxp, and " dot " / "[.]" obfuscations.
//
// The phrase/keyword lists live in exported consts so Phase 2 can grow
// them (chat phrase-list expansion from real scam transcripts, §5.3)
// without touching the detection logic.

export type ScanCategory =
  | "phone"
  | "url"
  | "email"
  | "messaging_app"
  | "release_pressure"
  /** Recorded by the edge (not by this scanner) when a message
   *  carries an attachment: the file is evidence, never scanned, and
   *  this flag is how strike/dispute logic knows the channel was
   *  used (delta-audit E1). */
  | "attachment_unscanned";

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
 *  still flags the category. Evaluated on the NORMALISED text, so
 *  "whats\u200Bapp" and Cyrillic-lookalike spellings are caught. */
export const MESSAGING_KEYWORDS: RegExp =
  /\b(whats[\s-]?app|telegram|wa\.me|t\.me|viber|signal\s+app|wechat)\b/i;

/** Release-pressure phrases (§3.7). Lowercase substring matching on
 *  the normalised text. Phase 2 grows this from real scam transcripts
 *  (§5.3). */
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
// Normalisation (delta-audit E2)
// ---------------------------------------------------------------------

/** Zero-width and format characters: invisible in chat, fatal to
 *  naive pattern matching — they are dropped from the normalised
 *  copy, so a number split by them reads as one number again. */
const FORMAT_CODE_POINTS = new Set([
  0x00ad, // soft hyphen
  0x180e, // Mongolian vowel separator
  0x200b, 0x200c, 0x200d, // ZWSP / ZWNJ / ZWJ
  0x200e, 0x200f, // LRM / RLM
  0x202a, 0x202b, 0x202c, 0x202d, 0x202e, // bidi controls
  0x2060, // word joiner
  0x2061, 0x2062, 0x2063, 0x2064, // invisible operators
  0x2066, 0x2067, 0x2068, 0x2069, // bidi isolates
  0xfeff, // BOM / zero-width no-break space
]);

/** Cyrillic / Greek letters that render identically (or nearly) to
 *  Latin ones — folded so "telegrаm" with a Cyrillic а still matches
 *  the keyword list. Keys are written as escapes on purpose: the
 *  literal glyphs are indistinguishable from the values. */
const HOMOGLYPHS: Record<string, string> = {
  "\u0430": "a", "\u0435": "e", "\u043e": "o", "\u0440": "p",
  "\u0441": "c", "\u0445": "x", "\u0443": "y", "\u0456": "i",
  "\u0458": "j", "\u0455": "s", "\u04bb": "h", "\u0410": "A",
  "\u0415": "E", "\u041e": "O", "\u0420": "P", "\u0421": "C",
  "\u0425": "X", "\u0423": "Y", "\u0406": "I", "\u0408": "J",
  "\u0405": "S", "\u03bf": "o", "\u03b1": "a", "\u03b5": "e",
  "\u03c1": "p", "\u03c4": "t", "\u03c5": "y", "\u03b9": "i",
  "\u03ba": "k", "\u03bd": "v", "\u03c7": "x", "\u039f": "O",
  "\u0391": "A", "\u0395": "E", "\u03a1": "P", "\u03a4": "T",
};

function foldChar(ch: string): string {
  const cp = ch.codePointAt(0) ?? 0;
  // Arabic-Indic and Extended Arabic-Indic digits fold to ASCII
  // (NFKC folds the full-width forms but not these).
  if (cp >= 0x0660 && cp <= 0x0669) return String(cp - 0x0660);
  if (cp >= 0x06f0 && cp <= 0x06f9) return String(cp - 0x06f0);
  return HOMOGLYPHS[ch] ?? ch;
}

/** Build the normalised copy of `text` plus, for every normalised
 *  character, the [start, end) span of the ORIGINAL text it came
 *  from — so a detection span on the normalised text maps back to
 *  the exact original characters to mask. */
export function normaliseWithMap(text: string): {
  norm: string;
  startMap: number[];
  endMap: number[];
} {
  let norm = "";
  const startMap: number[] = [];
  const endMap: number[] = [];
  let offset = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (!FORMAT_CODE_POINTS.has(cp)) {
      for (const piece of ch.normalize("NFKC")) {
        const folded = foldChar(piece);
        for (const fc of folded) {
          norm += fc;
          startMap.push(offset);
          endMap.push(offset + ch.length);
        }
      }
    }
    offset += ch.length;
  }
  return { norm, startMap, endMap };
}

/** The normalised form of a text (detection view; original spans are
 *  recovered via normaliseWithMap). Exported for tests. */
export function normaliseForScan(text: string): string {
  return normaliseWithMap(text).norm;
}

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
// Detection (all patterns run on the NORMALISED text)
// ---------------------------------------------------------------------

const TLD_PATTERN =
  "com|net|org|io|me|link|zm|co\\.zm|xyz|app|online|site|co|info|biz|top|club|live|chat|social|fun|icu|buzz|work|life|world|click|quest|sbs|cfd";

const URL_RE = new RegExp(
  `\\b(?:https?://|hxxps?://|www\\.)[^\\s]+` +
    `|\\b(?:wa\\.me|t\\.me|bit\\.ly|tinyurl\\.com|shorturl\\.at)/[^\\s]*` +
    `|\\b[a-z0-9-]+\\.(?:${TLD_PATTERN})(?:/[^\\s]*)?`,
  "gi",
);

/** "example dot com", "example[.]com", "example (.) com": the pieces
 *  are matched loosely here and confirmed by folding them into a
 *  dotted domain and checking its ending against the TLD list. */
const OBFUSCATED_DOMAIN_RE =
  /\b[a-z0-9-]+(?:\s*(?:\[\.\]|\(\.\)|\bdot\b)\s*[a-z0-9-]+)+\b/gi;

const OBFUSCATED_SEP_RE = /\s*(?:\[\.\]|\(\.\)|\bdot\b)\s*/g;
const TLD_END_RE = new RegExp(`\\.(?:${TLD_PATTERN})$`, "i");

function looksLikeObfuscatedDomain(raw: string): boolean {
  const folded = raw.toLowerCase().replace(OBFUSCATED_SEP_RE, ".");
  return TLD_END_RE.test(folded);
}

const EMAIL_RE = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi;

// Candidate phone spans: optional +, then digits mixed with the
// separators people type (spaces, dashes, dots, parens), 8+ chars,
// ending in a digit. Candidates are validated by looksLikePhone — the
// regex alone would eat amounts and references.
const PHONE_CANDIDATE_RE = /\+?\d[\d\s().-]{6,}\d/g;

/** Digit words for the spelled-out pass (§3.7 evasion: "zero nine
 *  seven seven one two three four five six"). */
const DIGIT_WORDS: Record<string, string> = {
  zero: "0",
  oh: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
};

const SPELLED_WORD_RE =
  /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|oh)\b/g;

// A run of 8+ digit words with only light separators between them.
const SPELLED_RUN_RE =
  /(?:\b(?:zero|one|two|three|four|five|six|seven|eight|nine|oh)\b[\s,*-]*){8,}/gi;

function decodeSpelledRun(raw: string): string {
  const words = raw.toLowerCase().match(SPELLED_WORD_RE) ?? [];
  return words.map((w) => DIGIT_WORDS[w] ?? "").join("");
}

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
  const { norm, startMap, endMap } = normaliseWithMap(text);
  const spans: Span[] = [];
  const taken: Array<[number, number]> = [];
  const overlaps = (s: number, e: number) =>
    taken.some(([a, b]) => s < b && e > a);
  const claim = (
    category: ScanCategory,
    start: number,
    end: number,
    replacement: string,
  ) => {
    if (end <= start || overlaps(start, end)) return;
    taken.push([start, end]);
    spans.push({ start, end, category, replacement });
  };
  const claimMatch = (
    category: ScanCategory,
    m: RegExpMatchArray,
    replacement: string,
  ) => {
    const start = m.index ?? 0;
    claim(category, start, start + m[0].length, replacement);
  };

  // Emails, then URLs, first: their spans can contain digits that
  // must not be re-interpreted as phone numbers (wa.me/260977…).
  // Email before URL matters: in "john.doe@gmail.com" the domain
  // alone would otherwise be claimed as a bare-domain link and the
  // address would never be recognised (or masked) as an email. A
  // standalone domain with no @ is still claimed by the URL pass.
  for (const m of norm.matchAll(EMAIL_RE)) claimMatch("email", m, maskEmail(m[0]));
  for (const m of norm.matchAll(URL_RE)) claimMatch("url", m, MASKED_URL);
  for (const m of norm.matchAll(OBFUSCATED_DOMAIN_RE)) {
    if (!looksLikeObfuscatedDomain(m[0])) continue;
    claimMatch("url", m, MASKED_URL);
  }
  for (const m of norm.matchAll(PHONE_CANDIDATE_RE)) {
    if (!looksLikePhone(m[0])) continue;
    claimMatch("phone", m, maskPhone(m[0]));
  }
  // Spelled-out numbers ("zero nine seven seven …"): decode the run
  // to digits and apply the same phone judgement; the masked form is
  // the mask of the decoded number.
  for (const m of norm.matchAll(SPELLED_RUN_RE)) {
    const digits = decodeSpelledRun(m[0]);
    if (!looksLikePhone(digits)) continue;
    let end = (m.index ?? 0) + m[0].length;
    while (end > (m.index ?? 0) && /[\s,*-]/.test(norm[end - 1])) end--;
    claim("phone", m.index ?? 0, end, maskPhone(digits));
  }

  // Translate the claimed spans back to original coordinates and
  // rebuild the masked text left to right.
  const origSpans = spans
    .map((s) => ({
      start: startMap[s.start],
      end: endMap[s.end - 1],
      category: s.category,
      replacement: s.replacement,
    }))
    .sort((a, b) => a.start - b.start);
  let maskedText = "";
  let cursor = 0;
  const flags: ScanFlag[] = [];
  for (const span of origSpans) {
    const start = Math.max(span.start, cursor);
    maskedText += text.slice(cursor, start) + span.replacement;
    cursor = Math.max(cursor, span.end);
    flags.push({ category: span.category, masked: span.replacement });
  }
  maskedText += text.slice(cursor);

  // Detection-only categories, evaluated on the normalised text.
  const categories = new Set<ScanCategory>(flags.map((f) => f.category));
  if (MESSAGING_KEYWORDS.test(norm)) {
    categories.add("messaging_app");
    if (!flags.some((f) => f.category === "messaging_app")) {
      flags.push({ category: "messaging_app", masked: "" });
    }
  }
  const lower = norm.toLowerCase();
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
