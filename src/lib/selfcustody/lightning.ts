/**
 * Self-custody Lightning via the Breez SDK – Liquid (WASM, fully in-browser).
 *
 * The SDK runs the user's own Liquid wallet in the page: payments settle
 * against the Liquid sidechain under the user's seed (the same mnemonic as
 * the on-chain wallet), with submarine swaps to/from Lightning. No server of
 * ours is involved and no key material leaves the device — the mnemonic is
 * passed from the in-memory session straight into the SDK.
 *
 * ENABLEMENT — READ BEFORE WIRING A KEY:
 * The Breez SDK requires a Breez API key in its config. It must be a
 * DEDICATED, client-scoped key supplied at build time as
 * `VITE_BREEZ_LIQUID_API_KEY`. Never reuse the custodial platform's
 * server-side `BREEZ_API_KEY` here: that credential also authorizes the
 * platform's own Lightning API (invoices and payments against platform
 * funds), and anything placed in a web bundle is public by definition.
 * Until a separate client key is provisioned, `liquidLightningEnabled()`
 * returns false and every operation throws LiquidNotEnabledError — the UI
 * explains this plainly. Nothing in this module simulates a payment.
 */
import type { BindingLiquidSdk } from "@breeztech/breez-sdk-liquid/web";

export class LiquidNotEnabledError extends Error {
  constructor() {
    super(
      "Self-custody Lightning is not enabled on this deployment: it requires a dedicated client-scoped Breez API key (VITE_BREEZ_LIQUID_API_KEY), separate from the platform's server-side Lightning key.",
    );
    this.name = "LiquidNotEnabledError";
  }
}

function clientApiKey(): string | undefined {
  const key = import.meta.env.VITE_BREEZ_LIQUID_API_KEY as string | undefined;
  return key && key.trim() ? key.trim() : undefined;
}

export function liquidLightningEnabled(): boolean {
  return clientApiKey() !== undefined;
}

let sdkPromise: Promise<BindingLiquidSdk> | null = null;
let connectedKeyFingerprint: string | null = null;

async function fingerprint(mnemonic: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(mnemonic));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Connect (or reuse) the Liquid SDK instance for the session mnemonic.
 * If a different wallet is unlocked in the same page session, the previous
 * SDK instance is disconnected first — instances are never shared across
 * seeds.
 */
export async function connectLiquid(mnemonic: string): Promise<BindingLiquidSdk> {
  const key = clientApiKey();
  if (!key) throw new LiquidNotEnabledError();
  const fp = await fingerprint(mnemonic);
  if (sdkPromise && connectedKeyFingerprint === fp) return sdkPromise;
  if (sdkPromise) await disconnectLiquid();

  connectedKeyFingerprint = fp;
  sdkPromise = (async () => {
    const mod = await import("@breeztech/breez-sdk-liquid/web");
    await mod.default();
    const config = mod.defaultConfig("mainnet", key);
    config.workingDir = "bmaglass-breez-liquid";
    return mod.connect({ config, mnemonic });
  })();
  return sdkPromise;
}

export async function disconnectLiquid(): Promise<void> {
  if (!sdkPromise) return;
  const pending = sdkPromise;
  sdkPromise = null;
  connectedKeyFingerprint = null;
  try {
    const sdk = await pending;
    await sdk.disconnect();
  } catch {
    // Disconnect is best-effort; the instance is dropped regardless.
  }
}

/** Liquid wallet balance in sats (the SDK's own wallet — settles via swaps to Lightning). */
export async function liquidBalanceSat(mnemonic: string): Promise<number> {
  const sdk = await connectLiquid(mnemonic);
  const info = await sdk.getInfo();
  return info.walletInfo.balanceSat;
}

/** Create a BOLT11 invoice payable to the user's self-custody Liquid wallet. Returns the invoice string. */
export async function liquidCreateInvoice(
  mnemonic: string,
  amountSat: number,
  description?: string,
): Promise<{ invoice: string; feesSat: number }> {
  if (!Number.isSafeInteger(amountSat) || amountSat <= 0) {
    throw new Error("Amount must be a positive whole number of sats");
  }
  const sdk = await connectLiquid(mnemonic);
  const prepared = await sdk.prepareReceivePayment({
    paymentMethod: "bolt11Invoice",
    amount: { type: "bitcoin", payerAmountSat: amountSat },
  });
  const received = await sdk.receivePayment({ prepareResponse: prepared, description });
  return { invoice: received.destination, feesSat: prepared.feesSat };
}

/** Pay a BOLT11 invoice from the user's self-custody Liquid wallet. */
export async function liquidPayInvoice(
  mnemonic: string,
  bolt11: string,
): Promise<{ paymentId: string | undefined; feesSat: number | undefined }> {
  const destination = bolt11.trim();
  if (!destination.toLowerCase().startsWith("lnbc")) {
    throw new Error("That does not look like a BOLT11 Lightning invoice");
  }
  const sdk = await connectLiquid(mnemonic);
  const prepared = await sdk.prepareSendPayment({ destination });
  const sent = await sdk.sendPayment({ prepareResponse: prepared });
  return { paymentId: sent.payment.txId, feesSat: sent.payment.feesSat };
}
