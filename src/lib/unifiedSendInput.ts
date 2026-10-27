/**
 * Custodial unified paste-anything input parsing (close-out B1).
 *
 * The custodial Bitcoin wallet's send flow used to have per-tab
 * paste: an on-chain address only worked in the On-chain tab, a
 * BOLT11 invoice only in the Lightning tab, and anything else failed
 * with whatever the form happened to say. This module is the single
 * classifier both tabs now share: it turns a pasted or scanned string
 * into exactly one typed destination — or a plain-language reason it
 * can't be used — and each form routes on the classification instead
 * of assuming the user picked the right tab.
 *
 *   bolt11            → the existing LightningSend review flow
 *   onchain           → the existing on-chain send form, pre-filled
 *   lightningAddress  → a typed LNURL intent (see LnurlIntent)
 *   lnurl             → a typed LNURL intent (see LnurlIntent)
 *   invalid           → shown to the user as-is; plain language only
 *
 * LNURL intents are SURFACED, not executed: the LNURL send actions
 * are a separate workstream. Until they land, the UI says so
 * truthfully ("Lightning address support is being switched on") —
 * this module never pretends an intent is a send path.
 *
 * Validation is checksum-real, not structural:
 *   - BOLT11 is decoded with the bech32 checksum verified, mirroring
 *     decodeBolt11 in supabase/functions/_shared/btc-core.ts field
 *     for field (that module is Deno-side — `npm:` specifiers — so
 *     the client cannot import it; the unit tests pin this decoder
 *     against btc-core's own outputs on the same vectors so the two
 *     can never drift silently). The server decode stays the
 *     authority at review/pay time.
 *   - On-chain addresses are decoded with @scure/btc-signer's
 *     mainnet decoder — the same check the self-custody wallet's
 *     assertValidAddress uses — so bad checksums and testnet /
 *     regtest addresses are refused here, never filled in.
 *   - BIP21 amounts reuse qrScan's exact decimal BTC→sats conversion
 *     (btcAmountToSats): an amount that cannot be represented in
 *     whole sats is dropped, never rounded.
 *
 * Pure: no network, no storage, no sends. Classification only ever
 * routes or fills a form — the forms' review steps are untouched.
 */
import { bech32 } from "@scure/base";
import { Address, NETWORK } from "@scure/btc-signer";
import { btcAmountToSats, looksLikeBitcoinAddress } from "./qrScan";

/** A destination the LNURL send workstream will act on. */
export type LnurlIntent =
  | {
      type: "lightningAddress";
      /** The address as pasted, trimmed (display + identity). */
      address: string;
      username: string;
      /** Lower-cased domain — domains are case-insensitive. */
      domain: string;
    }
  | {
      type: "lnurl";
      /** The bech32 LNURL as pasted, trimmed. */
      lnurl: string;
      /** The URL the LNURL decodes to (https, or http for .onion). */
      url: string;
    };

export type InvalidCode =
  | "empty"
  | "wrong-network"
  | "malformed-invoice"
  | "malformed-lnurl"
  | "malformed-address"
  | "malformed-lightning-address"
  | "spark-address"
  | "unrecognised";

export type UnifiedSendInput =
  | {
      kind: "bolt11";
      /** The invoice as pasted, trimmed (case preserved). */
      destination: string;
      /** Amount in millisatoshis, or null for an amount-less invoice. */
      amountMsat: bigint | null;
      /** Whole sats when the amount is an exact number of sats, else null. */
      amountSats: number | null;
      paymentHash: string | null;
      description: string | null;
      timestampSeconds: number;
      expiresAtSeconds: number;
      /** True when the validity window has passed — still a bolt11. */
      expired: boolean;
    }
  | {
      kind: "onchain";
      destination: string;
      addressType: "legacy" | "p2sh" | "segwit" | "taproot";
      /** Set only for a BIP21 URI whose amount is exact in whole sats. */
      amountSats?: number;
      viaBip21: boolean;
    }
  | { kind: "lightningAddress"; destination: string; intent: LnurlIntent }
  | { kind: "lnurl"; destination: string; intent: LnurlIntent }
  | { kind: "invalid"; code: InvalidCode; reason: string };

const REASONS: Record<InvalidCode, string> = {
  empty: "Nothing was pasted yet — paste a Bitcoin address, a Lightning invoice, an LNURL, or a Lightning address first.",
  "wrong-network":
    "That destination is for the Bitcoin test network, but this wallet only works on the main Bitcoin network. Check the destination and try again.",
  "malformed-invoice":
    "That Lightning invoice doesn't look complete, or it has a typing error in it. Copy the full invoice and try again.",
  "malformed-lnurl":
    "That LNURL doesn't look complete, or it has a typing error in it. Copy the full code and try again.",
  "malformed-address":
    "That Bitcoin address doesn't check out — a character may be missing or changed. Copy the full address and try again.",
  "malformed-lightning-address":
    "That Lightning address doesn't look right — it should look like a name followed by @ and a domain, for example name@wallet.example.",
  "spark-address":
    "That's a Spark address, and this wallet can't send to Spark addresses. It can be paid from your self-custody wallet instead.",
  unrecognised:
    "That doesn't look like a Bitcoin address, a Lightning invoice, an LNURL, or a Lightning address. Check what you pasted and try again.",
};

function invalid(code: InvalidCode): UnifiedSendInput {
  return { kind: "invalid", code, reason: REASONS[code] };
}

/** The LNURL intent carried by a classification, or null. */
export function lnurlIntentOf(input: UnifiedSendInput): LnurlIntent | null {
  return input.kind === "lightningAddress" || input.kind === "lnurl"
    ? input.intent
    : null;
}

// ── BOLT11 decode (client mirror of btc-core's decodeBolt11) ────────

function wordsToBytes(words: number[]): number[] {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  for (const w of words) {
    acc = (acc << 5) | w;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  return out;
}

function wordsToInt(words: number[]): number {
  let v = 0;
  for (const w of words) v = v * 32 + w;
  return v;
}

function bytesToHex(bytes: number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Amount from the invoice's human-readable part (BigInt, like btc-core). */
function amountMsatFromHrp(hrp: string): bigint | null {
  const match = hrp.match(/^ln(bc|tb|bcrt)(\d+)([munp]?)$/);
  if (!match) return null;
  const amount = BigInt(match[2]);
  switch (match[3]) {
    case "":
      return amount * 100_000_000_000n;
    case "m":
      return amount * 100_000_000n;
    case "u":
      return amount * 100_000n;
    case "n":
      return amount * 100n;
    case "p":
      if (amount % 10n !== 0n) return null;
      return amount / 10n;
    default:
      return null;
  }
}

type DecodedBolt11 = {
  amountMsat: bigint | null;
  timestampSeconds: number;
  expirySeconds: number;
  expiresAtSeconds: number;
  paymentHash: string | null;
  description: string | null;
};

/** Checksum-verified BOLT11 decode; null for anything malformed. */
function decodeBolt11Invoice(invoice: string): DecodedBolt11 | null {
  const cleaned = invoice.trim().toLowerCase();
  if (!cleaned.startsWith("ln")) return null;
  let decoded: { prefix: string; words: number[] };
  try {
    decoded = bech32.decode(cleaned, 16384) as {
      prefix: string;
      words: number[];
    };
  } catch {
    return null;
  }
  const words = decoded.words;
  if (!Array.isArray(words) || words.length < 7 + 104) return null;

  const timestampSeconds = wordsToInt(words.slice(0, 7));
  let expirySeconds = 3600;
  let paymentHash: string | null = null;
  let description: string | null = null;

  const fieldsEnd = words.length - 104;
  let pos = 7;
  while (pos + 3 <= fieldsEnd) {
    const type = words[pos];
    const len = words[pos + 1] * 32 + words[pos + 2];
    if (pos + 3 + len > fieldsEnd) return null;
    const data = words.slice(pos + 3, pos + 3 + len);
    if (type === 1 && paymentHash === null) {
      const bytes = wordsToBytes(data);
      if (bytes.length >= 32) paymentHash = bytesToHex(bytes.slice(0, 32));
    } else if (type === 6) {
      const v = wordsToInt(data);
      if (Number.isFinite(v) && v > 0) expirySeconds = v;
    } else if (type === 13 && description === null) {
      try {
        description = new TextDecoder("utf-8", { fatal: true }).decode(
          new Uint8Array(wordsToBytes(data)),
        );
      } catch {
        description = null;
      }
    }
    pos += 3 + len;
  }

  return {
    amountMsat: amountMsatFromHrp(decoded.prefix),
    timestampSeconds,
    expirySeconds,
    expiresAtSeconds: timestampSeconds + expirySeconds,
    paymentHash,
    description,
  };
}

function classifyBolt11(text: string, nowSeconds: number): UnifiedSendInput {
  if (/^ln(tb|bcrt)/i.test(text)) return invalid("wrong-network");
  const decoded = decodeBolt11Invoice(text);
  if (!decoded) return invalid("malformed-invoice");
  // A well-formed invoice on another network still isn't payable here.
  // (decodeBolt11Invoice accepted the bech32; the HRP gates the network.)
  return {
    kind: "bolt11",
    destination: text,
    amountMsat: decoded.amountMsat,
    amountSats:
      decoded.amountMsat !== null && decoded.amountMsat % 1000n === 0n
        ? Number(decoded.amountMsat / 1000n)
        : null,
    paymentHash: decoded.paymentHash,
    description: decoded.description,
    timestampSeconds: decoded.timestampSeconds,
    expiresAtSeconds: decoded.expiresAtSeconds,
    expired: nowSeconds >= decoded.expiresAtSeconds,
  };
}

// ── LNURL ────────────────────────────────────────────────────────────

function classifyLnurl(text: string): UnifiedSendInput {
  let decoded: { prefix: string; words: number[] };
  try {
    decoded = bech32.decode(text.toLowerCase(), 4096) as {
      prefix: string;
      words: number[];
    };
  } catch {
    return invalid("malformed-lnurl");
  }
  if (decoded.prefix !== "lnurl") return invalid("malformed-lnurl");
  let url: string;
  try {
    url = new TextDecoder("utf-8", { fatal: true }).decode(
      new Uint8Array(wordsToBytes(decoded.words)),
    );
  } catch {
    return invalid("malformed-lnurl");
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return invalid("malformed-lnurl");
  }
  const secure =
    parsed.protocol === "https:" ||
    (parsed.protocol === "http:" && parsed.hostname.endsWith(".onion"));
  if (!secure) return invalid("malformed-lnurl");
  return {
    kind: "lnurl",
    destination: text,
    intent: { type: "lnurl", lnurl: text, url },
  };
}

// ── Lightning address ────────────────────────────────────────────────

function classifyLightningAddress(text: string): UnifiedSendInput {
  const parts = text.split("@");
  if (parts.length !== 2) return invalid("malformed-lightning-address");
  const [username, domainRaw] = parts;
  const domain = domainRaw.toLowerCase();
  const usernameOk =
    username.length >= 1 &&
    username.length <= 64 &&
    /^[a-z0-9._%+-]+$/i.test(username) &&
    !username.startsWith(".") &&
    !username.endsWith(".") &&
    !username.includes("..");
  const labels = domain.split(".");
  const domainOk =
    labels.length >= 2 &&
    labels.every((l) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(l)) &&
    /^[a-z]{2,}$/.test(labels[labels.length - 1]);
  if (!usernameOk || !domainOk) return invalid("malformed-lightning-address");
  return {
    kind: "lightningAddress",
    destination: text,
    intent: { type: "lightningAddress", address: text, username, domain },
  };
}

// ── On-chain addresses ───────────────────────────────────────────────

function isTestnetAddressShape(text: string): boolean {
  return /^(tb1|bcrt1)/i.test(text) || /^[mn2][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(text);
}

function classifyAddress(text: string): UnifiedSendInput {
  if (isTestnetAddressShape(text)) return invalid("wrong-network");
  try {
    Address(NETWORK).decode(text);
  } catch {
    return invalid("malformed-address");
  }
  const lower = text.toLowerCase();
  const addressType = lower.startsWith("bc1p")
    ? "taproot"
    : lower.startsWith("bc1q")
      ? "segwit"
      : text.startsWith("3")
        ? "p2sh"
        : "legacy";
  return { kind: "onchain", destination: text, addressType, viaBip21: false };
}

// ── BIP21 ────────────────────────────────────────────────────────────

function classifyBip21(text: string, nowSeconds: number, depth: number): UnifiedSendInput {
  const rest = text.slice("bitcoin:".length);
  const qIndex = rest.indexOf("?");
  const addressPart = (qIndex === -1 ? rest : rest.slice(0, qIndex)).trim();
  const params = new URLSearchParams(qIndex === -1 ? "" : rest.slice(qIndex + 1));

  let address = "";
  try {
    address = decodeURIComponent(addressPart).trim();
  } catch {
    address = addressPart;
  }

  // Unified BIP21: a `lightning` parameter carries the payment
  // request. When it classifies, it wins — it is the same payment,
  // on the faster rail, with its own amount baked in. When it is for
  // the wrong network, that refusal is the honest answer too. Only
  // an unusable lightning parameter falls back to the address.
  const lightning = params.get("lightning");
  if (lightning && depth < 2) {
    const inner = classifyOnce(lightning.trim(), nowSeconds, depth + 1);
    if (inner.kind !== "invalid" || inner.code === "wrong-network") return inner;
  }

  if (address) {
    if (isTestnetAddressShape(address)) return invalid("wrong-network");
    if (looksLikeBitcoinAddress(address)) {
      const classified = classifyAddress(address);
      if (classified.kind === "onchain") {
        const amountRaw = params.get("amount");
        const amountSats = amountRaw ? btcAmountToSats(amountRaw) : undefined;
        return amountSats !== undefined
          ? { ...classified, viaBip21: true, amountSats }
          : { ...classified, viaBip21: true };
      }
      return classified;
    }
    return invalid("malformed-address");
  }

  return invalid("unrecognised");
}

// ── The classifier ───────────────────────────────────────────────────

function classifyOnce(raw: string, nowSeconds: number, depth: number): UnifiedSendInput {
  const text = raw.trim();
  if (!text) return invalid("empty");

  // lnurl:// scheme: what follows must be an LNURL.
  if (/^lnurl:\/\//i.test(text)) {
    const inner = text.replace(/^lnurl:\/\//i, "").trim();
    return /^lnurl1/i.test(inner) ? classifyLnurl(inner) : invalid("malformed-lnurl");
  }

  // lightning: wraps an invoice, an LNURL, or a Lightning address.
  if (/^lightning:/i.test(text)) {
    const inner = text
      .replace(/^lightning:/i, "")
      .replace(/^\/\//, "")
      .trim();
    if (!inner) return invalid("unrecognised");
    return depth < 2 ? classifyOnce(inner, nowSeconds, depth + 1) : invalid("unrecognised");
  }

  if (/^bitcoin:/i.test(text)) return classifyBip21(text, nowSeconds, depth);

  if (/^lnurl1/i.test(text)) return classifyLnurl(text);

  if (/^ln(bc|tb|bcrt)/i.test(text)) return classifyBolt11(text, nowSeconds);

  if (/^spark1[0-9a-z]{10,}$/i.test(text)) return invalid("spark-address");

  if (text.includes("@")) return classifyLightningAddress(text);

  if (looksLikeBitcoinAddress(text)) return classifyAddress(text);

  // Address-shaped but structurally off (bad charset / length): give
  // the address-specific reason rather than the generic one.
  if (/^bc1[0-9a-z]+$/i.test(text) || /^[13][a-km-zA-HJ-NP-Z1-9]{10,}$/.test(text)) {
    return isTestnetAddressShape(text) ? invalid("wrong-network") : invalid("malformed-address");
  }

  return invalid("unrecognised");
}

/**
 * Classify a pasted or scanned string into exactly one send
 * destination (see the module header for the routing matrix).
 * `nowSeconds` is injectable for tests; it only drives the bolt11
 * `expired` flag — an expired invoice still classifies as bolt11.
 */
export function classifySendInput(
  raw: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): UnifiedSendInput {
  const first = classifyOnce(raw, nowSeconds, 0);
  if (first.kind !== "invalid") return first;
  // A long invoice or code pasted from a wrapped message can arrive
  // with line breaks inside it. Retry once with all whitespace
  // removed before refusing — the retry is held to exactly the same
  // checksum validation, so this can only rescue a genuinely wrapped
  // valid destination, never bless a broken one.
  const compact = raw.replace(/\s+/g, "");
  if (compact && compact !== raw.trim()) {
    const retried = classifyOnce(compact, nowSeconds, 0);
    if (retried.kind !== "invalid") return retried;
  }
  return first;
}
