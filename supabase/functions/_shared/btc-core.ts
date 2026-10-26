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
import { base58check, bech32 } from "npm:@scure/base@2.4.0";

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

/**
 * Normalize a mnemonic as typed/pasted by an operator into the bare
 * space-separated word list BIP39 validation expects.
 *
 * Operators copy seed phrases out of wallet apps and documents where the
 * words arrive decorated: numbered lists ("1. abandon, 2. ability …"),
 * commas, line breaks, tabs, ALL-CAPS emphasis, stray punctuation,
 * invisible characters riding along in a paste. None of that is part of
 * the phrase — only the words are. So normalization is deliberately
 * maximal: lowercase, then treat ANY run of characters that is not a
 * lowercase ASCII letter as a separator, and drop the empty pieces.
 * Digits, punctuation, whitespace and zero-width characters all vanish;
 * the word sequence that remains is the phrase.
 *
 * This forgives formatting ONLY. Validation after normalization is the
 * full BIP39 check (every word on the English wordlist AND the embedded
 * checksum) in accountKeyFromMnemonic, and custodyStatus still requires
 * the seed to derive the very account BTC_XPUB watches before any
 * spending path unlocks. A wrong word, a missing word or an extra word
 * still fails — normalization never invents, drops or reorders words.
 */
export function normalizeMnemonic(raw: string): string {
  return raw
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((word) => word.length > 0)
    .join(" ");
}

/** Derive the account key (with private keys) from the master mnemonic. */
export function accountKeyFromMnemonic(mnemonic: string): HDKey {
  const clean = normalizeMnemonic(mnemonic);
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

// ── Capability checks (per-feature gates) ──────────────────────────────────
//
// Custody is not all-or-nothing. Each Bitcoin capability has its own
// minimum requirement, and the edge functions gate on the capability
// they actually need:
//
//   RECEIVE (deposit addresses + deposit detection/crediting)
//     needs ONLY the account zpub. Receiving is watch-only: funds land
//     in the wallet the zpub came from, and no spending is possible
//     from a zpub. Requiring the seed here would needlessly take
//     deposits offline whenever the seed is not installed.
//
//   LIGHTNING (custodial, via Breez)
//     needs ONLY BREEZ_API_KEY. Breez runs its own nodeless wallet
//     server-side; the on-chain seed is never involved. The sats still
//     settle into the same crypto_wallets BTC balance in our ledger.
//
//   SPEND (on-chain withdrawals + buy/sell trades)
//     needs the FULL custodyStatus interlock above: seed present,
//     xpub present, and the two proven to control the same account.
//     Anything less must refuse — this is the path that moves money.

export type ReceiveStatus =
  | { configured: true; accountPub: HDKey }
  | { configured: false; reason: "missing_xpub" | "invalid_xpub" };

/** Receiving capability: a present, parseable account zpub is enough. */
export function receiveStatus(
  xpub: string | null | undefined,
): ReceiveStatus {
  if (!xpub || !xpub.trim()) {
    return { configured: false, reason: "missing_xpub" };
  }
  try {
    return { configured: true, accountPub: parseAccountKey(xpub) };
  } catch {
    return { configured: false, reason: "invalid_xpub" };
  }
}

export interface BitcoinCapabilities {
  /** Deposit addresses + deposit crediting (xpub only). */
  canReceive: boolean;
  /** Custodial Lightning via Breez (BREEZ_API_KEY only). */
  canLightning: boolean;
  /** Withdrawals + buy/sell (full seed⇄xpub interlock). */
  canSpend: boolean;
  receive: ReceiveStatus;
  spend: CustodyStatus;
}

/**
 * Evaluate every capability from the deployment's secrets in one call,
 * so the gates can never drift apart. `spend` carries the full
 * custodyStatus result for its detailed operator-facing reason.
 */
export function bitcoinCapabilities(input: {
  mnemonic?: string | null;
  xpub?: string | null;
  breezApiKey?: string | null;
}): BitcoinCapabilities {
  const receive = receiveStatus(input.xpub);
  const spend = custodyStatus(input.mnemonic, input.xpub);
  return {
    canReceive: receive.configured,
    canLightning: Boolean(input.breezApiKey && input.breezApiKey.trim()),
    canSpend: spend.configured,
    receive,
    spend,
  };
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

// ── UTXO consolidation (protection P2b, 2026-10-26) ─────────────────────
//
// Every link attempt and deposit leaves UTXOs in the pooled custodial
// wallet. Small ones cost more to spend later (≈68 vB each at
// whatever the future fee rate is) than they contributed in fee
// income, quietly inflating future withdrawal fees (gas audit
// row 4). The consolidation duty sweeps small UTXOs into one output
// when the network is cheap. The DECISIONS live here, pure, like
// every other money policy in this module; the edge function only
// gathers observations and executes a plan this code produced.

export interface ConsolidationPolicy {
  /** UTXOs worth at most this many sats count as "small". */
  smallMaxSats: number;
  /** Fewer eligible inputs than this → not worth a transaction. */
  minInputs: number;
  /** Hard cap on inputs per consolidation transaction. */
  maxInputs: number;
  /** Never broadcast above this fee rate (sat/vB) — the fee-window
   *  gate from the shared policy (platform_settings). */
  maxFeeRateSatVb: number;
}

export type ConsolidationSkipReason =
  | "fee_window_closed"
  | "too_few_inputs"
  | "output_below_dust";

export interface ConsolidationPlan {
  /** The inputs to spend, smallest first. */
  inputs: Utxo[];
  totalInSats: number;
  feeSats: number;
  outputSats: number;
  feeRateSatVb: number;
}

/**
 * Plan a consolidation from the pool's UTXOs at `feeRateSatVb`:
 * eligible inputs are confirmed UTXOs worth ≤ smallMaxSats,
 * smallest first (the dust goes first), capped at maxInputs. The
 * plan is null — with the reason — when the fee window is closed,
 * too few inputs are eligible, or the single output would fall
 * below the dust limit after fees. The fee is estimated with the
 * same estimateVsize the withdrawal path uses (one P2WPKH output).
 */
export function planConsolidation(
  utxos: Utxo[],
  policy: ConsolidationPolicy,
  feeRateSatVb: number,
  outputScript: Uint8Array,
): ConsolidationPlan | { skip: ConsolidationSkipReason } {
  const rate = Math.max(1, Math.ceil(feeRateSatVb));
  if (rate > Math.max(1, Math.floor(policy.maxFeeRateSatVb))) {
    return { skip: "fee_window_closed" };
  }
  const eligible = utxos
    .filter((u) => u.value > 0 && u.value <= policy.smallMaxSats)
    .sort((a, b) => a.value - b.value)
    .slice(0, Math.max(0, policy.maxInputs));
  if (eligible.length < policy.minInputs) {
    return { skip: "too_few_inputs" };
  }
  const totalInSats = eligible.reduce((s, u) => s + u.value, 0);
  const feeSats = estimateVsize(eligible.length, [outputScript]) * rate;
  const outputSats = totalInSats - feeSats;
  if (outputSats < DUST_LIMIT_SATS) {
    return { skip: "output_below_dust" };
  }
  return { inputs: eligible, totalInSats, feeSats, outputSats, feeRateSatVb: rate };
}

export interface BuiltConsolidation {
  hex: string;
  txid: string;
  feeSats: number;
  outputSats: number;
  vsize: number;
}

/**
 * Build and sign a consolidation transaction: spend EVERY given
 * input into one output at (outputChain, outputIndex) of the same
 * account. The fee is re-derived from the built transaction and
 * checked against the plan (the caller passes its planned fee); a
 * mismatch throws rather than broadcasting a surprise. Throws on an
 * output below dust.
 */
export function buildConsolidationTx(params: {
  accountPriv: HDKey;
  accountPub: HDKey;
  inputs: Utxo[];
  feeRateSatVb: number;
  outputChain: 0 | 1;
  outputIndex: number;
  expectedFeeSats: number;
}): BuiltConsolidation {
  const { accountPriv, accountPub, inputs } = params;
  if (inputs.length === 0) throw new Error("No inputs to consolidate");
  const outputScript = deriveScript(
    accountPub,
    params.outputChain,
    params.outputIndex,
  );
  const rate = Math.max(1, Math.ceil(params.feeRateSatVb));
  const totalIn = inputs.reduce((s, u) => s + u.value, 0);
  const feeSats = estimateVsize(inputs.length, [outputScript]) * rate;
  const outputSats = totalIn - feeSats;
  if (outputSats < DUST_LIMIT_SATS) {
    throw new Error("Consolidation output would be dust");
  }
  if (feeSats !== params.expectedFeeSats) {
    throw new Error("Fee mismatch between consolidation plan and built transaction");
  }

  const tx = new Transaction();
  for (const utxo of inputs) {
    const script = deriveScript(accountPub, utxo.chain, utxo.index);
    tx.addInput({
      txid: utxo.txid,
      index: utxo.vout,
      witnessUtxo: { script, amount: BigInt(utxo.value) },
    });
  }
  tx.addOutputAddress(
    deriveAddress(accountPub, params.outputChain, params.outputIndex),
    BigInt(outputSats),
  );
  for (const utxo of inputs) {
    const key = deriveChildKey(accountPriv, utxo.chain, utxo.index);
    if (!key.privateKey) throw new Error("Missing private key for input");
    tx.sign(key.privateKey);
  }
  tx.finalize();

  return {
    hex: tx.hex,
    txid: tx.id,
    feeSats: Number(tx.fee),
    outputSats,
    vsize: tx.vsize,
  };
}

// ── Spent-outpoint tracking (send concurrency, audit M1) ─────────────────

/** A reference to one transaction output. */
export interface Outpoint {
  txid: string;
  vout: number;
}

/** Canonical key for an outpoint (map/set membership). */
export function outpointKey(txid: string, vout: number): string {
  return `${txid}:${vout}`;
}

/**
 * The outpoints a transaction spends, parsed from an esplora
 * transaction object (`vin[].txid` / `vin[].vout`). Defensive by
 * design: malformed entries are skipped rather than thrown — this
 * feeds a safety filter in the send path, and a parse hiccup must
 * never take a withdrawal down with it.
 */
export function spentOutpointsFromTx(tx: unknown): Outpoint[] {
  const vin = (tx as { vin?: unknown } | null | undefined)?.vin;
  if (!Array.isArray(vin)) return [];
  const out: Outpoint[] = [];
  for (const entry of vin) {
    const txid = (entry as { txid?: unknown } | null | undefined)?.txid;
    const vout = (entry as { vout?: unknown } | null | undefined)?.vout;
    if (typeof txid === "string" && txid.length > 0 && Number.isInteger(vout)) {
      out.push({ txid, vout: Number(vout) });
    }
  }
  return out;
}

/**
 * A UTXO set minus every outpoint already committed elsewhere — the
 * inputs of in-flight withdrawals whose transactions are known to be
 * on the network. Order is preserved: coin selection is
 * deterministic, so filtering (never reordering) keeps an unaffected
 * selection identical.
 */
export function filterUncommittedUtxos(
  utxos: Utxo[],
  committed: Iterable<Outpoint>,
): Utxo[] {
  const spent = new Set<string>();
  for (const o of committed) spent.add(outpointKey(o.txid, o.vout));
  if (spent.size === 0) return [...utxos];
  return utxos.filter((u) => !spent.has(outpointKey(u.txid, u.vout)));
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

// ── Withdrawal batching (P4, 2026-10-26) ──────────────────────────────────
//
// Low-fee-window batching for custodial withdrawals (design in
// pay-with-bitcoin-addendum-2026-10-26.md, "Three protections" → P4;
// queue/reserve/settle contract in migration 20261225). Queued
// withdrawals reserve amount + their SOLO fee estimate; the batcher
// forms ONE multi-output transaction when the network is cheap (or
// the oldest queue member has waited the configured maximum). The
// DECISIONS live here, pure, like every other money policy in this
// module; the edge function gathers observations and executes.

/**
 * Multi-recipient coin selection: selectCoins generalised to N
 * payment outputs. Largest-first, deterministic; returns null when
 * the UTXOs cannot cover totalTarget + fee. The fee is sized with
 * estimateVsize over ALL payment scripts (+ the change script when
 * change survives the dust limit; dust change folds into the fee,
 * exactly as in the solo path).
 */
export function selectCoinsMulti(
  utxos: Utxo[],
  totalTargetSats: number,
  feeRateSatVb: number,
  paymentScripts: Uint8Array[],
  changeScript: Uint8Array,
): CoinSelection | null {
  if (paymentScripts.length === 0) return null;
  const rate = Math.max(1, Math.ceil(feeRateSatVb));
  const sorted = [...utxos]
    .filter((u) => u.value > 0)
    .sort((a, b) => b.value - a.value);

  const picked: Utxo[] = [];
  let total = 0;

  for (const utxo of sorted) {
    picked.push(utxo);
    total += utxo.value;

    const feeWithChange = estimateVsize(
      picked.length,
      [...paymentScripts, changeScript],
    ) * rate;
    if (total >= totalTargetSats + feeWithChange) {
      const change = total - totalTargetSats - feeWithChange;
      if (change >= DUST_LIMIT_SATS) {
        return { selected: picked, feeSats: feeWithChange, changeSats: change };
      }
      const feeNoChange = estimateVsize(picked.length, paymentScripts) * rate;
      if (total >= totalTargetSats + feeNoChange) {
        return {
          selected: picked,
          feeSats: total - totalTargetSats,
          changeSats: 0,
        };
      }
    }
  }
  return null;
}

export interface BatchPayment {
  toAddress: string;
  amountSats: number;
}

export interface BuiltBatchWithdrawal {
  hex: string;
  txid: string;
  feeSats: number;
  changeSats: number;
  vsize: number;
  changeIndex: number;
  inputCount: number;
}

/**
 * Build and sign ONE transaction paying every member of a batch.
 * Mirrors buildWithdrawalTx's discipline (largest-first selection,
 * dust-folded change at chain 1 / changeIndex, per-input signing);
 * the returned fee is the BUILT transaction's real fee
 * (inputs − outputs), which is what fee shares are allocated from.
 * Throws on an empty batch, a dust payment output, or insufficient
 * platform funds.
 */
export function buildBatchWithdrawalTx(params: {
  accountPriv: HDKey;
  accountPub: HDKey;
  utxos: Utxo[];
  payments: BatchPayment[];
  feeRateSatVb: number;
  changeIndex: number;
}): BuiltBatchWithdrawal {
  const { accountPriv, accountPub, utxos, payments } = params;
  if (payments.length === 0) throw new Error("Cannot build an empty batch");
  const recipients = payments.map((p) => {
    if (!Number.isInteger(p.amountSats) || p.amountSats < DUST_LIMIT_SATS) {
      throw new Error("Batch payment amount would be dust");
    }
    return validateMainnetAddress(p.toAddress);
  });
  const changeScript = deriveScript(accountPub, 1, params.changeIndex);
  const totalTarget = payments.reduce((s, p) => s + p.amountSats, 0);

  const selection = selectCoinsMulti(
    utxos,
    totalTarget,
    params.feeRateSatVb,
    recipients.map((r) => r.script),
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
  for (const p of payments) {
    tx.addOutputAddress(p.toAddress, BigInt(p.amountSats));
  }
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
    inputCount: selection.selected.length,
  };
}

export interface BatchFeeMember {
  /** Withdrawal id. */
  id: string;
  /** The member's solo-transaction vsize (P3 estimate at queue time). */
  soloVsize: number;
  /** The member's reserved solo fee — the hard cap on their share. */
  reservedFeeSats: number;
}

export interface BatchFeeAllocation {
  /** One entry per member, in input order. */
  shares: Array<{ id: string; shareSats: number }>;
  /**
   * Sats of the actual fee NOT covered by any member because every
   * member's proportional share hit their reserved-fee cap. The
   * platform absorbs this (the confirm screen promises the fee never
   * exceeds the shown estimate). Invariant:
   * Σ shares + absorbedSats === actualFeeSats.
   */
  absorbedSats: number;
}

/**
 * Allocate a batch's ACTUAL network fee across its members (P4 fee
 * shares): each member pays in proportion to their solo vsize —
 * `actualFee × soloVsize_i / Σ soloVsize` — floored to whole sats,
 * CAPPED at their reserved solo estimate; the flooring remainder is
 * distributed one sat at a time to the largest fractional parts
 * (ties broken by input order, fully deterministic) among members
 * still below their cap. Whatever cannot be placed under the caps
 * is platform-absorbed. Savings versus solo sends go to the
 * withdrawers; the platform never takes more than the actual fee.
 */
export function allocateBatchFeeShares(
  members: BatchFeeMember[],
  actualFeeSats: number,
): BatchFeeAllocation {
  if (!Number.isInteger(actualFeeSats) || actualFeeSats < 0) {
    throw new Error("Actual fee must be a non-negative integer");
  }
  if (members.length === 0) {
    return { shares: [], absorbedSats: actualFeeSats };
  }
  const weights = members.map((m) => Math.max(1, Math.floor(m.soloVsize)));
  const totalWeight = weights.reduce((s, w) => s + w, 0);

  const raws = members.map((_, i) => (actualFeeSats * weights[i]) / totalWeight);
  const shares = members.map((m, i) =>
    Math.min(Math.max(0, Math.floor(m.reservedFeeSats)), Math.floor(raws[i])),
  );

  let remaining = actualFeeSats - shares.reduce((s, x) => s + x, 0);
  if (remaining > 0) {
    const order = members
      .map((_, i) => i)
      .sort((a, b) => {
        const fa = raws[a] - Math.floor(raws[a]);
        const fb = raws[b] - Math.floor(raws[b]);
        if (fb !== fa) return fb - fa;
        return a - b;
      });
    // Cycle the deterministic order, +1 sat per member per pass,
    // until the remainder is placed or every member is capped.
    let progressed = true;
    while (remaining > 0 && progressed) {
      progressed = false;
      for (const i of order) {
        if (remaining <= 0) break;
        const cap = Math.max(0, Math.floor(members[i].reservedFeeSats));
        if (shares[i] < cap) {
          shares[i] += 1;
          remaining -= 1;
          progressed = true;
        }
      }
    }
  }

  return {
    shares: members.map((m, i) => ({ id: m.id, shareSats: shares[i] })),
    absorbedSats: remaining,
  };
}

export interface BatchTrigger {
  form: boolean;
  /** True when the max-wait rule (not the fee window) forces formation. */
  forcedByWait: boolean;
}

/**
 * The batcher's formation trigger (P4): form a batch when the live
 * fee rate is at/under the batch cap, OR the oldest queued
 * withdrawal has waited at least the configured maximum — then it
 * broadcasts at market. An empty queue never forms.
 */
export function shouldFormBatch(params: {
  queuedCount: number;
  feeRateSatVb: number;
  batchCapSatVb: number;
  oldestQueuedAgeHours: number;
  maxWaitHours: number;
}): BatchTrigger {
  if (params.queuedCount <= 0) return { form: false, forcedByWait: false };
  const cap = Math.max(1, params.batchCapSatVb);
  if (Math.ceil(params.feeRateSatVb) <= cap) {
    return { form: true, forcedByWait: false };
  }
  if (params.oldestQueuedAgeHours >= params.maxWaitHours) {
    return { form: true, forcedByWait: true };
  }
  return { form: false, forcedByWait: false };
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
 * misprice pico-denominated invoices; see lightning-service history.)
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

// ── BOLT11 full decode (timestamp, expiry, payment hash, description) ────
//
// decodeBolt11Msat reads only the amount from the human-readable part.
// The custodial Lightning SEND path needs the whole invoice validated
// BEFORE any balance is reserved: the payment hash (the send's
// identity — an invoice must never be paid twice), the creation
// timestamp + expiry (an expired invoice must be refused, not
// attempted), and the description for the confirm screen. Pure and
// checksum-verified (bech32), like everything else in this module:
// a malformed or tampered string decodes to null, never to a guess.

export interface Bolt11Details {
  /** Amount in millisatoshis, or null for an amount-less invoice. */
  amountMsat: bigint | null;
  /** Invoice creation time (BOLT11 timestamp field), epoch seconds. */
  timestampSeconds: number;
  /** Validity window in seconds (BOLT11 expiry field; 3600 default). */
  expirySeconds: number;
  /** timestampSeconds + expirySeconds. */
  expiresAtSeconds: number;
  /** 64-hex payment hash (field type 1), or null when absent. */
  paymentHash: string | null;
  /** Plain description (field type 13), or null when absent/hashed. */
  description: string | null;
}

const BOLT11_DEFAULT_EXPIRY_SECONDS = 3600;
// Tagged-field type numbers (BOLT11 spec).
const BOLT11_FIELD_PAYMENT_HASH = 1;
const BOLT11_FIELD_EXPIRY = 6;
const BOLT11_FIELD_DESCRIPTION = 13;

/** Regroup 5-bit words into bytes (BOLT11 data encoding), dropping pad bits. */
function bolt11WordsToBytes(words: number[]): number[] {
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

function bolt11WordsToInt(words: number[]): number {
  let v = 0;
  for (const w of words) v = v * 32 + w;
  return v;
}

function bytesToHex(bytes: number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Decode and checksum-verify a BOLT11 invoice. Returns null for
 * anything that is not a well-formed invoice (bad charset, bad
 * checksum, truncated fields). The signature is not verified —
 * BOLT11 payers never verify it; the bech32 checksum is the
 * integrity check, exactly as in every wallet.
 */
export function decodeBolt11(bolt11: string): Bolt11Details | null {
  if (typeof bolt11 !== "string") return null;
  const cleaned = bolt11.trim().toLowerCase();
  if (!cleaned.startsWith("ln")) return null;

  let decoded: { prefix: string; words: number[] };
  try {
    decoded = bech32.decode(cleaned, 16384) as { prefix: string; words: number[] };
  } catch {
    return null;
  }
  const words = decoded.words;
  // 7 words of timestamp + at least the 104-word signature.
  if (!Array.isArray(words) || words.length < 7 + 104) return null;

  const timestampSeconds = bolt11WordsToInt(words.slice(0, 7));

  let expirySeconds = BOLT11_DEFAULT_EXPIRY_SECONDS;
  let paymentHash: string | null = null;
  let description: string | null = null;

  // Tagged fields run from word 7 to 104 words before the end
  // (the trailing signature). A field whose declared length
  // overruns the field area makes the invoice malformed.
  const fieldsEnd = words.length - 104;
  let pos = 7;
  while (pos + 3 <= fieldsEnd) {
    const type = words[pos];
    const len = words[pos + 1] * 32 + words[pos + 2];
    if (pos + 3 + len > fieldsEnd) return null;
    const data = words.slice(pos + 3, pos + 3 + len);
    if (type === BOLT11_FIELD_PAYMENT_HASH && paymentHash === null) {
      const bytes = bolt11WordsToBytes(data);
      if (bytes.length >= 32) paymentHash = bytesToHex(bytes.slice(0, 32));
    } else if (type === BOLT11_FIELD_EXPIRY) {
      const v = bolt11WordsToInt(data);
      if (Number.isFinite(v) && v > 0) expirySeconds = v;
    } else if (type === BOLT11_FIELD_DESCRIPTION && description === null) {
      try {
        description = new TextDecoder("utf-8", { fatal: true }).decode(
          new Uint8Array(bolt11WordsToBytes(data)),
        );
      } catch {
        description = null;
      }
    }
    pos += 3 + len;
  }

  return {
    amountMsat: decodeBolt11Msat(cleaned),
    timestampSeconds,
    expirySeconds,
    expiresAtSeconds: timestampSeconds + expirySeconds,
    paymentHash,
    description,
  };
}

/** True when the invoice's validity window has passed at `nowSeconds`. */
export function isBolt11Expired(details: Bolt11Details, nowSeconds: number): boolean {
  return nowSeconds >= details.expiresAtSeconds;
}

// ── Broadcast outcome classification (withdrawal refund safety) ──────────

/**
 * What a withdrawal broadcast attempt PROVED about the transaction.
 *
 * The stakes are asymmetric: refunding a withdrawal whose transaction
 * actually reached the network pays the user twice (refund + BTC).
 * And no observation available to the broadcaster can prove a
 * negative: an HTTP 400 rejection — even one naming a structural
 * error class — is one endpoint's answer about its own mempool view
 * at one moment; it cannot establish that the signed transaction can
 * never be accepted anywhere. So there is deliberately NO
 * "definite failure" outcome here (removed 2026-10-22 after two
 * review rounds): a broadcast that is not positively confirmed is
 * "unknown", the withdrawal stays 'reserved', and the refund decision
 * is a human reconciliation step (runbook §8), never an automatic
 * consequence of a network response. Automatic refunds remain only
 * where non-broadcast is proven by construction — failures BEFORE
 * broadcast (build/sign/reserve errors), which never reach this
 * classifier.
 */
export type BroadcastOutcome = "confirmed" | "unknown";

export interface BroadcastObservation {
  /** HTTP status of POST /tx; null when the request itself failed (timeout / network error). */
  postStatus: number | null;
  /** Body of a non-2xx POST response ("" when none / not applicable). */
  postBody: string;
  /** Txid returned by a 2xx POST, trimmed; null otherwise. */
  postTxid: string | null;
  /** Whether a GET /tx/{expectedTxid} lookup found the transaction. */
  lookupFound: boolean;
}

export interface BroadcastClassification {
  outcome: BroadcastOutcome;
  /** Stable short tag for logs and the withdrawal row's error field. */
  reason: string;
}

/**
 * Classify a broadcast attempt from everything the caller observed.
 * Pure: the network calls live in the edge function; the DECISION —
 * above all, that nothing here may authorise a refund — lives here,
 * so the whole outcome matrix is unit-testable (tests/bitcoin/).
 *
 * Only two outcomes exist. "confirmed" requires positive evidence:
 * the network holds our exact txid, or the POST's 2xx answer named
 * it. EVERYTHING else — every rejection class (structural,
 * witness, missing/spent inputs, policy, fee), timeouts, 5xx,
 * unexpected-txid responses — is "unknown".
 */
export function classifyBroadcastOutcome(
  obs: BroadcastObservation,
  expectedTxid: string,
): BroadcastClassification {
  // The network holding our exact transaction settles everything,
  // whatever the POST appeared to say (a "rejected" POST in a timeout
  // race, or a 2xx that named a different txid, can both accompany a
  // transaction that is in fact already propagating).
  if (obs.lookupFound) {
    return { outcome: "confirmed", reason: "lookup_found" };
  }
  if (obs.postStatus !== null && obs.postStatus >= 200 && obs.postStatus < 300) {
    if (obs.postTxid !== null && obs.postTxid === expectedTxid) {
      return { outcome: "confirmed", reason: "post_txid_match" };
    }
    // A 2xx naming a DIFFERENT transaction (or none) proves nothing
    // about ours — with the lookup missing it may still propagate.
    return { outcome: "unknown", reason: "unexpected_txid" };
  }
  if (obs.postStatus === null) {
    return { outcome: "unknown", reason: "post_no_response" };
  }
  return { outcome: "unknown", reason: `post_http_${obs.postStatus}` };
}

// ── Deposit crediting policy (audit M2 / P2-16) ────────────────────────
//
// Deposits used to credit at ONE confirmation from a SINGLE explorer:
// a one-block reorg, or a compromised/misconfigured esplora endpoint,
// could credit BTC that never settles — immediately tradable against
// pooled funds. The policy now tiers by amount, and the largest
// deposits must additionally agree on a second, independent explorer
// before they may credit. Pure, like the rest of this module: the
// edge function gathers the observations; the DECISIONS live here so
// the whole matrix is unit-testable (tests/bitcoin/).

/**
 * Confirmations a deposit of `amountSats` must reach before it may
 * credit, given the configured tier thresholds: below the medium
 * threshold → 2; at or above it → 3. (The large threshold keeps the
 * same 3 but adds the cross-check — see depositNeedsCrossCheck.)
 */
export function requiredConfirmationsFor(
  amountSats: number,
  mediumSats: number,
  largeSats: number,
): number {
  void largeSats; // tier boundary documented above; count is 3 either way
  return amountSats >= mediumSats ? 3 : 2;
}

/** Deposits at or above the large threshold need the cross-check. */
export function depositNeedsCrossCheck(amountSats: number, largeSats: number): boolean {
  return amountSats >= largeSats;
}

/**
 * One explorer's view of the deposit output being credited: whether
 * its transaction is confirmed there, the block it confirmed in, and
 * the value + address of the output at the deposit's vout index.
 */
export interface DepositTxView {
  confirmed: boolean;
  blockHeight: number | null;
  voutValue: number | null;
  voutAddress: string | null;
}

export type DepositCrossCheck =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Verdict for the second-explorer cross-check of a large deposit.
 * FAIL-CLOSED: anything short of positive agreement — the secondary
 * explorer unreachable or not-ok (null view), the transaction
 * unconfirmed there, a different value or address at the vout, or
 * block heights disagreeing by more than 2 (indexing lag is
 * seconds-scale; a wider gap means the two explorers are looking at
 * different chains) — holds the deposit for the next scan instead of
 * crediting it.
 */
export function crossCheckDeposit(
  primary: DepositTxView,
  secondary: DepositTxView | null,
  expectedAddress: string,
  expectedValueSats: number,
): DepositCrossCheck {
  if (secondary === null) {
    return { ok: false, reason: "secondary explorer lookup failed" };
  }
  if (!secondary.confirmed) {
    return { ok: false, reason: "not confirmed on secondary explorer" };
  }
  if (secondary.voutValue !== expectedValueSats) {
    return { ok: false, reason: "value mismatch on secondary explorer" };
  }
  if (secondary.voutAddress !== expectedAddress) {
    return { ok: false, reason: "address mismatch on secondary explorer" };
  }
  if (
    primary.blockHeight !== null && secondary.blockHeight !== null &&
    Math.abs(secondary.blockHeight - primary.blockHeight) > 2
  ) {
    return { ok: false, reason: "block height disagreement between explorers" };
  }
  return { ok: true };
}
