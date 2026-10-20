/**
 * Client-side BIP84 wallet core for the SELF-CUSTODY wallet.
 *
 * Runs entirely in the browser. The mnemonic enters here from the vault
 * (session.ts) and never leaves the device: this module performs no network
 * calls at all (chain access lives in chain.ts and only ever sees public
 * addresses / already-signed transaction hex).
 *
 * Uses the audited @scure libraries — the same versions and algorithms as
 * the custodial server implementation, pinned to the same published BIP84
 * test vectors by unit tests so both implementations are proven identical.
 */
import { HDKey } from "@scure/bip32";
import { generateMnemonic, validateMnemonic, mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import * as btc from "@scure/btc-signer";
import { hex } from "@scure/base";

export const NETWORK = btc.NETWORK; // mainnet
export const ACCOUNT_PATH = "m/84'/0'/0'"; // BIP84 native segwit

/** Generate a fresh 24-word mnemonic using the platform CSPRNG (@scure/bip39 uses crypto.getRandomValues). */
export function generateWalletMnemonic(): string {
  return generateMnemonic(wordlist, 256);
}

export function isValidMnemonic(phrase: string): boolean {
  try {
    return validateMnemonic(phrase.trim().toLowerCase(), wordlist);
  } catch {
    return false;
  }
}

/** BIP84 (zpub) version bytes so the account serializes as a zpub, matching the custodial side. */
export const BIP84_VERSIONS = { private: 0x04b2430c, public: 0x04b24746 };

/** Account-level extended key (m/84'/0'/0') from a mnemonic. */
export function accountFromMnemonic(mnemonic: string): HDKey {
  const seed = mnemonicToSeedSync(mnemonic.trim().toLowerCase());
  return HDKey.fromMasterSeed(seed, BIP84_VERSIONS).derive(ACCOUNT_PATH);
}

/** The account's extended public key (zpub encoding) — watch-only, safe to display/export. */
export function accountXpub(account: HDKey): string {
  return account.publicExtendedKey;
}

export function deriveAddress(account: HDKey, chain: 0 | 1, index: number): string {
  const child = account.deriveChild(chain).deriveChild(index);
  if (!child.publicKey) throw new Error("Missing public key in derivation");
  return btc.p2wpkh(child.publicKey, NETWORK).address!;
}

export function deriveScript(account: HDKey, chain: 0 | 1, index: number): Uint8Array {
  const child = account.deriveChild(chain).deriveChild(index);
  if (!child.publicKey) throw new Error("Missing public key in derivation");
  return btc.p2wpkh(child.publicKey, NETWORK).script;
}

/** Validate a mainnet recipient address (bech32/bech32m/base58 checksum) via the decoder. */
export function assertValidAddress(address: string): void {
  try {
    btc.Address(NETWORK).decode(address.trim());
  } catch {
    throw new Error("Invalid Bitcoin address");
  }
}

export interface ClientUtxo {
  txid: string;
  vout: number;
  /** Confirmed value in sats (BigInt — money never touches floats). */
  valueSats: bigint;
  chain: 0 | 1;
  index: number;
  script: Uint8Array;
}

/** Same virtual-size model as the custodial implementation (P2WPKH: 68/input, 31/output, 10.5 overhead). */
export function estimateTxVsize(inputCount: number, outputCount: number): number {
  return Math.ceil(10.5 + inputCount * 68 + outputCount * 31);
}

export interface CoinSelection {
  inputs: ClientUtxo[];
  feeSats: bigint;
  changeSats: bigint;
}

/**
 * Largest-first coin selection. changeSats = 0 means "no change output"
 * (exact spend or dust folded into the fee). Identical algorithm to the
 * custodial server path; both are pinned by the same unit tests.
 */
export function selectCoins(
  utxos: ClientUtxo[],
  targetSats: bigint,
  feeRateSatVb: number,
): CoinSelection {
  if (targetSats <= 0n) throw new Error("Amount must be positive");
  const sorted = [...utxos].sort((a, b) => (b.valueSats > a.valueSats ? 1 : b.valueSats < a.valueSats ? -1 : 0));
  const selected: ClientUtxo[] = [];
  let total = 0n;
  for (const utxo of sorted) {
    selected.push(utxo);
    total += utxo.valueSats;
    const feeWithChange = BigInt(Math.ceil(estimateTxVsize(selected.length, 2) * feeRateSatVb));
    if (total >= targetSats + feeWithChange) {
      const change = total - targetSats - feeWithChange;
      if (change >= 546n) return { inputs: selected, feeSats: feeWithChange, changeSats: change };
      return { inputs: selected, feeSats: total - targetSats, changeSats: 0n };
    }
    const feeNoChange = BigInt(Math.ceil(estimateTxVsize(selected.length, 1) * feeRateSatVb));
    if (total >= targetSats + feeNoChange) {
      return { inputs: selected, feeSats: total - targetSats, changeSats: 0n };
    }
  }
  throw new Error("Insufficient confirmed balance for this payment plus network fee");
}

export interface BuiltTransaction {
  hex: string;
  txid: string;
  feeSats: bigint;
  changeSats: bigint;
  /** Change address index used (chain 1), or -1 when there is no change output. */
  changeIndex: number;
}

/**
 * Build and sign a payment entirely client-side. The account HDKey used for
 * signing is derived fresh from the session mnemonic by the caller and
 * dropped after use; private keys never persist beyond this call.
 */
export function buildSignedTransaction(params: {
  account: HDKey;
  utxos: ClientUtxo[];
  toAddress: string;
  amountSats: bigint;
  feeRateSatVb: number;
  changeIndex: number;
}): BuiltTransaction {
  const { account, utxos, toAddress, amountSats, feeRateSatVb, changeIndex } = params;
  assertValidAddress(toAddress);
  const selection = selectCoins(utxos, amountSats, feeRateSatVb);

  const tx = new btc.Transaction();
  for (const input of selection.inputs) {
    tx.addInput({
      txid: input.txid,
      index: input.vout,
      witnessUtxo: { script: input.script, amount: input.valueSats },
    });
  }
  tx.addOutputAddress(toAddress, amountSats, NETWORK);
  if (selection.changeSats > 0n) {
    tx.addOutputAddress(deriveAddress(account, 1, changeIndex), selection.changeSats, NETWORK);
  }
  for (let i = 0; i < selection.inputs.length; i++) {
    const input = selection.inputs[i];
    const child = account.deriveChild(input.chain).deriveChild(input.index);
    if (!child.privateKey) throw new Error("Missing private key for signing");
    tx.signIdx(child.privateKey, i);
  }
  tx.finalize();
  return {
    hex: hex.encode(tx.extract()),
    txid: tx.id,
    feeSats: selection.feeSats,
    changeSats: selection.changeSats,
    changeIndex: selection.changeSats > 0n ? changeIndex : -1,
  };
}
