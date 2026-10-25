// Scan-to-send payload parsing (CEO ask, 2026-10-25: "For sending
// bitcoin where is scanning of the qr code?").
//
// A scanned QR code is untrusted text until it is classified. This
// module is the single classifier: it turns raw scanned text into a
// typed destination the send forms already know how to review — a
// Bitcoin address, a BIP21 URI (address + optional exact amount), a
// BOLT11 invoice, an LNURL, a Spark address, or a Lightning address —
// or "unknown", in which case the forms show their crafted
// plain-language error and nothing is filled in.
//
// Money-safety rules baked in here:
//   - A scan only ever FILLS the destination (and, for BIP21, the
//     amount) field. It never sends, prepares, or skips the review
//     step — the forms' existing parse → prepare → confirm flow is
//     untouched.
//   - BIP21 amounts are converted BTC → sats with exact decimal
//     string maths (never floats). An amount that cannot be
//     represented exactly in whole sats (more than 8 decimal places,
//     non-numeric, zero) is dropped, never rounded — the user then
//     types the amount themselves instead of sending a wrong one.
//   - Classification is structural only (character sets and shapes).
//     Full validation still happens downstream in the wallet's own
//     destination recogniser / the send RPC, exactly as for pasted
//     destinations.

export type QrPayload =
  | { kind: "address"; destination: string }
  | { kind: "bip21"; destination: string; amountSats?: number }
  | { kind: "bolt11"; destination: string }
  | { kind: "lnurl"; destination: string }
  | { kind: "sparkAddress"; destination: string }
  | { kind: "lightningAddress"; destination: string }
  | { kind: "unknown" };

const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

function isBech32Data(text: string): boolean {
  if (text.length === 0) return false;
  for (const ch of text.toLowerCase()) {
    if (!BECH32_CHARSET.includes(ch)) return false;
  }
  return true;
}

/** Structural mainnet/testnet Bitcoin address check (bech32 + base58). */
export function looksLikeBitcoinAddress(value: string): boolean {
  const v = value.trim();
  // Bech32 / bech32m: bc1…, tb1…, bcrt1… (case-insensitive, one case only
  // is enforced downstream; here we only check the character set).
  const bech32 = /^(bc1|tb1|bcrt1)([0-9a-z]+)$/i.exec(v);
  if (bech32) {
    const data = bech32[2];
    return data.length >= 11 && data.length <= 71 && isBech32Data(data);
  }
  // Base58 legacy / P2SH (mainnet 1…/3…, testnet m…/n…/2…).
  return /^[13mn2][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(v);
}

function looksLikeBolt11(value: string): boolean {
  const v = value.trim().toLowerCase();
  // HRP: ln + currency (bc/tb/bcrt) + optional amount digits/multiplier,
  // then the bech32 separator "1" and the data part.
  const m = /^ln(bc|tb|bcrt)[0-9a-z]*1([0-9a-z]+)$/.exec(v);
  if (!m) return false;
  return m[2].length >= 10 && isBech32Data(m[2]);
}

function looksLikeLnurl(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (!v.startsWith("lnurl1")) return false;
  const data = v.slice("lnurl1".length);
  return data.length >= 10 && isBech32Data(data);
}

function looksLikeSparkAddress(value: string): boolean {
  return /^spark1[0-9a-z]{10,}$/i.test(value.trim());
}

function looksLikeLightningAddress(value: string): boolean {
  return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(value.trim());
}

/**
 * Convert a BIP21 BTC amount string to whole sats with exact decimal
 * maths. Returns undefined when the amount cannot be represented
 * exactly (non-numeric, more than 8 decimal places, zero, negative,
 * or beyond the safe-integer range) — callers must then leave the
 * amount field for the user rather than prefill a rounded figure.
 */
export function btcAmountToSats(amount: string): number | undefined {
  const m = /^(\d*)(?:\.(\d+))?$/.exec(amount.trim());
  if (!m) return undefined;
  const intPart = m[1] ?? "";
  const fracPart = m[2] ?? "";
  if (intPart === "" && fracPart === "") return undefined;
  if (fracPart.length > 8) return undefined;
  const sats =
    BigInt(intPart === "" ? "0" : intPart) * 100_000_000n +
    BigInt((fracPart + "00000000").slice(0, 8));
  if (sats <= 0n) return undefined;
  if (sats > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
  return Number(sats);
}

function parseBip21(uri: string): QrPayload {
  const rest = uri.slice("bitcoin:".length);
  const qIndex = rest.indexOf("?");
  const addressPart = (qIndex === -1 ? rest : rest.slice(0, qIndex)).trim();
  const params = new URLSearchParams(qIndex === -1 ? "" : rest.slice(qIndex + 1));

  let address = "";
  try {
    address = decodeURIComponent(addressPart).trim();
  } catch {
    address = addressPart;
  }

  if (address && looksLikeBitcoinAddress(address)) {
    const amountRaw = params.get("amount");
    const amountSats = amountRaw ? btcAmountToSats(amountRaw) : undefined;
    return amountSats !== undefined
      ? { kind: "bip21", destination: address, amountSats }
      : { kind: "bip21", destination: address };
  }

  // Unified QR codes may carry the payment request in the `lightning`
  // parameter with an empty or absent address part.
  const lightning = params.get("lightning");
  if (lightning) {
    const inner = parseQrPayload(lightning);
    if (inner.kind === "bolt11" || inner.kind === "lnurl") return inner;
  }
  return { kind: "unknown" };
}

/** Classify raw scanned text into a send destination (see header). */
export function parseQrPayload(raw: string): QrPayload {
  const text = raw.trim();
  if (!text) return { kind: "unknown" };

  if (/^bitcoin:/i.test(text)) return parseBip21(text);

  // A `lightning:` URI prefix wraps an invoice, an LNURL, or a
  // Lightning address — classify what is inside it.
  if (/^lightning:/i.test(text)) {
    const inner = text.slice("lightning:".length).trim();
    if (!inner) return { kind: "unknown" };
    if (looksLikeBolt11(inner)) return { kind: "bolt11", destination: inner };
    if (looksLikeLnurl(inner)) return { kind: "lnurl", destination: inner };
    if (looksLikeLightningAddress(inner)) {
      return { kind: "lightningAddress", destination: inner };
    }
    return { kind: "unknown" };
  }

  if (looksLikeBolt11(text)) return { kind: "bolt11", destination: text };
  if (looksLikeLnurl(text)) return { kind: "lnurl", destination: text };
  if (looksLikeBitcoinAddress(text)) return { kind: "address", destination: text };
  if (looksLikeSparkAddress(text)) return { kind: "sparkAddress", destination: text };
  if (looksLikeLightningAddress(text)) {
    return { kind: "lightningAddress", destination: text };
  }
  return { kind: "unknown" };
}
