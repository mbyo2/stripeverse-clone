// btc-core: pure Bitcoin helpers shared by the BTC edge functions.
//
// Everything here is side-effect free and unit-tested (tests/bitcoin/)
// against published BIP84 test vectors. No Deno APIs, no env, no network.
//
// Custody model: ONE platform account at m/84'/0'/0' (BIP84, mainnet).
//   chain 0 / index N  → user deposit addresses (from the account zpub)
//   chain 1 / index N  → platform change addresses
// Deposit derivation only ever needs the zpub (watch-only). Signing needs
// the account key derived from BTC_SEED_MNEMONIC — never stored, only in
// the function's secret env at runtime.

import { HDKey } from "npm:@scure/bip32@2.4.0";
import {
  mnemonicToSeedSync,
  validateMnemonic,
} from "npm:@scure/bip39@2.4.0";
import { wordlist } from "npm:@scure/bip39@2.4.0/wordlists/english.js";
import {
  Address,
  NETWORK,
  OutScript,
  Transaction,
  p2wpkh,
} from "npm:@scure/btc-signer@2.4.1";
import { sha256 } from "npm:@scure/btc-signer@2.4.1/utils.js";
import { base58check } from "npm:@scure/base@2.4.0";

export const SATS_PER_BTC = 100_000_000;
export const DUST_LIMIT_SATS = 546;
export const ACCOUNT_PATH = "m/84'/0'/0'";

const XPUB_VERSION = [0x04, 0x88, 0xb2, 0x1e];
const ZPUB_VERSION = [0x04, 0xb2, 0x47, 0x46];

const b58c = base58check(sha256);

// ── Keys & derivation ──────────────────────────────────────────────────────

/** Convert a zpub (BIP84 version bytes) to the equivalent xpub string. */
export function zpubToXpub(zpub: string): string {
  const raw = b58c.decode(zpub);
  const version = Array.from(raw.slice(0, 4)).join(",");
  if (version !== ZPUB_VERSION.join(",")) {
    throw new Error("Not a zpub (unexpected version bytes)");
  }
  const out = new Uint8Array(raw);
  out.set(XPUB_VERSION, 0);
  return b58c.encode(out);
}

/**
 * Parse the platform account key from BTC_XPUB. Accepts a zpub (preferred —
 * it self-describes BIP84) or a raw xpub at the account level
 * (m/84'/0'/0'). Anything else (ypub, tpub, garbage) is rejected so a
 * misconfigured secret fails loudly instead of deriving wrong addresses.
 */
export function parseAccountKey(extendedKey: string): HDKey {
  const key = extendedKey.trim();
  if (key.startsWith("zpub")) {
    return HDKey.fromExtendedKey(zpubToXpub(key));
  }
  if (key.startsWith("xpub")) {
    return HDKey.fromExtendedKey(key);
  }
  throw new Error(
    "BTC_XPUB must be a mainnet zpub (or xpub) at account level m/84'/0'/0'",
  );
}

/** Derive the account key (with private keys) from the master mnemonic. */
export function accountKeyFromMnemonic(mnemonic: string): HDKey {
  const clean = mnemonic.trim().toLowerCase().replace(/\s+/g, " ");
  if (!validateMnemonic(clean, wordlist)) {
    throw new Error("BTC_SEED_MNEMONIC is not a valid BIP39 mnemonic");
  }
  const root = HDKey.fromMasterSeed(mnemonicToSeedSync(clean));
  return root.derive(ACCOUNT_PATH);
}

// ── Custody configuration ──────────────────────────────────────────────

export type CustodyStatus =
  | { configured: true; accountPriv: HDKey; accountPub: HDKey }
  | {
      configured: false;
      reason:
        | "missing_seed"
        | "missing_xpub"
        | "invalid_seed"
        | "invalid_xpub"
        | "seed_xpub_mismatch";
    };

/**
 * Custody is "configured" only when BOTH secrets are present, both
 * parse, AND the seed controls the same account the zpub watches (the
 * seed⇄xpub interlock: first receiving addresses must match). Anything
 * else — a missing secret, a malformed one, or a mismatched pair — is
 * NOT configured, and every custodial operation must refuse with the
 * designed plain-language message instead of touching money paths.
 *
 * The `reason` is operator-facing detail for server logs only; users
 * always see the same truthful refusal regardless of which check failed.
 */
export function custodyStatus(
  mnemonic: string | null | undefined,
  xpub: string | null | undefined,
): CustodyStatus {
  if (!mnemonic || !mnemonic.trim()) {
    return { configured: false, reason: "missing_seed" };
  }
  if (!xpub || !xpub.trim()) {
    return { configured: false, reason: "missing_xpub" };
  }
  let accountPriv: HDKey;
  try {
    accountPriv = accountKeyFromMnemonic(mnemonic);
  } catch {
    return { configured: false, reason: "invalid_seed" };
  }
  let accountPub: HDKey;
  try {
    accountPub = parseAccountKey(xpub);
  } catch {
    return { configured: false, reason: "invalid_xpub" };
  }
  if (deriveAddress(accountPriv, 0, 0) !== deriveAddress(accountPub, 0, 0)) {
    return { configured: false, reason: "seed_xpub_mismatch" };
  }
  return { configured: true, accountPriv, accountPub };
}

export function deriveChildKey(
  account: HDKey,
  chain: 0 | 1,
  index: number,
): HDKey {
  if (!Number.isInteger(index) || index < 0 || index > 0x7fffffff) {
    throw new Error("Derivation index out of range");
  }
  return account.deriveChild(chain).deriveChild(index);
}

/** BIP84 deposit/change address for (chain, index). */
export function deriveAddress(
  account: HDKey,
  chain: 0 | 1,
  index: number,
): string {
  const child = deriveChildKey(account, chain, index);
  if (!child.publicKey) throw new Error("Missing public key");
  return p2wpkh(child.publicKey).address!;
}

export function deriveScript(
  account: HDKey,
  chain: 0 | 1,
  index: number,
): Uint8Array {
  const child = deriveChildKey(account, chain, index);
  if (!child.publicKey) throw new Error("Missing public key");
  return p2wpkh(child.publicKey).script;
}

// ── Address validation ─────────────────────────────────────────────────────

export interface ValidatedAddress {
  script: Uint8Array;
  type: string;
}

/**
 * Validate a MAINNET address and return its output script. Testnet and
 * malformed addresses throw — a withdrawal to one must be impossible.
 */
export function validateMainnetAddress(address: string): ValidatedAddress {
  let decoded;
  try {
    decoded = Address(NETWORK).decode(address.trim());
  } catch {
    throw new Error("Invalid Bitcoin address");
  }
  return { script: OutScript.encode(decoded), type: decoded.type };
}

// ── Fee estimation & coin selection ────────────────────────────────────────

// P2WPKH input ≈ 68 vB; tx overhead (version, segwit marker/flag, counts,
// locktime) ≈ 10.5 vB. Validated against @scure/btc-signer's tx.vsize in
// the unit tests (1-in/2-out → 141 vB).
export function estimateVsize(
  inputCount: number,
  outputScripts: Uint8Array[],
): number {
  const outputs = outputScripts.reduce((sum, s) => sum + 9 + s.length, 0);
  return Math.ceil(10.5 + inputCount * 68 + outputs);
}

export interface Utxo {
  txid: string;
  vout: number;
  value: number; // sats
  chain: 0 | 1;
  index: number;
}

export interface CoinSelection {
  selected: Utxo[];
  feeSats: number;
  changeSats: number;
}

/**
 * Largest-first coin selection. Deterministic; returns null when the
 * available UTXOs cannot cover target + fee. Change below the dust limit
 * is folded into the fee (never creates an unspendable output).
 */
export function selectCoins(
  utxos: Utxo[],
  targetSats: number,
  feeRateSatVb: number,
  recipientScript: Uint8Array,
  changeScript: Uint8Array,
): CoinSelection | null {
  const rate = Math.max(1, Math.ceil(feeRateSatVb));
  const sorted = [...utxos]
    .filter((u) => u.value > 0)
    .sort((a, b) => b.value - a.value);

  const picked: Utxo[] = [];
  let total = 0;

  for (const utxo of sorted) {
    picked.push(utxo);
    total += utxo.value;

    const feeWithChange = estimateVsize(picked.length, [
      recipientScript,
      changeScript,
    ]) * rate;
    if (total >= targetSats + feeWithChange) {
      const change = total - targetSats - feeWithChange;
      if (change >= DUST_LIMIT_SATS) {
        return { selected: picked, feeSats: feeWithChange, changeSats: change };
      }
      // Change would be dust: drop the change output and re-check.
      const feeNoChange = estimateVsize(picked.length, [recipientScript]) *
        rate;
      if (total >= targetSats + feeNoChange) {
        return {
          selected: picked,
          feeSats: total - targetSats,
          changeSats: 0,
        };
      }
    }
  }
  return null;
}

// ── Withdrawal transaction building & signing ──────────────────────────────

export interface BuiltWithdrawal {
  hex: string;
  txid: string;
  feeSats: number;
  changeSats: number;
  vsize: number;
  changeIndex: number;
}

/**
 * Build and sign an on-chain withdrawal from platform UTXOs.
 * `accountPriv` must carry private keys (from accountKeyFromMnemonic).
 * Change goes to chain 1 / `changeIndex`. Throws on insufficient funds.
 */
export function buildWithdrawalTx(params: {
  accountPriv: HDKey;
  accountPub: HDKey;
  utxos: Utxo[];
  toAddress: string;
  amountSats: number;
  feeRateSatVb: number;
  changeIndex: number;
}): BuiltWithdrawal {
  const { accountPriv, accountPub, utxos, toAddress, amountSats } = params;
  const recipient = validateMainnetAddress(toAddress);
  const changeScript = deriveScript(accountPub, 1, params.changeIndex);

  const selection = selectCoins(
    utxos,
    amountSats,
    params.feeRateSatVb,
    recipient.script,
    changeScript,
  );
  if (!selection) throw new Error("Insufficient platform UTXO funds");

  const tx = new Transaction();
  for (const utxo of selection.selected) {
    const script = deriveScript(accountPub, utxo.chain, utxo.index);
    tx.addInput({
      txid: utxo.txid,
      index: utxo.vout,
      witnessUtxo: { script, amount: BigInt(utxo.value) },
    });
  }
  tx.addOutputAddress(toAddress, BigInt(amountSats));
  if (selection.changeSats > 0) {
    tx.addOutputAddress(
      deriveAddress(accountPub, 1, params.changeIndex),
      BigInt(selection.changeSats),
    );
  }

  for (const utxo of selection.selected) {
    const key = deriveChildKey(accountPriv, utxo.chain, utxo.index);
    if (!key.privateKey) throw new Error("Missing private key for input");
    tx.sign(key.privateKey);
  }
  tx.finalize();

  return {
    hex: tx.hex,
    txid: tx.id,
    feeSats: Number(tx.fee),
    changeSats: selection.changeSats,
    vsize: tx.vsize,
    changeIndex: params.changeIndex,
  };
}

// ── Buy/sell quote math (integer-safe; rounding favours the platform) ─────

function floorToCents(x: number): number {
  // The +1e-9 corrects binary representation error only (e.g. 14.78 stored
  // as 14.779999…); it is eight orders of magnitude below one ngwee, so it
  // can never round a genuine sub-cent remainder up to the next cent.
  return Math.floor((x + 1e-9) * 100) / 100;
}

export interface BuyQuote {
  sats: number;
  feeZmw: number;
}

/**
 * Buy: the user pays `amountZmw`; the spread is applied by raising the
 * effective rate. Credited sats are FLOORED — the user can never receive
 * fractional value created by rounding.
 */
export function quoteBuySats(
  amountZmw: number,
  midRateZmwPerBtc: number,
  feeBps: number,
): BuyQuote {
  if (!(amountZmw > 0) || !(midRateZmwPerBtc > 0)) {
    throw new Error("Invalid buy quote inputs");
  }
  const effectiveRate = midRateZmwPerBtc * (1 + feeBps / 10_000);
  const sats = Math.floor((amountZmw * SATS_PER_BTC) / effectiveRate);
  const midValueZmw = (sats * midRateZmwPerBtc) / SATS_PER_BTC;
  const feeZmw = floorToCents(amountZmw - midValueZmw);
  return { sats, feeZmw };
}

export interface SellQuote {
  zmw: number;
  feeZmw: number;
}

/**
 * Sell: the user gives `amountSats`; credited ZMW is the mid value minus
 * the spread, FLOORED to whole ngwee — again in the platform's favour.
 */
export function quoteSellZmw(
  amountSats: number,
  midRateZmwPerBtc: number,
  feeBps: number,
): SellQuote {
  if (!(amountSats > 0) || !(midRateZmwPerBtc > 0)) {
    throw new Error("Invalid sell quote inputs");
  }
  const grossZmw = (amountSats * midRateZmwPerBtc) / SATS_PER_BTC;
  const net = floorToCents(grossZmw * (1 - feeBps / 10_000));
  const feeZmw = Math.round((grossZmw - net) * 100) / 100;
  return { zmw: net, feeZmw };
}

// ── BOLT11 amount decoding (integer math only) ─────────────────────────────

/**
 * Decode a BOLT11 invoice's amount to millisatoshis using BigInt — no
 * floating point anywhere near money. Returns null for amount-less or
 * malformed invoices. (The previous implementation used floats and could
 * misprice pico-denominated invoices; see breez-lightning history.)
 */
export function decodeBolt11Msat(bolt11: string): bigint | null {
  const match = bolt11.toLowerCase().match(/^ln(bc|tb|bcrt)(\d+)([munp]?)1/);
  if (!match) return null;
  const amount = BigInt(match[2]);
  const mult = match[3];
  // 1 BTC = 100_000_000_000 msat
  switch (mult) {
    case "":
      return amount * 100_000_000_000n;
    case "m":
      return amount * 100_000_000n;
    case "u":
      return amount * 100_000n;
    case "n":
      return amount * 100n;
    case "p":
      // 1 pBTC = 0.1 msat; BOLT11 requires pico amounts divisible by 10.
      if (amount % 10n !== 0n) return null;
      return amount / 10n;
    default:
      return null;
  }
}
