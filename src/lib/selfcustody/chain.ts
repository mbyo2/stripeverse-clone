/**
 * Chain access for the SELF-CUSTODY wallet via the public mempool.space
 * esplora API. Everything sent here is public chain data by design:
 * addresses, txids, and ALREADY-SIGNED transaction hex for broadcast.
 * No key material, mnemonic, or xpub is ever transmitted (addresses are
 * derived locally and queried individually).
 */
import type { HDKey } from "@scure/bip32";
import { deriveAddress, deriveScript, type ClientUtxo } from "./wallet";

const ESPLORA_BASE = "https://mempool.space/api";
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
  const res = await fetch(`${ESPLORA_BASE}${path}`, { signal: AbortSignal.timeout(15_000), ...init });
  if (!res.ok) throw new Error(`Chain data request failed (${res.status})`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
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
  const res = await fetch(`${ESPLORA_BASE}/tx`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: txHex,
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Broadcast failed: ${text.slice(0, 200)}`);
  return text.trim();
}
