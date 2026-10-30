// Real Bitcoin integration helpers (no BTCPay).
//
// Address generation: BIP32 watch-only derivation from an extended public key
// (BTC_XPUB — xpub/ypub/zpub/tpub/vpub all accepted). The private keys never
// touch this server, so deposits are non-custodial on the key side while the
// ledger stays custodial.
//
// Chain data + broadcast: any Esplora-compatible Bitcoin node API
// (mempool.space, Blockstream, or a self-hosted esplora / electrs instance).
import { HDKey } from "npm:@scure/bip32@1.4.0";
import { base58check } from "npm:@scure/base@1.1.6";
import { sha256 } from "npm:@noble/hashes@1.4.0/sha256";
import * as btc from "npm:@scure/btc-signer@1.3.2";

export const ESPLORA_URL = (
  Deno.env.get("BITCOIN_ESPLORA_URL") || "https://mempool.space/api"
).replace(/\/$/, "");

export const BTC_NETWORK = (Deno.env.get("BITCOIN_NETWORK") || "mainnet").toLowerCase();
export const IS_TESTNET = BTC_NETWORK !== "mainnet";
export const NETWORK = IS_TESTNET ? btc.TEST_NETWORK : btc.NETWORK;

export const MIN_CONFIRMATIONS = Math.max(
  1,
  Number(Deno.env.get("BITCOIN_MIN_CONFIRMATIONS") || 1),
);

// Tolerate pasted values with spaces, line breaks, quotes, or a "zpub:" label.
const clean = (v: string) =>
  v.replace(/["'\s]/g, "").replace(/^.*?((?:x|y|z|t|u|v)pub)/, "$1");

let XPUB = "";
let loadedAt = 0;

/** Load the key saved in the admin form (btc_settings), falling back to the BTC_XPUB secret. */
export async function loadXpub(): Promise<void> {
  if (XPUB && Date.now() - loadedAt < 60_000) return;
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (url && key) {
      const r = await fetch(`${url}/rest/v1/btc_settings?select=xpub&limit=1`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
      });
      if (r.ok) {
        const rows = await r.json();
        if (rows?.[0]?.xpub) { XPUB = clean(rows[0].xpub); loadedAt = Date.now(); return; }
      }
    }
  } catch (e) { console.error("btc_settings load failed", e); }
  XPUB = clean(Deno.env.get("BTC_XPUB") || "");
  loadedAt = Date.now();
}

export const hasXpub = () => XPUB.length > 0;

/** Validate an arbitrary key and derive preview addresses (used by the admin form). */
export function previewKey(raw: string, count = 3): { error?: string; addresses?: string[] } {
  const prev = XPUB;
  XPUB = clean(raw);
  try {
    const problem = xpubProblem();
    if (problem) return { error: problem };
    return { addresses: Array.from({ length: count }, (_, i) => deriveAddress(i).address) };
  } finally { XPUB = prev; }
}

/** Returns null if the configured key is usable, otherwise a plain reason. */
export function xpubProblem(): string | null {
  if (!hasXpub()) return "No extended public key (BTC_XPUB) is set.";
  if (/^(x|y|z|t|u|v)prv/.test(XPUB)) return "BTC_XPUB contains a PRIVATE key. Replace it with the public key (xpub/zpub) immediately.";
  if (!/^(x|y|z|t|u|v)pub[1-9A-HJ-NP-Za-km-z]{100,112}$/.test(XPUB))
    return `BTC_XPUB is not a valid extended public key. It must start with xpub, ypub or zpub and be about 111 characters, with no 0, O, I or l. (Received a value of ${XPUB.length} characters starting with "${XPUB.slice(0, 3)}".)`;
  try { normaliseExtendedKey(XPUB); } catch { return "BTC_XPUB failed its checksum — it was probably copied incompletely."; }
  return null;
}

const b58 = base58check(sha256);

// Normalise ypub/zpub/vpub/upub to the plain xpub/tpub version bytes that
// @scure/bip32 understands (the payload itself is identical).
function normaliseExtendedKey(key: string): string {
  const raw = b58.decode(key);
  const version = (raw[0] << 24) | (raw[1] << 16) | (raw[2] << 8) | raw[3];
  const mainnet = 0x0488b21e; // xpub
  const testnet = 0x043587cf; // tpub
  const known: Record<number, number> = {
    0x0488b21e: mainnet, // xpub
    0x049d7cb2: mainnet, // ypub
    0x04b24746: mainnet, // zpub
    0x043587cf: testnet, // tpub
    0x044a5262: testnet, // upub
    0x045f1cf6: testnet, // vpub
  };
  const target = known[version];
  if (!target) throw new Error("Unsupported extended public key prefix");
  const out = new Uint8Array(raw);
  out[0] = (target >>> 24) & 0xff;
  out[1] = (target >>> 16) & 0xff;
  out[2] = (target >>> 8) & 0xff;
  out[3] = target & 0xff;
  return b58.encode(out);
}

/** Derive the native-segwit (bech32) receive address at m/<change>/<index>. */
export function deriveAddress(index: number, change = 0): { address: string; path: string } {
  if (!hasXpub()) throw new Error("BTC_XPUB is not configured");
  const hd = HDKey.fromExtendedKey(normaliseExtendedKey(XPUB));
  const child = hd.deriveChild(change).deriveChild(index);
  if (!child.publicKey) throw new Error("Failed to derive public key");
  const p = btc.p2wpkh(child.publicKey, NETWORK);
  if (!p.address) throw new Error("Failed to derive address");
  return { address: p.address, path: `m/${change}/${index}` };
}

export function isValidBtcAddress(addr: string): boolean {
  if (!addr || typeof addr !== "string") return false;
  if (addr.length < 14 || addr.length > 90) return false;
  const bech32 = /^(bc1|tb1|bcrt1)[0-9ac-hj-np-z]{6,87}$/i;
  const legacy = /^[13mn2][a-km-zA-HJ-NP-Z1-9]{25,39}$/;
  return bech32.test(addr) || legacy.test(addr);
}

async function esplora(path: string, init?: RequestInit) {
  const r = await fetch(`${ESPLORA_URL}${path}`, init);
  const text = await r.text();
  if (!r.ok) throw new Error(`Esplora ${path} failed: ${r.status} ${text.slice(0, 200)}`);
  try {
    return JSON.parse(text);
  } catch {
    return text.trim();
  }
}

export type EsploraTx = {
  txid: string;
  status: { confirmed: boolean; block_height?: number };
  vout: Array<{ scriptpubkey_address?: string; value: number }>;
};

export const getTipHeight = async (): Promise<number> =>
  Number(await esplora("/blocks/tip/height"));

export const getAddressTxs = (address: string): Promise<EsploraTx[]> =>
  esplora(`/address/${address}/txs`);

export const getTx = (txid: string): Promise<EsploraTx> => esplora(`/tx/${txid}`);

export const broadcastTx = (rawHex: string): Promise<string> =>
  esplora("/tx", {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: rawHex,
  }) as Promise<string>;

/** sat/vB estimate for the requested confirmation target. */
export async function getFeeRate(target = 3): Promise<number> {
  try {
    const est = await esplora("/fee-estimates");
    const keys = Object.keys(est || {}).map(Number).sort((a, b) => a - b);
    const key = keys.find((k) => k >= target) ?? keys[keys.length - 1];
    return Math.max(1, Math.ceil(Number(est[String(key)] || 5)));
  } catch {
    return 5;
  }
}

export const confirmationsFor = (tipHeight: number, blockHeight?: number) =>
  blockHeight && blockHeight > 0 ? Math.max(0, tipHeight - blockHeight + 1) : 0;

export const explorerTxUrl = (txid: string) =>
  IS_TESTNET
    ? `https://mempool.space/testnet/tx/${txid}`
    : `https://mempool.space/tx/${txid}`;
