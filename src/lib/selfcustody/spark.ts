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
  InputType,
  LnurlAuthRequestDetails,
  LnurlPayRequestDetails,
  LnurlWithdrawRequestDetails,
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
let eventCallback: ((event: SdkEvent) => void) | null = null;

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
  const fp = await fingerprint(mnemonic);
  if (sdkPromise && connectedKeyFingerprint === fp) return sdkPromise;
  if (sdkPromise) await disconnectSpark();

  connectedKeyFingerprint = fp;
  sdkPromise = (async () => {
    const mod = await import("@breeztech/breez-sdk-spark/web");
    await mod.default();
    const config = mod.defaultConfig("mainnet");
    config.apiKey = key;
    const sdk = await mod.connect({
      config,
      seed: { type: "mnemonic", mnemonic },
      // Per-wallet storage so two seeds used on one device never share
      // SDK state. The fingerprint is a hash of the mnemonic, never the
      // mnemonic itself.
      storageDir: `bmaglass-spark-${fp.slice(0, 16)}`,
    });
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
  eventCallback = null;
  try {
    const sdk = await pending;
    await sdk.disconnect();
  } catch {
    // Disconnect is best-effort; the instance is dropped regardless.
  }
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
 * and claimed into the Spark balance by the SDK automatically (after 3
 * confirmations by default). This is also where MoonPay purchases land.
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
