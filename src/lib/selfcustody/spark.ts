/**
 * Self-custody Lightning + Spark wallet via the Breez SDK – Spark
 * (WASM, fully in-browser). This replaces the deprecated Breez SDK –
 * Liquid integration (Breez has taken the Liquid docs offline and steers
 * all partners to Spark; Glow, Breez's reference wallet app, is a Spark
 * app — this module mirrors Glow's documented wiring).
 *
 * The SDK runs the user's own Spark wallet in the page, under the SAME
 * mnemonic as the on-chain self-custody wallet (passed from the in-memory
 * session straight into the SDK). One wallet, one balance: Lightning
 * invoices, on-chain Bitcoin deposits and Spark transfers all settle into
 * `getInfo().balanceSats`. No BMaGlass server is involved and no key
 * material leaves the device.
 *
 * Documented web init pattern (Breez SDK – Spark, package README +
 * sdk-doc-spark.breez.technology):
 *   import init, { defaultConfig, connect } from "@breeztech/breez-sdk-spark/web"
 *   await init()
 *   const config = defaultConfig("mainnet"); config.apiKey = key
 *   const sdk = await connect({ config, seed: { type: "mnemonic", mnemonic }, storageDir })
 * The web build persists SDK state in IndexedDB under `storageDir`.
 *
 * ENABLEMENT:
 * The Breez API key is a per-APP developer credential (free from
 * breez.technology/request-api-key). It gates SDK access for the app; it
 * cannot move funds — the mnemonic does that. Breez's own Spark examples
 * read it from `import.meta.env.VITE_BREEZ_API_KEY`, i.e. it ships inside
 * the client bundle BY DESIGN. Until the key is provisioned in the app
 * environment, `sparkEnabled()` returns false and every operation throws
 * SparkNotEnabledError — the UI explains this plainly. Nothing in this
 * module simulates a payment.
 */
import type {
  BreezSdk,
  DepositInfo,
  InputType,
  LnurlAuthRequestDetails,
  LnurlPayRequestDetails,
  LnurlWithdrawRequestDetails,
  MaxFee,
  Payment,
  PrepareLnurlPayResponse,
  PrepareSendPaymentResponse,
  SdkEvent,
} from "@breeztech/breez-sdk-spark/web";

export class SparkNotEnabledError extends Error {
  constructor() {
    super(
      "Lightning & Spark payments are not enabled on this deployment yet: the app is missing its Breez API key (VITE_BREEZ_API_KEY). On-chain self-custody is unaffected.",
    );
    this.name = "SparkNotEnabledError";
  }
}

function breezApiKey(): string | undefined {
  const key = import.meta.env.VITE_BREEZ_API_KEY as string | undefined;
  return key && key.trim() ? key.trim() : undefined;
}

export function sparkEnabled(): boolean {
  return breezApiKey() !== undefined;
}

// ── Instance discipline (same as the module this replaces) ─────────────
// One SDK instance per unlocked mnemonic. If a different wallet is
// unlocked in the same page session, the previous instance is
// disconnected first — instances are never shared across seeds.

let sdkPromise: Promise<BreezSdk> | null = null;
let connectedKeyFingerprint: string | null = null;
let connectedStorageDir: string | null = null;
let connectedAutoClaimSignature: string | null = null;
let eventCallback: ((event: SdkEvent) => void) | null = null;

/**
 * The per-wallet SDK storage directory: two wallets used on one device
 * never share SDK state. The fingerprint is a hash of the mnemonic,
 * never the mnemonic itself. Pure — unit-tested.
 */
export function sparkStorageDir(keyFingerprint: string): string {
  return `bmaglass-spark-${keyFingerprint.slice(0, 16)}`;
}

// ── Stale-chunk auto-recovery ──────────────────────────────────────────
// After a redeploy, the page in an open tab still references the OLD
// hashed JS chunks. The SDK is loaded with a dynamic import(), so the
// first connect after a deploy can fail with "Failed to fetch
// dynamically imported module" until the user reloads by hand (seen
// twice in QA). Recovery: reload the page ONCE — the fresh HTML points
// at the new chunks. A sessionStorage flag makes a loop impossible:
// if the import still fails after one reload, the error surfaces
// honestly instead of reloading forever.

export const SPARK_CHUNK_RELOAD_KEY = "bmaglass.sparkChunkReload.v1";

/** True when an error is a dynamic-import / lazy-chunk load failure. Pure — unit-tested. */
export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /dynamically imported module|chunkloaderror|loading chunk .* failed|importing a module script failed/i.test(
    message,
  );
}

/**
 * Reload is warranted only for a chunk-load failure that has not
 * already been retried once. Pure — unit-tested.
 */
export function shouldReloadForChunkError(error: unknown, alreadyReloaded: boolean): boolean {
  return !alreadyReloaded && isChunkLoadError(error);
}

function chunkReloadAttempted(): boolean {
  try {
    return sessionStorage.getItem(SPARK_CHUNK_RELOAD_KEY) === "1";
  } catch {
    return false;
  }
}

function markChunkReloadAttempted(): void {
  try {
    sessionStorage.setItem(SPARK_CHUNK_RELOAD_KEY, "1");
  } catch {
    // Storage unavailable: the reload still happens once per import
    // attempt; worst case the user sees the honest error afterwards.
  }
}

function clearChunkReloadMark(): void {
  try {
    sessionStorage.removeItem(SPARK_CHUNK_RELOAD_KEY);
  } catch {
    // Non-fatal.
  }
}

type SparkModule = typeof import("@breeztech/breez-sdk-spark/web");

async function importSparkModule(): Promise<SparkModule> {
  try {
    const mod = await import("@breeztech/breez-sdk-spark/web");
    // A successful load proves the chunks are current again: re-arm
    // the one-time recovery for the NEXT deploy.
    clearChunkReloadMark();
    return mod;
  } catch (e) {
    if (shouldReloadForChunkError(e, chunkReloadAttempted()) && typeof window !== "undefined") {
      markChunkReloadAttempted();
      window.location.reload();
      // The page is reloading; never settle, so no error UI flashes
      // in the page that is about to be replaced.
      return new Promise<SparkModule>(() => {});
    }
    throw e;
  }
}

// ── SDK persisted-state wipe (H3) ──────────────────────────────────────
// The web build persists wallet state in IndexedDB. Empirically
// verified against the installed @breeztech/breez-sdk-spark@0.27.0 web
// build (its own WASM + storage JS, run headlessly): for storageDir
// `bmaglass-spark-<fp16>` on mainnet, connect() opens exactly two
// databases —
//   <storageDir>/mainnet/<id8>        (main storage, IDB version 23)
//   <storageDir>/mainnet/<id8>-tree   (tree store, IDB version 6)
// where <id8> is an 8-hex-char per-wallet identifier the SDK derives
// internally. Disconnecting the SDK does NOT delete either database,
// so without this wipe the wallet's state (payment history, deposit
// records, sync state) sits in the browser indefinitely while the
// wallet presents as "locked".
//
// Wipe strategy — discovery by exact prefix, never name computation:
// every database belonging to this wallet starts with the storageDir
// string followed by "/". We enumerate indexedDB.databases(), delete
// every name matching that prefix (plus the bare storageDir, in case a
// future SDK version uses it directly), and touch nothing else: other
// wallets have a different fingerprint prefix, and our own encrypted
// vault lives in localStorage, not IndexedDB, so unlock is unaffected
// — the SDK re-derives and re-syncs everything from the mnemonic on
// the next unlock. Names seen at connect time are also remembered, so
// the wipe still has exact targets on browsers where databases() is
// unavailable at lock time.

const knownDbNamesByStorageDir = new Map<string, Set<string>>();

/**
 * From a list of all IndexedDB database names, select exactly those
 * belonging to one wallet's storageDir. Pure — unit-tested.
 */
export function sparkStorageDbNames(allNames: string[], storageDir: string): string[] {
  return allNames.filter((name) => name === storageDir || name.startsWith(`${storageDir}/`));
}

async function listIndexedDbNames(): Promise<string[]> {
  try {
    if (typeof indexedDB === "undefined" || typeof indexedDB.databases !== "function") return [];
    const dbs = await indexedDB.databases();
    return dbs.map((d) => d.name).filter((n): n is string => typeof n === "string" && n.length > 0);
  } catch {
    return [];
  }
}

/** Remember the exact database names this wallet's SDK is using (called after a successful connect). */
async function recordSparkStorageDbNames(storageDir: string): Promise<void> {
  const names = sparkStorageDbNames(await listIndexedDbNames(), storageDir);
  if (names.length > 0) knownDbNamesByStorageDir.set(storageDir, new Set(names));
}

function deleteIndexedDb(name: string): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    try {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = done;
      request.onerror = done;
      // Blocked = another connection (e.g. the just-disconnected SDK)
      // has not closed yet. The deletion still completes once it does;
      // never let it hang the lock flow.
      request.onblocked = done;
      setTimeout(done, 3000);
    } catch {
      done();
    }
  });
}

/**
 * Delete the Spark SDK's persisted IndexedDB state for ONE wallet
 * (identified by its storageDir). Best-effort and silent: a failed wipe
 * must never break locking. Our own encrypted vault is NOT touched.
 */
export async function wipeSparkStorage(storageDir: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const targets = new Set<string>(knownDbNamesByStorageDir.get(storageDir) ?? []);
  for (const name of sparkStorageDbNames(await listIndexedDbNames(), storageDir)) targets.add(name);
  knownDbNamesByStorageDir.delete(storageDir);
  for (const name of targets) {
    await deleteIndexedDb(name);
  }
}

async function fingerprint(mnemonic: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(mnemonic));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Connect (or reuse) the Spark SDK instance for the session mnemonic.
 * `onEvent`, when given, receives SDK events (synced, payment updates,
 * deposit claims) for the lifetime of the instance.
 */
export async function connectSpark(
  mnemonic: string,
  onEvent?: (event: SdkEvent) => void,
): Promise<BreezSdk> {
  const key = breezApiKey();
  if (!key) throw new SparkNotEnabledError();
  if (onEvent) eventCallback = onEvent;
  const autoClaim = loadAutoClaimPreference();
  const autoClaimSignature = JSON.stringify(autoClaim);
  const fp = await fingerprint(mnemonic);
  if (sdkPromise && connectedKeyFingerprint === fp && connectedAutoClaimSignature === autoClaimSignature) {
    return sdkPromise;
  }
  if (sdkPromise) await disconnectSpark();

  connectedKeyFingerprint = fp;
  connectedAutoClaimSignature = autoClaimSignature;
  connectedStorageDir = sparkStorageDir(fp);
  const storageDir = connectedStorageDir;
  sdkPromise = (async () => {
    const mod = await importSparkModule();
    await mod.default();
    const config = mod.defaultConfig("mainnet");
    config.apiKey = key;
    // Automatic claims: the SDK claims on-chain deposits on its own only
    // while the claim's network fee fits this cap (see the Automatic
    // Claims section below). Read fresh at every connect, so a changed
    // preference reconnects with the new cap instead of silently keeping
    // the old one.
    config.maxDepositClaimFee = maxFeeForAutoClaim(autoClaim);
    const sdk = await mod.connect({
      config,
      seed: { type: "mnemonic", mnemonic },
      // Per-wallet storage so two seeds used on one device never share
      // SDK state. The fingerprint is a hash of the mnemonic, never the
      // mnemonic itself.
      storageDir,
    });
    // Learn the exact IndexedDB database names the SDK opened for this
    // wallet, so a later lock can wipe precisely them (see H3 above).
    void recordSparkStorageDbNames(storageDir);
    await sdk.addEventListener({
      onEvent: (event) => {
        if (eventCallback) {
          try {
            eventCallback(event);
          } catch {
            // Listener errors must never take down the SDK event pump.
          }
        }
      },
    });
    return sdk;
  })();
  return sdkPromise;
}

export async function disconnectSpark(): Promise<void> {
  if (!sdkPromise) return;
  const pending = sdkPromise;
  sdkPromise = null;
  connectedKeyFingerprint = null;
  connectedStorageDir = null;
  connectedAutoClaimSignature = null;
  eventCallback = null;
  try {
    const sdk = await pending;
    await sdk.disconnect();
  } catch {
    // Disconnect is best-effort; the instance is dropped regardless.
  }
}

/**
 * The LOCK path: disconnect the SDK, then wipe its persisted IndexedDB
 * state for the wallet that was connected, so a locked wallet leaves
 * no SDK wallet state behind in the browser (H3). The next unlock
 * re-derives and re-syncs from the mnemonic. No-op when no wallet was
 * connected in this page session. Plain disconnectSpark() (used for
 * wallet switches and preference reconnects) deliberately does NOT
 * wipe — only locking does.
 */
export async function disconnectSparkAndWipeStorage(): Promise<void> {
  const storageDir = connectedStorageDir;
  await disconnectSpark();
  if (storageDir) await wipeSparkStorage(storageDir);
}

/** True while an SDK instance exists for the current session (connected or connecting). */
export function sparkConnectionActive(): boolean {
  return sdkPromise !== null;
}

/**
 * Whether returning to the wallet (tab focus / visibility) should
 * trigger a reconnect: the wallet is unlocked, no refresh is already
 * running, and either the SDK connection is down or no balance has
 * been loaded yet (e.g. returning from the MoonPay tab, where the card
 * was left showing "Spark balance: —"). Pure — unit-tested.
 */
export function shouldReconnectSpark(input: {
  unlocked: boolean;
  connectionActive: boolean;
  balanceKnown: boolean;
  busy: boolean;
}): boolean {
  if (!input.unlocked || input.busy) return false;
  return !input.connectionActive || !input.balanceKnown;
}

// ── Info / balance ─────────────────────────────────────────────────────

/** Spark wallet balance in sats (single balance across Lightning, on-chain deposits and Spark transfers). */
export async function sparkBalanceSat(mnemonic: string): Promise<number> {
  const sdk = await connectSpark(mnemonic);
  const info = await sdk.getInfo({ ensureSynced: true });
  return info.balanceSats;
}

export async function sparkIdentityPubkey(mnemonic: string): Promise<string> {
  const sdk = await connectSpark(mnemonic);
  const info = await sdk.getInfo({});
  return info.identityPubkey;
}

// ── Receive ────────────────────────────────────────────────────────────

export interface SparkReceiveResult {
  /** The destination string to show / encode as QR (invoice, address). */
  destination: string;
  /** Receive fee charged by the SDK, in sats. */
  feeSats: number;
}

/** Create a BOLT11 Lightning invoice payable to this wallet. Amount optional (amountless invoice when omitted). */
export async function sparkReceiveBolt11(
  mnemonic: string,
  amountSat: number | undefined,
  description: string,
): Promise<SparkReceiveResult> {
  if (amountSat !== undefined && (!Number.isSafeInteger(amountSat) || amountSat <= 0)) {
    throw new Error("Amount must be a positive whole number of sats");
  }
  const sdk = await connectSpark(mnemonic);
  const response = await sdk.receivePayment({
    paymentMethod: {
      type: "bolt11Invoice",
      description: description || "BMaGlass Pay",
      amountSats: amountSat,
    },
  });
  return { destination: response.paymentRequest, feeSats: Number(response.fee) };
}

/**
 * The wallet's on-chain Bitcoin deposit address. Deposits are detected
 * by the SDK and claimed into the Spark balance automatically while the
 * claim fee fits the user's Automatic Claims limit (standard claim at 3
 * confirmations; earlier when an instant/expedited claim fits the cap).
 * This is also where MoonPay purchases land.
 */
export async function sparkReceiveBitcoinAddress(mnemonic: string): Promise<SparkReceiveResult> {
  const sdk = await connectSpark(mnemonic);
  const response = await sdk.receivePayment({ paymentMethod: { type: "bitcoinAddress" } });
  return { destination: response.paymentRequest, feeSats: Number(response.fee) };
}

/** The wallet's Spark address (instant, feeless-to-receive Spark transfers). */
export async function sparkReceiveSparkAddress(mnemonic: string): Promise<SparkReceiveResult> {
  const sdk = await connectSpark(mnemonic);
  const response = await sdk.receivePayment({ paymentMethod: { type: "sparkAddress" } });
  return { destination: response.paymentRequest, feeSats: Number(response.fee) };
}

// ── Parse: classify anything pasted into the Send box ──────────────────

export type ParsedFlow =
  | "send" // prepareSendPayment → sendPayment
  | "lnurlPay" // prepareLnurlPay → lnurlPay
  | "lnurlWithdraw" // lnurlWithdraw
  | "lnurlAuth" // lnurlAuth
  | "unsupported";

/** Map an SDK parse result to the flow the UI should drive. Pure — unit-tested. */
export function parsedFlow(parsed: InputType): ParsedFlow {
  switch (parsed.type) {
    case "bolt11Invoice":
    case "bolt12Invoice":
    case "bolt12Offer":
    case "bolt12InvoiceRequest":
    case "bitcoinAddress":
    case "silentPaymentAddress":
    case "sparkAddress":
    case "sparkInvoice":
    case "bip21":
    case "crossChainAddress":
      return "send";
    case "lnurlPay":
    case "lightningAddress":
      return "lnurlPay";
    case "lnurlWithdraw":
      return "lnurlWithdraw";
    case "lnurlAuth":
      return "lnurlAuth";
    default:
      return "unsupported";
  }
}

const INPUT_TYPE_LABELS: Record<string, string> = {
  bolt11Invoice: "Lightning invoice (BOLT11)",
  bolt12Invoice: "Lightning invoice (BOLT12)",
  bolt12Offer: "BOLT12 offer",
  bolt12InvoiceRequest: "BOLT12 invoice request",
  bitcoinAddress: "Bitcoin address",
  silentPaymentAddress: "Silent payment address",
  sparkAddress: "Spark address",
  sparkInvoice: "Spark invoice",
  bip21: "Bitcoin payment link (BIP21)",
  crossChainAddress: "Cross-chain address",
  lnurlPay: "LNURL payment",
  lightningAddress: "Lightning address",
  lnurlWithdraw: "LNURL withdraw",
  lnurlAuth: "LNURL sign-in",
  url: "Web link",
};

/** Human label for a parse result type. Pure — unit-tested. */
export function parsedInputLabel(parsed: InputType): string {
  return INPUT_TYPE_LABELS[parsed.type] ?? "Payment request";
}

/** Parse any pasted destination with the SDK. Throws (SDK error) on unrecognised input. */
export async function sparkParseInput(mnemonic: string, input: string): Promise<InputType> {
  const sdk = await connectSpark(mnemonic);
  return sdk.parse(input.trim());
}

// ── Send: prepare (fee preview) → send ─────────────────────────────────

export interface FeePreviewLine {
  label: string;
  feeSats: number;
}

export interface FeePreview {
  lines: FeePreviewLine[];
  /** The headline fee for the default route/speed, when there is one. */
  primaryFeeSats: number | null;
  /** True when the on-chain quote is an estimate (see Spark docs: token-funded sends). */
  isEstimate: boolean;
}

/**
 * Extract the user-facing fee preview from a prepareSendPayment
 * response. Fees are quoted live by the SDK in the prepare step — never
 * hard-coded. Pure — unit-tested.
 */
export function feePreview(prepare: PrepareSendPaymentResponse): FeePreview {
  const method = prepare.paymentMethod;
  switch (method.type) {
    case "bolt11Invoice": {
      const lines: FeePreviewLine[] = [
        { label: "Lightning fee", feeSats: method.lightningFeeSats },
      ];
      if (method.sparkTransferFeeSats !== undefined) {
        lines.push({ label: "Spark transfer fee (if paid via Spark)", feeSats: method.sparkTransferFeeSats });
      }
      return { lines, primaryFeeSats: method.lightningFeeSats, isEstimate: false };
    }
    case "bitcoinAddress": {
      const q = method.feeQuote;
      const total = (s: { userFeeSat: number; l1BroadcastFeeSat: number }) => s.userFeeSat + s.l1BroadcastFeeSat;
      return {
        lines: [
          { label: "On-chain fee — slow", feeSats: total(q.speedSlow) },
          { label: "On-chain fee — medium", feeSats: total(q.speedMedium) },
          { label: "On-chain fee — fast", feeSats: total(q.speedFast) },
        ],
        primaryFeeSats: total(q.speedMedium),
        isEstimate: q.isEstimate,
      };
    }
    case "sparkAddress":
    case "sparkInvoice":
      return {
        lines: [{ label: "Spark transfer fee", feeSats: Number(method.fee) }],
        primaryFeeSats: Number(method.fee),
        isEstimate: false,
      };
    case "crossChainAddress":
      return {
        lines: [{ label: "Cross-chain fee", feeSats: Number(method.feeAmount) }],
        primaryFeeSats: Number(method.feeAmount),
        isEstimate: false,
      };
    default:
      return { lines: [], primaryFeeSats: null, isEstimate: false };
  }
}

export interface PreparedSend {
  prepareResponse: PrepareSendPaymentResponse;
  amountSats: number;
  fee: FeePreview;
}

/**
 * Prepare a send for ANY destination the unified Send box accepts
 * (BOLT11/BOLT12, Bitcoin address, Spark address/invoice, BIP21…).
 * Returns the live fee quote for UI confirmation; nothing is sent yet.
 * `amountSat` is required for amountless destinations (e.g. a bare
 * Bitcoin/Spark address) and must be omitted when the destination
 * already fixes the amount (e.g. a BOLT11 invoice with an amount).
 */
export async function sparkPrepareSend(
  mnemonic: string,
  input: string,
  amountSat?: number,
): Promise<PreparedSend> {
  if (amountSat !== undefined && (!Number.isSafeInteger(amountSat) || amountSat <= 0)) {
    throw new Error("Amount must be a positive whole number of sats");
  }
  const sdk = await connectSpark(mnemonic);
  const prepareResponse = await sdk.prepareSendPayment({
    paymentRequest: { type: "input", input: input.trim() },
    amount: amountSat !== undefined ? BigInt(amountSat) : undefined,
  });
  return {
    prepareResponse,
    amountSats: Number(prepareResponse.amount),
    fee: feePreview(prepareResponse),
  };
}

/** Execute a previously prepared send (fee was shown to the user first). */
export async function sparkSendPrepared(
  mnemonic: string,
  prepared: PreparedSend,
  confirmationSpeed: "slow" | "medium" | "fast" = "medium",
): Promise<Payment> {
  const sdk = await connectSpark(mnemonic);
  const options =
    prepared.prepareResponse.paymentMethod.type === "bitcoinAddress"
      ? ({ type: "bitcoinAddress", confirmationSpeed } as const)
      : undefined;
  const response = await sdk.sendPayment({
    prepareResponse: prepared.prepareResponse,
    options,
  });
  return response.payment;
}

// ── LNURL pay (Lightning address / LNURL-pay links) ────────────────────

/** Extract the LNURL-pay request details from a parse result (lnurlPay or lightningAddress). */
export function lnurlPayDetails(parsed: InputType): LnurlPayRequestDetails | null {
  const raw =
    parsed.type === "lnurlPay" ? parsed : parsed.type === "lightningAddress" ? parsed.payRequest : null;
  if (!raw) return null;
  // Rebuild a clean details object: the parse result carries a `type`
  // tag that is not part of LnurlPayRequestDetails.
  return {
    callback: raw.callback,
    minSendable: raw.minSendable,
    maxSendable: raw.maxSendable,
    metadataStr: raw.metadataStr,
    commentAllowed: raw.commentAllowed,
    domain: raw.domain,
    url: raw.url,
    address: raw.address,
    allowsNostr: raw.allowsNostr,
    nostrPubkey: raw.nostrPubkey,
  };
}

export interface PreparedLnurlPay {
  prepareResponse: PrepareLnurlPayResponse;
  amountSats: number;
  feeSats: number;
}

export async function sparkPrepareLnurlPay(
  mnemonic: string,
  details: LnurlPayRequestDetails,
  amountSat: number,
  comment?: string,
): Promise<PreparedLnurlPay> {
  if (!Number.isSafeInteger(amountSat) || amountSat <= 0) {
    throw new Error("Amount must be a positive whole number of sats");
  }
  const sdk = await connectSpark(mnemonic);
  const prepareResponse = await sdk.prepareLnurlPay({
    payRequest: details,
    amount: BigInt(amountSat),
    comment,
  });
  return {
    prepareResponse,
    amountSats: prepareResponse.amountSats,
    feeSats: prepareResponse.feeSats,
  };
}

export async function sparkSendLnurlPay(
  mnemonic: string,
  prepared: PreparedLnurlPay,
): Promise<Payment> {
  const sdk = await connectSpark(mnemonic);
  const response = await sdk.lnurlPay({ prepareResponse: prepared.prepareResponse });
  return response.payment;
}

// ── LNURL withdraw / auth ──────────────────────────────────────────────

/** Claim an LNURL-withdraw offer into this wallet. Returns the resulting payment request string. */
export async function sparkLnurlWithdraw(
  mnemonic: string,
  parsed: InputType,
  amountSat: number,
): Promise<{ paymentRequest: string; payment: Payment | undefined }> {
  if (parsed.type !== "lnurlWithdraw") {
    throw new Error("That input is not an LNURL-withdraw offer");
  }
  if (!Number.isSafeInteger(amountSat) || amountSat <= 0) {
    throw new Error("Amount must be a positive whole number of sats");
  }
  const details: LnurlWithdrawRequestDetails = {
    callback: parsed.callback,
    k1: parsed.k1,
    defaultDescription: parsed.defaultDescription,
    minWithdrawable: parsed.minWithdrawable,
    maxWithdrawable: parsed.maxWithdrawable,
    url: parsed.url,
  };
  const sdk = await connectSpark(mnemonic);
  const response = await sdk.lnurlWithdraw({ amountSats: amountSat, withdrawRequest: details });
  return { paymentRequest: response.paymentRequest, payment: response.payment };
}

/** Answer an LNURL-auth (sign-in) challenge with the wallet's key. */
export async function sparkLnurlAuth(mnemonic: string, parsed: InputType): Promise<string> {
  if (parsed.type !== "lnurlAuth") {
    throw new Error("That input is not an LNURL sign-in request");
  }
  const details: LnurlAuthRequestDetails = {
    k1: parsed.k1,
    action: parsed.action,
    domain: parsed.domain,
    url: parsed.url,
  };
  const sdk = await connectSpark(mnemonic);
  const status = await sdk.lnurlAuth(details);
  return status.type;
}

// ── History ────────────────────────────────────────────────────────────

export interface PaymentSummary {
  id: string;
  direction: "send" | "receive";
  amountSats: number;
  feesSats: number;
  status: string;
  method: string;
  timestamp: number;
}

/** Normalise an SDK Payment for display. Pure — unit-tested. */
export function paymentSummary(payment: Payment): PaymentSummary {
  return {
    id: payment.id,
    direction: payment.paymentType,
    amountSats: Number(payment.amount),
    feesSats: Number(payment.fees),
    status: payment.status,
    method: payment.method,
    timestamp: payment.timestamp,
  };
}

/** Recent Spark-wallet payments, newest first. */
export async function sparkListPayments(mnemonic: string, limit = 20): Promise<PaymentSummary[]> {
  const sdk = await connectSpark(mnemonic);
  const response = await sdk.listPayments({ limit, offset: 0, sortAscending: false });
  return response.payments.map(paymentSummary);
}

// ── MoonPay buy (Glow-style) ───────────────────────────────────────────

/**
 * Start a MoonPay purchase via the SDK and return the hosted checkout
 * URL. Runs under Breez's MoonPay partner arrangement — the app needs no
 * MoonPay account or keys of its own. The purchased Bitcoin is delivered
 * to this wallet's on-chain deposit address and claimed into the balance
 * by the SDK automatically.
 *
 * WEB NOTE (documented by Breez): on web, `window.open()` called AFTER
 * awaiting this call is typically blocked by mobile browsers/PWAs — the
 * caller (UI click handler) must pre-open a blank tab synchronously and
 * navigate it to the returned URL.
 */
export async function sparkBuyBitcoinUrl(
  mnemonic: string,
  opts?: { amountSat?: number; redirectUrl?: string },
): Promise<string> {
  if (opts?.amountSat !== undefined && (!Number.isSafeInteger(opts.amountSat) || opts.amountSat <= 0)) {
    throw new Error("Amount must be a positive whole number of sats");
  }
  const sdk = await connectSpark(mnemonic);
  const response = await sdk.buyBitcoin({
    type: "moonpay",
    delivery: opts?.amountSat !== undefined ? { type: "bitcoin", amountSat: opts.amountSat } : undefined,
    redirectUrl: opts?.redirectUrl,
  });
  return response.url;
}

// ── Automatic Claims (on-chain deposit claiming) ───────────────────────
//
// Product default (CEO): Automatic Claims ON — on-chain deposits are
// claimed automatically while the network fee stays under a FIXED limit
// of 500 sats; the user can change the limit or turn it off.
//
// SDK ground truth (@breeztech/breez-sdk-spark 0.27.0 types + the
// official "Claiming on-chain deposits" guide): the SDK claims deposits
// on its own (instant/expedited when offered, standard at 3
// confirmations) as long as the claim fee fits `Config.maxDepositClaimFee`
// — a `MaxFee { onchain: MaxOnchainFee }` where MaxOnchainFee includes
// `{ type: "fixed", amount }`, an absolute cap in sats. connectSpark sets
// it from the preference below on every connect. A claim fee above the
// cap leaves the deposit unclaimed (DepositClaimError
// "maxDepositClaimFeeExceeded" / a claim deferred with reason
// "maxFeeExceeded") until fees fall or the user claims it manually via
// claimDeposit — which is what the wallet UI surfaces.
//
// "Off" is expressed as a fixed cap of 0 sats: a real claim always costs
// at least 1 sat of network fee, so no automatic claim can fit, while
// manual claims remain available. The preference lives ONLY on this
// device (localStorage) — SDK deposit max-fees are per-device by design.

export interface AutoClaimPreference {
  enabled: boolean;
  /** Fixed fee limit in sats. Claims at or under this fee auto-claim. */
  maxFeeSats: number;
}

export const AUTO_CLAIM_STORAGE_KEY = "bmaglass.sparkAutoClaim";

export const DEFAULT_AUTO_CLAIM_PREFERENCE: AutoClaimPreference = {
  enabled: true,
  maxFeeSats: 500,
};

/**
 * Parse a stored preference, falling back to the product default on
 * anything missing or malformed. Pure — unit-tested.
 */
export function parseAutoClaimPreference(raw: string | null): AutoClaimPreference {
  if (!raw) return { ...DEFAULT_AUTO_CLAIM_PREFERENCE };
  try {
    const parsed = JSON.parse(raw) as Partial<AutoClaimPreference>;
    const maxFeeSats = Number(parsed.maxFeeSats);
    return {
      enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : DEFAULT_AUTO_CLAIM_PREFERENCE.enabled,
      maxFeeSats:
        Number.isSafeInteger(maxFeeSats) && maxFeeSats > 0 ? maxFeeSats : DEFAULT_AUTO_CLAIM_PREFERENCE.maxFeeSats,
    };
  } catch {
    return { ...DEFAULT_AUTO_CLAIM_PREFERENCE };
  }
}

export function loadAutoClaimPreference(): AutoClaimPreference {
  try {
    return parseAutoClaimPreference(localStorage.getItem(AUTO_CLAIM_STORAGE_KEY));
  } catch {
    return { ...DEFAULT_AUTO_CLAIM_PREFERENCE };
  }
}

export function saveAutoClaimPreference(pref: AutoClaimPreference): void {
  try {
    localStorage.setItem(AUTO_CLAIM_STORAGE_KEY, JSON.stringify(pref));
  } catch {
    // Storage unavailable (private mode): the preference simply will not
    // persist; the running session still applies it on the next connect.
  }
}

/**
 * The SDK config value for a preference: a FIXED sats cap on the
 * on-chain claim fee (the product's "Fixed — N sats" behaviour). Pure —
 * unit-tested.
 */
export function maxFeeForAutoClaim(pref: AutoClaimPreference): MaxFee {
  return { onchain: { type: "fixed", amount: pref.enabled ? pref.maxFeeSats : 0 } };
}

/**
 * The auto-claim decision for a single claim fee: claim automatically
 * only while the fee is at or under the user's limit. Pure —
 * unit-tested. All thresholds stay in sats, always.
 */
export function shouldAutoClaim(feeSats: number, pref: AutoClaimPreference): boolean {
  return (
    pref.enabled &&
    Number.isSafeInteger(feeSats) &&
    feeSats >= 0 &&
    Number.isSafeInteger(pref.maxFeeSats) &&
    feeSats <= pref.maxFeeSats
  );
}

export type UnclaimedDepositStatus =
  | "confirming" // not yet at standard claim depth; SDK claims when ready if the fee fits
  | "withinLimit" // mature, nothing blocks the SDK's automatic claim under the current settings
  | "overLimit" // claim fee is above the user's limit (or automatic claims are off): stays unclaimed until fees fall or the user claims manually
  | "claimFailed"; // the SDK tried and failed for a reason other than the fee cap

export interface UnclaimedDepositSummary {
  txid: string;
  vout: number;
  amountSats: number;
  isMature: boolean;
  /** Standard (3-confirmation) claim fee from the SDK quote, sats; null when the quote was unavailable. */
  claimFeeSats: number | null;
  /** Instant/expedited claim fee when the provider offers one, sats. */
  instantFeeSats: number | null;
  /** What the user would receive from a standard claim (amount − fee), sats. */
  creditSats: number | null;
  status: UnclaimedDepositStatus;
  /** Fee the claim actually requires when the SDK reported the cap was exceeded, sats. */
  requiredFeeSats: number | null;
  /** Plain-language claim failure, when the deposit carries one. */
  claimErrorMessage: string | null;
}

/**
 * Derive the display status of an unclaimed deposit from its SDK record
 * and the standard-claim fee quote. Pure — unit-tested.
 */
export function unclaimedDepositStatus(
  deposit: DepositInfo,
  pref: AutoClaimPreference,
  standardFeeSats: number | null,
): Pick<UnclaimedDepositSummary, "status" | "requiredFeeSats" | "claimErrorMessage"> {
  const error = deposit.claimError;
  if (error) {
    if (error.type === "maxDepositClaimFeeExceeded") {
      return { status: "overLimit", requiredFeeSats: error.requiredFeeSats, claimErrorMessage: null };
    }
    const message =
      error.type === "depositTooSmall"
        ? "This deposit is too small to claim — the network fee would cost more than it is worth."
        : error.type === "missingUtxo"
          ? "The deposit output could not be found on-chain."
          : error.message;
    return { status: "claimFailed", requiredFeeSats: null, claimErrorMessage: message };
  }
  if (!deposit.isMature) {
    return { status: "confirming", requiredFeeSats: null, claimErrorMessage: null };
  }
  if (standardFeeSats !== null && !shouldAutoClaim(standardFeeSats, pref)) {
    return { status: "overLimit", requiredFeeSats: standardFeeSats, claimErrorMessage: null };
  }
  return { status: "withinLimit", requiredFeeSats: null, claimErrorMessage: null };
}

/**
 * Deposits the SDK is tracking but has not claimed yet, each priced with
 * the documented quote (`fetchClaimDepositQuote`): the standard claim's
 * fee and the instant fee when offered. A failed quote never hides the
 * deposit — its fee fields come back null instead.
 */
export async function sparkListUnclaimedDeposits(mnemonic: string): Promise<UnclaimedDepositSummary[]> {
  const sdk = await connectSpark(mnemonic);
  const pref = loadAutoClaimPreference();
  const { deposits } = await sdk.listUnclaimedDeposits({});
  const summaries: UnclaimedDepositSummary[] = [];
  for (const deposit of deposits) {
    let claimFeeSats: number | null = null;
    let instantFeeSats: number | null = null;
    let creditSats: number | null = null;
    try {
      const quote = await sdk.fetchClaimDepositQuote({ txid: deposit.txid, vout: deposit.vout });
      claimFeeSats = quote.mature.feeSats;
      creditSats = quote.mature.creditAmountSats;
      instantFeeSats = quote.instant ? quote.instant.feeSats : null;
    } catch {
      // Quote unavailable (e.g. provider offline): show the deposit with
      // unknown fees rather than dropping it.
    }
    summaries.push({
      txid: deposit.txid,
      vout: deposit.vout,
      amountSats: deposit.amountSats,
      isMature: deposit.isMature,
      claimFeeSats,
      instantFeeSats,
      creditSats,
      ...unclaimedDepositStatus(deposit, pref, claimFeeSats),
    });
  }
  return summaries;
}

/**
 * Claim one deposit manually at a fee the user has seen and accepted.
 * The accepted fee is passed as the claim's own max fee: per the SDK
 * docs it is recorded on the deposit and governs the SDK's later
 * automatic attempts on it — and if the real fee has risen above it by
 * the time the claim runs, the SDK defers instead of overcharging
 * silently, which this surfaces as an error.
 */
export async function sparkClaimDeposit(
  mnemonic: string,
  txid: string,
  vout: number,
  acceptedFeeSats: number,
): Promise<"settled" | "submitted"> {
  if (!Number.isSafeInteger(acceptedFeeSats) || acceptedFeeSats <= 0) {
    throw new Error("A claim fee must be a positive whole number of sats");
  }
  const sdk = await connectSpark(mnemonic);
  const { outcome } = await sdk.claimDeposit({
    txid,
    vout,
    maxFee: { onchain: { type: "fixed", amount: acceptedFeeSats } },
  });
  if (outcome.type === "deferred") {
    if (outcome.reason.type === "maxFeeExceeded") {
      throw new Error(
        `The claim fee rose to ${outcome.reason.requiredFeeSats} sats, above the ${acceptedFeeSats} sats you accepted — the deposit was not claimed.`,
      );
    }
    if (outcome.reason.type === "providerDeclined") {
      throw new Error(`The claim was declined by the provider: ${outcome.reason.message}`);
    }
    throw new Error("No early claim is available for this deposit yet — it can be claimed once it reaches 3 confirmations.");
  }
  return outcome.type;
}

// ── Fiat value display (display-only, user-controlled) ─────────────────
//
// The user can opt in to seeing approximate fiat equivalents next to sat
// figures. Conversion is DISPLAY-ONLY: operations, thresholds (incl. the
// auto-claim limit) and tests always stay in sats. The fiat-per-BTC rate
// is composed by the UI from the app's existing price machinery (BTC/USD
// spot — the same Coinbase source the trade function uses — times the
// exchange_rates USD→user-currency rate). When no rate is available the
// helpers return null and the UI shows the sats figure alone — never a
// stale or fabricated value.

export const SHOW_FIAT_STORAGE_KEY = "bmaglass.sparkShowFiat";

/** Parse the stored fiat-display preference (default: off). Pure — unit-tested. */
export function parseShowFiatPreference(raw: string | null): boolean {
  return raw === "true" || raw === "1";
}

export function loadShowFiatPreference(): boolean {
  try {
    return parseShowFiatPreference(localStorage.getItem(SHOW_FIAT_STORAGE_KEY));
  } catch {
    return false;
  }
}

export function saveShowFiatPreference(on: boolean): void {
  try {
    localStorage.setItem(SHOW_FIAT_STORAGE_KEY, on ? "true" : "false");
  } catch {
    // As with the auto-claim preference: non-persistence is acceptable.
  }
}

/** Fiat value of a sat amount at a fiat-per-BTC rate, or null when it cannot be computed honestly. Pure — unit-tested. */
export function satsToFiatAmount(sats: number, fiatPerBtc: number | null | undefined): number | null {
  if (fiatPerBtc === null || fiatPerBtc === undefined) return null;
  if (!Number.isFinite(fiatPerBtc) || fiatPerBtc <= 0) return null;
  if (!Number.isFinite(sats) || sats < 0) return null;
  return (sats / 100_000_000) * fiatPerBtc;
}

/**
 * "≈ K1,234.56"-style equivalent for a sat amount, or null when no
 * honest value exists (no/invalid rate). Pure — unit-tested.
 */
export function formatFiatEquivalent(
  sats: number,
  fiatPerBtc: number | null | undefined,
  currency: string,
  locale?: string,
): string | null {
  const amount = satsToFiatAmount(sats, fiatPerBtc);
  if (amount === null) return null;
  try {
    const formatted = new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
    return `≈ ${formatted}`;
  } catch {
    return null;
  }
}
