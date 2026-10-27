// lnurl: LNURL (LUD-06/16 pay, LUD-03 withdraw) helpers for the
// custodial Lightning stack, behind lightning-service.
//
// LNURL is a second front door onto the SAME money paths as
// pay_invoice / create_invoice — never a parallel one:
//   - PAY: resolve the endpoint, ask its callback for a bolt11 for
//     an amount the USER chose inside the endpoint's stated bounds,
//     then pay that invoice through the reserve-first doctrine in
//     lightning-service (btc_reserve_lightning_send, provider pay,
//     settlement ONLY on the GET /payments read-back). This module
//     only resolves and validates; it never moves money.
//   - WITHDRAW: resolve the withdrawRequest, create a custodial
//     invoice through the existing provider create path, and hand
//     it to the endpoint's callback. The incoming payment then
//     settles through the existing exactly-once deposit settle in
//     check_status. This module only resolves and validates.
//
// LNURL-AUTH (LUD-04/05) is deliberately NOT implemented here or
// anywhere in the custodial stack — see the assessment in the
// close-out handoff: a custodial auth key would have to be derived
// and held server-side per user, turning the platform into a
// signing oracle for third-party logins. Self-custody keeps auth
// (the seed never leaves the device there); custodial does not
// offer it.
//
// SSRF HYGIENE (the reason this module exists as one place):
// every URL this code fetches — the decoded LNURL itself, a
// Lightning address's .well-known URL, and every callback URL an
// endpoint hands back — passes assertSafeLnurlUrl:
//   https only · no embedded credentials · no localhost · no
//   private / loopback / link-local / reserved IP literal (v4 or
//   v6) · no numeric-obfuscated IP hostnames (decimal / hex forms
//   some fetch stacks reinterpret as 127.0.0.1) · redirects are
//   followed MANUALLY (max 3) and every hop is re-validated, so a
//   redirect can never bounce the fetcher to an internal address ·
//   10s timeout per hop · 64 KiB response cap.
// Residual risk, stated honestly: a public hostname can still
// resolve (DNS) to a private address (rebinding). Where the
// runtime offers DNS resolution (Deno.resolveDns) the fetch path
// checks the answers best-effort and refuses a private answer;
// where it does not, the lexical guards above are the boundary
// and the fetched data is treated as untrusted input throughout
// (strict shape parsing, amounts re-validated against the
// decoded bolt11 before any reserve).
//
// This module is dependency-free (no imports — its own bech32
// decoder included) so the vitest suite can load it directly:
// tests/bitcoin/lnurl.test.ts.

/** A refusal whose message is crafted plain language, safe to show
 *  the user verbatim (the edge function answers 400 with it). */
export class LnurlUserError extends Error {}

/** An upstream failure: the endpoint could not be reached, or
 *  answered with something unusable. The detail is server-side
 *  only; the edge function maps it to plain-language 503 copy and
 *  never leaks it. */
export class LnurlUpstreamError extends Error {}

// ── Bech32 (BIP-173) decode — LNURL uses plain bech32, limit 2000 ─────────

const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32_VALUES = new Map([...BECH32_CHARSET].map((c, i) => [c, i] as const));

function bech32Polymod(values: number[]): number {
  const generators = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) {
      if ((top >> i) & 1) chk ^= generators[i];
    }
  }
  return chk;
}

function bech32HrpExpand(hrp: string): number[] {
  const out: number[] = [];
  for (const c of hrp) out.push(c.charCodeAt(0) >> 5);
  out.push(0);
  for (const c of hrp) out.push(c.charCodeAt(0) & 31);
  return out;
}

export interface Bech32Decoded {
  hrp: string;
  /** Data words with the 6-word checksum stripped. */
  words: number[];
}

/**
 * Decode and checksum-verify a bech32 string. Returns null for
 * anything malformed (mixed case, bad charset, bad checksum,
 * missing separator). Accepts all-lower or all-upper, per BIP-173.
 */
export function bech32Decode(input: string): Bech32Decoded | null {
  if (typeof input !== "string") return null;
  const s = input.trim();
  if (s.length < 8 || s.length > 2000) return null;
  if (s !== s.toLowerCase() && s !== s.toUpperCase()) return null;
  const lower = s.toLowerCase();
  const sep = lower.lastIndexOf("1");
  if (sep < 1 || sep + 7 > lower.length) return null;
  const hrp = lower.slice(0, sep);
  const dataPart = lower.slice(sep + 1);
  const words: number[] = [];
  for (const c of dataPart) {
    const v = BECH32_VALUES.get(c);
    if (v === undefined) return null;
    words.push(v);
  }
  if (bech32Polymod([...bech32HrpExpand(hrp), ...words]) !== 1) return null;
  return { hrp, words: words.slice(0, -6) };
}

/** Regroup bit words (bech32 5-bit → bytes), refusing bad padding. */
function convertBits5To8(words: number[]): number[] | null {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  for (const w of words) {
    if (w < 0 || w > 31) return null;
    acc = (acc << 5) | w;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  // Leftover bits must be fewer than 5 and all zero (BIP-173 padding).
  if (bits >= 5) return null;
  if (((acc << (8 - bits)) & 0xff) !== 0) return null;
  return out;
}

/**
 * Decode an `lnurl1…` bech32 string to the https URL it carries
 * (LUD-01). Returns null for anything that is not a checksum-valid
 * lnurl bech32 string. The returned URL is NOT yet trusted — the
 * caller must pass it through assertSafeLnurlUrl before fetching.
 */
export function decodeLnurlToUrl(input: string): string | null {
  const decoded = bech32Decode(input);
  if (!decoded || decoded.hrp !== "lnurl") return null;
  const bytes = convertBits5To8(decoded.words);
  if (!bytes) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
  } catch {
    return null;
  }
}

// ── Input classification ───────────────────────────────────────────────────

export type LnurlInputKind =
  | "lightning_address"
  | "lnurl_bech32"
  | "lnurl_url"
  | "bolt11"
  | "unknown";

const LIGHTNING_ADDRESS_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

/** True for a Lightning address (`name@domain`, LUD-16). */
export function isLightningAddress(input: string): boolean {
  return LIGHTNING_ADDRESS_RE.test(input.trim());
}

/**
 * The LNURL-pay endpoint for a Lightning address (LUD-16):
 * `https://<domain>/.well-known/lnurlp/<name>`. The name is
 * lowercased (identifiers are case-insensitive in practice and
 * services register them lowercase) and percent-encoded.
 */
export function lightningAddressToUrl(address: string): string {
  const trimmed = address.trim();
  const at = trimmed.lastIndexOf("@");
  if (at < 1) throw new LnurlUserError("That doesn't look like a Lightning address — check it and try again.");
  const name = trimmed.slice(0, at).toLowerCase();
  const domain = trimmed.slice(at + 1).toLowerCase();
  return `https://${domain}/.well-known/lnurlp/${encodeURIComponent(name)}`;
}

/**
 * Classify a pasted/scanned destination for the custodial LNURL
 * flows. Pure — the UI and the edge function agree on the classes
 * through this one function. A bech32 LNURL classifies without
 * knowing whether it is pay or withdraw: that is the fetched
 * endpoint's `tag`, decided at resolve time.
 */
export function classifyLnurlInput(raw: string): LnurlInputKind {
  if (typeof raw !== "string") return "unknown";
  let text = raw.trim();
  if (!text) return "unknown";
  // A `lightning:` URI prefix wraps any of the classes below.
  if (/^lightning:/i.test(text)) text = text.slice("lightning:".length).trim();
  if (!text) return "unknown";
  if (/^ln(bc|tb|bcrt)/i.test(text)) return "bolt11";
  if (/^lnurl1/i.test(text)) return decodeLnurlToUrl(text) !== null ? "lnurl_bech32" : "unknown";
  if (isLightningAddress(text)) return "lightning_address";
  if (/^https:\/\//i.test(text)) return "lnurl_url";
  // An http:// LNURL is refused as a class of its own would leak
  // detail; it classifies unknown and the UI's plain error covers it.
  return "unknown";
}

/**
 * Resolve any classified LNURL input to the endpoint URL to fetch.
 * Throws LnurlUserError (plain language) for anything unusable.
 * The URL still needs assertSafeLnurlUrl before it is fetched —
 * resolveLnurlFetchUrl (below) does both, and is what callers use.
 */
export function lnurlInputToUrl(raw: string): string {
  let text = raw.trim();
  if (/^lightning:/i.test(text)) text = text.slice("lightning:".length).trim();
  const kind = classifyLnurlInput(raw);
  switch (kind) {
    case "lightning_address":
      return lightningAddressToUrl(text);
    case "lnurl_bech32": {
      const url = decodeLnurlToUrl(text);
      if (!url) throw new LnurlUserError("That LNURL code couldn't be read — check it and try again.");
      return url;
    }
    case "lnurl_url":
      return text;
    case "bolt11":
      throw new LnurlUserError("That's a Lightning invoice, not an LNURL code — pay it from the Lightning invoice option instead.");
    default:
      throw new LnurlUserError("That doesn't look like a Lightning address or LNURL code — check it and try again.");
  }
}

// ── SSRF guards ────────────────────────────────────────────────────────────

function ipv4Octets(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const octets = m.slice(1).map((p) => Number(p));
  return octets.every((o) => o <= 255) ? octets : null;
}

/** True when dotted-quad octets fall in a non-public range. */
export function isPrivateIpv4Octets(o: number[]): boolean {
  const [a, b] = o;
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local (cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 192 && b === 0) return true; // IETF special / TEST-NET-1 overlap guard
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 240) return true; // reserved / broadcast
  return false;
}

/** True when an IPv6 literal is non-public. URL hostnames keep
 *  their brackets ("[::1]"); bare forms are accepted too. */
export function isPrivateIpv6(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (h === "::1" || h === "::") return true; // loopback / unspecified
  if (h.startsWith("fe8") || h.startsWith("fe9") || h.startsWith("fea") || h.startsWith("feb")) {
    return true; // fe80::/10 link-local
  }
  if (h.startsWith("fc") || h.startsWith("fd")) return true; // fc00::/7 unique-local
  if (h.startsWith("::ffff:")) {
    // IPv4-mapped: judge the embedded v4 address.
    const v4 = ipv4Octets(h.slice("::ffff:".length));
    if (v4) return isPrivateIpv4Octets(v4);
    return true;
  }
  return false;
}

/**
 * Validate an LNURL URL for server-side fetching. Returns the
 * parsed URL, or throws LnurlUserError when the URL itself is the
 * user's input being refused (endpoint URLs) — callbacks parsed
 * deep inside a flow are wrapped by the caller into an upstream
 * error instead. Rules are listed in the module header.
 */
export function assertSafeLnurlUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new LnurlUserError("That Lightning service address couldn't be read — check it and try again.");
  }
  if (url.protocol !== "https:") {
    throw new LnurlUserError("That Lightning service doesn't use a secure (https) address, so we can't use it.");
  }
  if (url.username || url.password) {
    throw new LnurlUserError("That Lightning service address couldn't be read — check it and try again.");
  }
  const host = url.hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (!host || host === "localhost" || host.endsWith(".localhost")) {
    throw new LnurlUserError("That Lightning service address couldn't be read — check it and try again.");
  }
  // Numeric-obfuscated IPs (2130706433, 0x7f000001, 0177.0.0.1):
  // some stacks reinterpret these as dotted quads. Refuse the
  // shapes outright — no legitimate LNURL service uses them.
  if (/^\d+$/.test(host) || /^0x[0-9a-f]+$/i.test(host) || host.split(".").some((p) => /^0\d+$/.test(p))) {
    throw new LnurlUserError("That Lightning service address couldn't be read — check it and try again.");
  }
  const v4 = ipv4Octets(host);
  if (v4 && isPrivateIpv4Octets(v4)) {
    throw new LnurlUserError("That Lightning service address couldn't be read — check it and try again.");
  }
  if (host.includes(":") && isPrivateIpv6(host)) {
    throw new LnurlUserError("That Lightning service address couldn't be read — check it and try again.");
  }
  return url;
}

/** Input → validated fetch URL (classification + SSRF guard). */
export function resolveLnurlFetchUrl(raw: string): URL {
  return assertSafeLnurlUrl(lnurlInputToUrl(raw));
}

// ── Endpoint payload parsing (LUD-06 pay, LUD-03 withdraw) ─────────────────

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function msatField(rec: Record<string, unknown>, key: string): number | null {
  const v = rec[key];
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null;
}

/** An LNURL endpoint's own ERROR answer: { status: "ERROR", reason }. */
export function isLnurlErrorPayload(payload: unknown): boolean {
  const rec = asRecord(payload);
  return rec !== null && typeof rec.status === "string" && rec.status.toUpperCase() === "ERROR";
}

function throwIfLnurlError(payload: unknown, domain: string): void {
  if (isLnurlErrorPayload(payload)) {
    // The endpoint's `reason` is third-party text: it is logged by
    // the caller, never shown — the user gets crafted copy naming
    // the service domain only.
    throw new LnurlUserError(`The Lightning service at ${domain} couldn't handle that request. Check the address and try again.`);
  }
}

/**
 * One [type, value] metadata entry list (LUD-06): the metadata is a
 * JSON STRING holding an array of pairs. text/plain is the human
 * description; text/identifier is the Lightning address when known.
 */
export function parseLnurlMetadata(metadataStr: unknown): { description: string | null; identifier: string | null } {
  if (typeof metadataStr !== "string" || !metadataStr.trim()) {
    throw new LnurlUpstreamError("LNURL pay endpoint returned no metadata");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(metadataStr);
  } catch {
    throw new LnurlUpstreamError("LNURL pay endpoint returned malformed metadata");
  }
  if (!Array.isArray(parsed)) {
    throw new LnurlUpstreamError("LNURL pay endpoint returned malformed metadata");
  }
  let description: string | null = null;
  let identifier: string | null = null;
  for (const entry of parsed) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const [type, value] = entry;
    if (typeof value !== "string") continue;
    if (type === "text/plain" && description === null) description = value;
    if (type === "text/identifier" && identifier === null) identifier = value;
  }
  return { description, identifier };
}

export interface LnurlPayParams {
  kind: "pay";
  /** Host of the endpoint the params came from (for review UI). */
  domain: string;
  callback: string;
  callbackDomain: string;
  minSendableMsat: number;
  maxSendableMsat: number;
  /** Whole-sat bounds a custodial payment can actually use. */
  minSats: number;
  maxSats: number;
  /** The one payable amount when the endpoint fixes it, else null. */
  fixedAmountSats: number | null;
  description: string | null;
  identifier: string | null;
  commentAllowed: number;
}

export interface LnurlWithdrawParams {
  kind: "withdraw";
  domain: string;
  callback: string;
  callbackDomain: string;
  k1: string;
  minWithdrawableMsat: number;
  maxWithdrawableMsat: number;
  minSats: number;
  maxSats: number;
  fixedAmountSats: number | null;
  defaultDescription: string | null;
}

function callbackDomainOf(callback: string): string {
  let url: URL;
  try {
    // A callback is endpoint-supplied data: the same SSRF guard
    // applies, but a bad one is an upstream failure, not user error.
    url = assertSafeLnurlUrl(callback);
  } catch {
    throw new LnurlUpstreamError("LNURL endpoint returned an unsafe callback URL");
  }
  return url.hostname;
}

function wholeSatBounds(minMsat: number, maxMsat: number, label: string): { minSats: number; maxSats: number; fixedAmountSats: number | null } {
  const minSats = Math.ceil(minMsat / 1000);
  const maxSats = Math.floor(maxMsat / 1000);
  if (maxSats < 1 || minSats > maxSats) {
    throw new LnurlUserError(`This ${label} can't be handled here — its amount range doesn't include a whole number of sats.`);
  }
  const fixedAmountSats = minMsat === maxMsat && minMsat % 1000 === 0 ? minMsat / 1000 : null;
  return { minSats, maxSats, fixedAmountSats };
}

/** Parse a fetched LNURL-pay parameter payload (LUD-06/16). */
export function parseLnurlPayParams(payload: unknown, fetchedUrl: URL): LnurlPayParams {
  throwIfLnurlError(payload, fetchedUrl.hostname);
  const rec = asRecord(payload);
  if (!rec || rec.tag !== "payRequest") {
    throw new LnurlUpstreamError("LNURL endpoint did not return pay parameters");
  }
  const callback = typeof rec.callback === "string" ? rec.callback : "";
  if (!callback) throw new LnurlUpstreamError("LNURL pay endpoint returned no callback");
  const callbackDomain = callbackDomainOf(callback);
  const minSendableMsat = msatField(rec, "minSendable");
  const maxSendableMsat = msatField(rec, "maxSendable");
  if (minSendableMsat === null || maxSendableMsat === null || maxSendableMsat < minSendableMsat) {
    throw new LnurlUpstreamError("LNURL pay endpoint returned unusable amount bounds");
  }
  const { description, identifier } = parseLnurlMetadata(rec.metadata);
  const commentAllowed = typeof rec.commentAllowed === "number" && Number.isFinite(rec.commentAllowed) && rec.commentAllowed > 0
    ? Math.floor(rec.commentAllowed)
    : 0;
  const bounds = wholeSatBounds(minSendableMsat, maxSendableMsat, "payment");
  return {
    kind: "pay",
    domain: fetchedUrl.hostname,
    callback,
    callbackDomain,
    minSendableMsat,
    maxSendableMsat,
    ...bounds,
    description,
    identifier,
    commentAllowed,
  };
}

/** Parse a fetched LNURL-withdraw parameter payload (LUD-03). */
export function parseLnurlWithdrawParams(payload: unknown, fetchedUrl: URL): LnurlWithdrawParams {
  throwIfLnurlError(payload, fetchedUrl.hostname);
  const rec = asRecord(payload);
  if (!rec || rec.tag !== "withdrawRequest") {
    throw new LnurlUpstreamError("LNURL endpoint did not return withdraw parameters");
  }
  const callback = typeof rec.callback === "string" ? rec.callback : "";
  if (!callback) throw new LnurlUpstreamError("LNURL withdraw endpoint returned no callback");
  const callbackDomain = callbackDomainOf(callback);
  const k1 = typeof rec.k1 === "string" ? rec.k1 : "";
  if (!k1) throw new LnurlUpstreamError("LNURL withdraw endpoint returned no challenge (k1)");
  const minWithdrawableMsat = msatField(rec, "minWithdrawable");
  const maxWithdrawableMsat = msatField(rec, "maxWithdrawable");
  if (minWithdrawableMsat === null || maxWithdrawableMsat === null || maxWithdrawableMsat < minWithdrawableMsat) {
    throw new LnurlUpstreamError("LNURL withdraw endpoint returned unusable amount bounds");
  }
  const bounds = wholeSatBounds(minWithdrawableMsat, maxWithdrawableMsat, "withdrawal");
  return {
    kind: "withdraw",
    domain: fetchedUrl.hostname,
    callback,
    callbackDomain,
    k1,
    minWithdrawableMsat,
    maxWithdrawableMsat,
    ...bounds,
    defaultDescription: typeof rec.defaultDescription === "string" ? rec.defaultDescription : null,
  };
}

export type LnurlParams = LnurlPayParams | LnurlWithdrawParams;

/** Dispatch a fetched payload on its `tag` to the right parser. */
export function parseLnurlParams(payload: unknown, fetchedUrl: URL): LnurlParams {
  const rec = asRecord(payload);
  if (rec?.tag === "withdrawRequest") return parseLnurlWithdrawParams(payload, fetchedUrl);
  // payRequest is the default branch: its parser produces the
  // precise upstream error for any other tag (incl. channelRequest
  // / login — LNURL-auth and channels are not custodial features).
  return parseLnurlPayParams(payload, fetchedUrl);
}

// ── Amount + comment validation and callback URL building ──────────────────

/**
 * Validate a user-chosen pay amount (whole sats) against the
 * endpoint's msat bounds and return the exact msat to request.
 * A fixed-amount endpoint decides the amount: a caller-supplied
 * amount must equal it, an omitted one adopts it.
 */
export function validateLnurlPayAmount(params: LnurlPayParams, amountSats: number | null | undefined): { amountSats: number; amountMsat: number } {
  let sats = amountSats ?? null;
  if (params.fixedAmountSats !== null) {
    if (sats !== null && sats !== params.fixedAmountSats) {
      throw new LnurlUserError(`This payment is fixed at ${params.fixedAmountSats.toLocaleString()} sats by the receiving service.`);
    }
    sats = params.fixedAmountSats;
  }
  if (sats === null || !Number.isInteger(sats) || sats <= 0) {
    throw new LnurlUserError("Enter the amount to pay, in sats.");
  }
  const amountMsat = sats * 1000;
  if (amountMsat < params.minSendableMsat) {
    throw new LnurlUserError(`That service accepts at least ${params.minSats.toLocaleString()} sats for one payment.`);
  }
  if (amountMsat > params.maxSendableMsat) {
    throw new LnurlUserError(`That service accepts at most ${params.maxSats.toLocaleString()} sats for one payment.`);
  }
  return { amountSats: sats, amountMsat };
}

/** Validate a user-chosen withdraw amount against the endpoint's bounds. */
export function validateLnurlWithdrawAmount(params: LnurlWithdrawParams, amountSats: number | null | undefined): { amountSats: number; amountMsat: number } {
  let sats = amountSats ?? null;
  if (params.fixedAmountSats !== null) {
    if (sats !== null && sats !== params.fixedAmountSats) {
      throw new LnurlUserError(`This withdrawal is fixed at ${params.fixedAmountSats.toLocaleString()} sats by the sending service.`);
    }
    sats = params.fixedAmountSats;
  }
  if (sats === null || !Number.isInteger(sats) || sats <= 0) {
    throw new LnurlUserError("Enter the amount to withdraw, in sats.");
  }
  const amountMsat = sats * 1000;
  if (amountMsat < params.minWithdrawableMsat) {
    throw new LnurlUserError(`That service lets you withdraw at least ${params.minSats.toLocaleString()} sats at a time.`);
  }
  if (amountMsat > params.maxWithdrawableMsat) {
    throw new LnurlUserError(`That service lets you withdraw at most ${params.maxSats.toLocaleString()} sats at a time.`);
  }
  return { amountSats: sats, amountMsat };
}

/** Validate an optional pay comment against commentAllowed (LUD-12). */
export function validateLnurlComment(params: LnurlPayParams, comment: string | null | undefined): string | null {
  const trimmed = (comment ?? "").trim();
  if (!trimmed) return null;
  if (params.commentAllowed <= 0) {
    throw new LnurlUserError("This destination doesn't accept a note with the payment — remove the note and try again.");
  }
  if (trimmed.length > params.commentAllowed) {
    throw new LnurlUserError(`The note is too long for this destination — keep it to ${params.commentAllowed} characters or fewer.`);
  }
  return trimmed;
}

/**
 * Build the LUD-06 callback URL: the endpoint's callback plus
 * `amount` (msat) and, when given, `comment`. Existing query
 * parameters on the callback are preserved; amount/comment are
 * set (never duplicated). The built URL stays SSRF-guarded.
 */
export function buildLnurlPayCallbackUrl(params: LnurlPayParams, amountMsat: number, comment?: string | null): string {
  const url = assertSafeLnurlUrl(params.callback);
  url.searchParams.set("amount", String(amountMsat));
  if (comment) url.searchParams.set("comment", comment);
  return url.toString();
}

/** Build the LUD-03 withdraw callback URL: callback + k1 + pr (bolt11). */
export function buildLnurlWithdrawCallbackUrl(params: LnurlWithdrawParams, bolt11: string): string {
  const url = assertSafeLnurlUrl(params.callback);
  url.searchParams.set("k1", params.k1);
  url.searchParams.set("pr", bolt11);
  return url.toString();
}

/** Parse the pay callback's answer: { pr, routes, successAction? } or ERROR. */
export function parseLnurlPayCallbackResponse(payload: unknown, domain: string): { bolt11: string } {
  throwIfLnurlError(payload, domain);
  const rec = asRecord(payload);
  const bolt11 = rec && typeof rec.pr === "string" ? rec.pr.trim() : "";
  if (!bolt11) throw new LnurlUpstreamError("LNURL pay callback returned no invoice");
  return { bolt11 };
}

/** Parse the withdraw callback's answer: { status: "OK" } or ERROR. */
export function parseLnurlWithdrawCallbackResponse(payload: unknown, domain: string): void {
  throwIfLnurlError(payload, domain);
  const rec = asRecord(payload);
  if (!rec || typeof rec.status !== "string" || rec.status.toUpperCase() !== "OK") {
    throw new LnurlUpstreamError("LNURL withdraw callback did not confirm the submission");
  }
}

// ── Fetching (manual redirects, timeout, size cap) ─────────────────────────

export interface LnurlFetchOptions {
  /** Injectable for tests; defaults to the global fetch. */
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 65_536;
const DEFAULT_MAX_REDIRECTS = 3;

type DnsResolver = (hostname: string, recordType: "A" | "AAAA") => Promise<string[]>;

function runtimeDnsResolver(): DnsResolver | null {
  const d = (globalThis as { Deno?: { resolveDns?: unknown } }).Deno;
  return typeof d?.resolveDns === "function" ? (d.resolveDns as DnsResolver) : null;
}

/**
 * Best-effort DNS-rebinding check (see the header's residual-risk
 * note): when the runtime can resolve DNS, a hostname that answers
 * with a private address is refused. Resolution failure or an
 * unavailable resolver never blocks a lexically-safe hostname —
 * the data is still parsed strictly downstream.
 */
async function assertHostnameNotResolvingPrivate(url: URL): Promise<void> {
  const host = url.hostname.toLowerCase();
  if (ipv4Octets(host) || host.includes(":")) return; // literal: already judged
  const resolve = runtimeDnsResolver();
  if (!resolve) return;
  for (const type of ["A", "AAAA"] as const) {
    let answers: string[];
    try {
      answers = await resolve(host, type);
    } catch {
      continue;
    }
    for (const answer of answers ?? []) {
      const v4 = ipv4Octets(answer);
      if ((v4 && isPrivateIpv4Octets(v4)) || (!v4 && answer.includes(":") && isPrivateIpv6(answer.toLowerCase()))) {
        throw new LnurlUserError("That Lightning service address couldn't be read — check it and try again.");
      }
    }
  }
}

/**
 * Fetch JSON from an LNURL endpoint with the module's full SSRF
 * hygiene: the start URL and EVERY redirect hop are re-validated,
 * redirects are followed manually (fetch's automatic following
 * would skip re-validation), each hop times out, and the body is
 * size-capped before it is parsed.
 */
export async function fetchLnurlJson(rawUrl: string, opts: LnurlFetchOptions = {}): Promise<unknown> {
  const fetchFn = opts.fetchFn ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS;

  let current = assertSafeLnurlUrl(rawUrl).toString();
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const url = assertSafeLnurlUrl(current);
    await assertHostnameNotResolvingPrivate(url);
    let res: Response;
    try {
      res = await fetchFn(url.toString(), {
        method: "GET",
        headers: { Accept: "application/json" },
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      throw new LnurlUpstreamError(`LNURL fetch unreachable: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new LnurlUpstreamError("LNURL endpoint redirected without a location");
      if (hop === maxRedirects) throw new LnurlUpstreamError("LNURL endpoint redirected too many times");
      // Relative locations resolve against the current URL; the
      // loop re-validates the absolute result before fetching it.
      current = new URL(location, url).toString();
      continue;
    }
    if (!res.ok) {
      throw new LnurlUpstreamError(`LNURL endpoint answered HTTP ${res.status}`);
    }
    const text = await res.text().catch(() => "");
    if (new TextEncoder().encode(text).length > maxBytes) {
      throw new LnurlUpstreamError("LNURL endpoint response exceeded the size cap");
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new LnurlUpstreamError("LNURL endpoint returned a non-JSON response");
    }
  }
  throw new LnurlUpstreamError("LNURL endpoint redirected too many times");
}

/** Classify a stubbed/fetched flow for tests and logs: the tag family. */
export function lnurlFlowKind(params: LnurlParams): "pay" | "withdraw" {
  return params.kind;
}

/** Fetch + parse the parameters for any LNURL input (pay or withdraw). */
export async function resolveLnurlParams(rawInput: string, opts: LnurlFetchOptions = {}): Promise<LnurlParams> {
  const url = resolveLnurlFetchUrl(rawInput);
  const payload = await fetchLnurlJson(url.toString(), opts);
  return parseLnurlParams(payload, url);
}

/** Fetch a pay endpoint's callback and return the bolt11 it issued. */
export async function fetchLnurlPayInvoice(
  params: LnurlPayParams,
  amountMsat: number,
  comment?: string | null,
  opts: LnurlFetchOptions = {},
): Promise<{ bolt11: string }> {
  const callbackUrl = buildLnurlPayCallbackUrl(params, amountMsat, comment);
  const payload = await fetchLnurlJson(callbackUrl, opts);
  return parseLnurlPayCallbackResponse(payload, params.callbackDomain);
}

/** Submit a custodial invoice to a withdraw endpoint's callback (LUD-03). */
export async function submitLnurlWithdraw(
  params: LnurlWithdrawParams,
  bolt11: string,
  opts: LnurlFetchOptions = {},
): Promise<void> {
  const callbackUrl = buildLnurlWithdrawCallbackUrl(params, bolt11);
  const payload = await fetchLnurlJson(callbackUrl, opts);
  parseLnurlWithdrawCallbackResponse(payload, params.callbackDomain);
}
