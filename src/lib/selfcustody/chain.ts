/**
 * Chain access for the SELF-CUSTODY wallet via public Esplora APIs
 * (mempool.space primary, blockstream.info fallback — both speak the
 * same Esplora REST dialect). Everything sent here is public chain data
 * by design: addresses, txids, and ALREADY-SIGNED transaction hex for
 * broadcast. No key material, mnemonic, or xpub is ever transmitted
 * (addresses are derived locally and queried individually).
 */
import type { HDKey } from "@scure/bip32";
import { deriveAddress, deriveScript, type ClientUtxo } from "./wallet";

/**
 * Esplora endpoints, in the order they are tried. The scan only reports
 * the network unreachable when EVERY endpoint has failed — a single
 * provider outage (or one provider being blocked on the user's network)
 * must not strand the wallet when another public Esplora API can answer.
 */
export const ESPLORA_BASES = ["https://mempool.space/api", "https://blockstream.info/api"] as const;

/** The full URL of `path` on every configured Esplora endpoint, in try-order. Pure — unit-tested. */
export function esploraUrls(path: string): string[] {
  return ESPLORA_BASES.map((base) => `${base}${path}`);
}
/** BIP44 gap limit: stop scanning a chain after this many unused addresses in a row. */
export const GAP_LIMIT = 20;

interface AddressStats {
  chain_stats: { tx_count: number };
  mempool_stats: { tx_count: number };
}

export interface WalletAddress {
  chain: 0 | 1;
  index: number;
  address: string;
  txCount: number;
}

export interface WalletHistoryEntry {
  txid: string;
  confirmed: boolean;
  blockTime: number | null;
  /** Net change to this wallet in sats (positive = received). */
  netSats: number;
  feeSats: number;
}

export interface WalletScan {
  addresses: WalletAddress[];
  utxos: ClientUtxo[];
  balanceSats: number;
  /** First unused external (receive) index. */
  nextReceiveIndex: number;
  /** First unused change index. */
  nextChangeIndex: number;
  history: WalletHistoryEntry[];
}

async function esplora(path: string, init?: RequestInit): Promise<any> {
  // Hard timeout: a hung request must never stall the scan forever
  // (the custodial server twin uses 20s). Callers may pass their own
  // signal in init, which then wins.
  let lastError: unknown = null;
  for (const url of esploraUrls(path)) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000), ...init });
      if (!res.ok) throw new Error(`Chain data request failed (${res.status})`);
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    } catch (e) {
      // One endpoint failed (unreachable, blocked, or erroring): fall
      // through to the next. Only when every endpoint has failed does
      // the last error surface to the caller.
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Chain data request failed");
}

function txCountOf(stats: AddressStats): number {
  return (stats.chain_stats?.tx_count ?? 0) + (stats.mempool_stats?.tx_count ?? 0);
}

/** Net sats change of a full esplora tx against a set of own addresses (uses vin.prevout values). */
export function netChangeSats(tx: any, ownAddresses: Set<string>): number {
  let net = 0;
  for (const vout of tx.vout ?? []) {
    if (vout.scriptpubkey_address && ownAddresses.has(vout.scriptpubkey_address)) net += Number(vout.value);
  }
  for (const vin of tx.vin ?? []) {
    const prev = vin.prevout;
    if (prev?.scriptpubkey_address && ownAddresses.has(prev.scriptpubkey_address)) net -= Number(prev.value);
  }
  return net;
}

/**
 * Full wallet scan: walk both chains until GAP_LIMIT unused addresses in a
 * row, collecting confirmed UTXOs and the raw transactions touching the
 * wallet; history nets are computed at the end against the complete
 * address set (a tx touching two wallet addresses is only counted once).
 */
export async function scanWallet(account: HDKey): Promise<WalletScan> {
  const addresses: WalletAddress[] = [];
  const utxos: ClientUtxo[] = [];
  const rawTxs = new Map<string, any>();
  let nextReceiveIndex = 0;
  let nextChangeIndex = 0;

  for (const chain of [0, 1] as const) {
    let unusedRun = 0;
    let index = 0;
    let firstUnused = -1;
    while (unusedRun < GAP_LIMIT) {
      const batch: number[] = [];
      for (let i = 0; i < 5; i++) batch.push(index++);
      const infos = await Promise.all(
        batch.map(async (i) => {
          const address = deriveAddress(account, chain, i);
          const stats = (await esplora(`/address/${address}`)) as AddressStats;
          return { i, address, stats };
        }),
      );
      for (const { i, address, stats } of infos) {
        const txCount = txCountOf(stats);
        addresses.push({ chain, index: i, address, txCount });
        if (txCount === 0) {
          unusedRun++;
          if (firstUnused === -1) firstUnused = i;
          continue;
        }
        unusedRun = 0;
        const [rawUtxos, txs] = await Promise.all([
          esplora(`/address/${address}/utxo`) as Promise<any[]>,
          esplora(`/address/${address}/txs`).catch(() => [] as any[]),
        ]);
        for (const u of rawUtxos) {
          if (u.status?.confirmed) {
            utxos.push({
              txid: u.txid,
              vout: u.vout,
              valueSats: BigInt(u.value),
              chain,
              index: i,
              script: deriveScript(account, chain, i),
            });
          }
        }
        for (const tx of txs) if (tx?.txid) rawTxs.set(tx.txid, tx);
      }
    }
    if (chain === 0) nextReceiveIndex = firstUnused === -1 ? 0 : firstUnused;
    else nextChangeIndex = firstUnused === -1 ? 0 : firstUnused;
  }

  const ownAddresses = new Set(addresses.map((a) => a.address));
  const history: WalletHistoryEntry[] = [...rawTxs.values()]
    .map((tx) => ({
      txid: tx.txid as string,
      confirmed: Boolean(tx.status?.confirmed),
      blockTime: (tx.status?.block_time ?? null) as number | null,
      netSats: netChangeSats(tx, ownAddresses),
      feeSats: Number(tx.fee ?? 0),
    }))
    .sort((a, b) => (b.blockTime ?? 0) - (a.blockTime ?? 0));

  const balanceSats = utxos.reduce((sum, u) => sum + Number(u.valueSats), 0);
  return { addresses, utxos, balanceSats, nextReceiveIndex, nextChangeIndex, history };
}

export async function fetchRecommendedFeeRate(): Promise<number> {
  const fees = await esplora("/v1/fees/recommended");
  const rate = Number(fees?.halfHourFee);
  if (!Number.isFinite(rate) || rate < 1) throw new Error("Could not fetch current network fees");
  return rate;
}

export async function broadcastTransaction(txHex: string): Promise<string> {
  // Same fallback discipline as reads: a broadcast that one endpoint
  // refuses to relay (or never hears) is offered to the next. The
  // signed transaction is identical, so a duplicate relay is harmless —
  // the network rejects an already-known txid, it can never double-spend.
  let lastError: unknown = null;
  for (const url of esploraUrls("/tx")) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: txHex,
        signal: AbortSignal.timeout(20_000),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`Broadcast failed: ${text.slice(0, 200)}`);
      return text.trim();
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Broadcast failed");
}
