// Server-side Payoneer operations (Deno) for the payouts rail —
// the Payoneer mirror of _shared/paypal-payout-server.ts and
// _shared/stripe-gateway-server.ts.
//
// Used by:
//   - `payoneer-payouts` — the admin actions (create_payout /
//     refresh_status / registration_link / status).
//   - `payoneer-webhook` — the backstop: events are HINTS; the
//     payment is re-queried from Payoneer and the row settled from
//     THAT state (refreshPayoutFromProvider / applyProviderStatus).
//
// Money rules encoded here:
//   - LEDGER FIRST: createPayoutRow persists the row (status
//     'pending', client_reference_id = its uuid_id) before any
//     provider call, so every provider payment has exactly one row.
//   - DEBIT ON API SUCCESS (brief §2.1): Payoneer takes the money
//     from the platform float at creation, so the internal wallet
//     debit happens only after Payoneer accepts — never before, and
//     never for a refused create. If the debit then fails, the row
//     is marked failed by the caller and the provider payment id
//     stays on it for ops reconciliation (see the migration note).
//   - REVERSAL EXACTLY ONCE: a confirmed provider failure/reversal
//     credits the wallet back only through the guarded flip
//     debit_state 'debited' → 'reversed' performed in the SAME
//     update as the status change, so status polls and webhook
//     replays racing each other cannot double-credit.
//   - No Payoneer debit/credit RPC exists (the PayPal rail's
//     reserve/refund RPCs are PayPal-table-specific), so wallet
//     movement is a direct service-role wallet update — the
//     fallback the build spec prescribes — guarded by the payout
//     row's debit_state and an optimistic balance check on the
//     wallet row. The admin client MUST be a dedicated service-role
//     client that does not forward any caller Authorization header
//     (the protect_wallet_balance lesson — _shared/supabase-client.ts).
//
// Pure decision logic lives in ./payoneer.ts; every provider-shape
// assumption is isolated there (CONFIRM-AT-ONBOARDING notes).

import {
  buildTokenRequest,
  classifyPayoneerError,
  decideStatusTransition,
  extractProviderStatus,
  mapProviderStatus,
  payoneerConfig,
  payoneerErrorTrace,
  payoneerPayeePath,
  payoneerPaymentPath,
  PAYONEER_PAYMENTS_PATH,
  type PayoneerDebitState,
  type PayoneerEnvValues,
  type PayoneerPayoutStatus,
} from "./payoneer.ts";

// deno-lint-ignore no-explicit-any
type AdminClient = any;

/** Minimal fetch shape (Deno/Node global fetch both satisfy it). */
export type FetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}>;

// ── OAuth token (cached, expiry-aware) ───────────────────────────────

interface CachedToken {
  token: string;
  /** Epoch ms at which the token expires (per the provider answer). */
  expiresAt: number;
}

const tokenCache = new Map<string, CachedToken>();

/** Test hook: the vitest suite resets the module-level cache. */
export function resetPayoneerTokenCache(): void {
  tokenCache.clear();
}

/** Refresh the cached token when it is this close to expiry. */
const TOKEN_REFRESH_SKEW_MS = 60_000;
/** Brief §2.1: tokens live ~1h when the answer omits expires_in. */
const DEFAULT_TOKEN_TTL_SECONDS = 3600;

/**
 * Get a Payoneer access token (OAuth2 client credentials), cached
 * per (environment, client id) and refreshed when under 60s of
 * life remains — the token is fetched server-side only, never per
 * browser request (brief §2.1). `fetchImpl` and `now` are injected
 * so the cache behaviour is unit-testable. Throws a classified,
 * plain-language error on any failure; failures are never cached.
 *
 * Only the OAuth pair (client id + secret) is required here — the
 * Program ID gates the payouts FUNCTION (payoneerConfig), not the
 * token, so the webhook can re-query with the pair alone.
 */
export async function getPayoneerAccessToken(
  fetchImpl: FetchLike,
  values: PayoneerEnvValues,
  now: number = Date.now(),
): Promise<string> {
  const clientId = typeof values.clientId === "string" ? values.clientId.trim() : "";
  const clientSecret = typeof values.clientSecret === "string"
    ? values.clientSecret.trim()
    : "";
  if (!clientId || !clientSecret) {
    throw new Error(
      "Payoneer payouts aren't switched on yet — Payoneer is still being connected. No money has moved.",
    );
  }
  const config = payoneerConfig(values);
  const cacheKey = `${config.env}|${clientId}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt - now > TOKEN_REFRESH_SKEW_MS) {
    return cached.token;
  }

  const request = buildTokenRequest({
    baseUrl: config.baseUrl,
    clientId,
    clientSecret,
  });
  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await fetchImpl(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
    });
  } catch {
    throw new Error(classifyPayoneerError(0));
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    // Trace fields only (audit L1) — never the raw error body.
    console.error("Payoneer token request failed:", payoneerErrorTrace(response.status, body));
    throw new Error(classifyPayoneerError(response.status, body));
  }
  const record = body !== null && typeof body === "object"
    ? (body as Record<string, unknown>)
    : {};
  const token = typeof record.access_token === "string" ? record.access_token : null;
  if (!token) {
    throw new Error(
      "Payoneer did not return an access token. The payout was not sent — please try again in a moment.",
    );
  }
  const expiresIn = typeof record.expires_in === "number" && record.expires_in > 0
    ? record.expires_in
    : DEFAULT_TOKEN_TTL_SECONDS;
  tokenCache.set(cacheKey, { token, expiresAt: now + expiresIn * 1000 });
  return token;
}

// ── Provider API calls ───────────────────────────────────────────────

async function payoneerRequest(
  fetchImpl: FetchLike,
  values: PayoneerEnvValues,
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const config = payoneerConfig(values);
  const token = await getPayoneerAccessToken(fetchImpl, values);
  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await fetchImpl(`${config.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error(classifyPayoneerError(0));
  }
  const parsed = await response.json().catch(() => null);
  if (!response.ok) {
    console.error("Payoneer API error:", payoneerErrorTrace(response.status, parsed));
    throw new Error(classifyPayoneerError(response.status, parsed));
  }
  return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

/**
 * POST /v4/payments — the primary create path (brief §2.1). The
 * program-scoped variant (payoneerProgramPayoutPath in the pure
 * module) is the CONFIRM-AT-ONBOARDING alternative; `body` must
 * already carry client_reference_id = the ledger row's uuid_id
 * (buildCreatePaymentBody).
 */
export function createPayoneerPayment(
  fetchImpl: FetchLike,
  values: PayoneerEnvValues,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return payoneerRequest(fetchImpl, values, "POST", PAYONEER_PAYMENTS_PATH, body);
}

/** GET /v4/payments/{id} — Payoneer's authoritative payment state. */
export function getPayoneerPayment(
  fetchImpl: FetchLike,
  values: PayoneerEnvValues,
  paymentId: string,
): Promise<Record<string, unknown>> {
  return payoneerRequest(fetchImpl, values, "GET", payoneerPaymentPath(paymentId));
}

/** GET /v4/payees/{payee_id} — payee detail / connection state. */
export function getPayoneerPayee(
  fetchImpl: FetchLike,
  values: PayoneerEnvValues,
  payeeId: string,
): Promise<Record<string, unknown>> {
  return payoneerRequest(fetchImpl, values, "GET", payoneerPayeePath(payeeId));
}

// ── Ledger rows ──────────────────────────────────────────────────────

export interface PayoneerPayoutRow {
  id: string;
  uuid_id: string;
  payee_id: string;
  amount: number;
  currency: string;
  description: string | null;
  status: string;
  client_reference_id: string;
  provider_payout_id: string | null;
  provider_status: string | null;
  user_id: string | null;
  wallet_id: string | null;
  debit_state: string;
  error: string | null;
  metadata: Record<string, unknown> | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const ROW_COLUMNS =
  "id, uuid_id, payee_id, amount, currency, description, status, " +
  "client_reference_id, provider_payout_id, provider_status, user_id, " +
  "wallet_id, debit_state, error, metadata, created_by, created_at, updated_at";

export async function findPayoutById(
  admin: AdminClient,
  id: string,
): Promise<PayoneerPayoutRow | null> {
  const { data, error } = await admin
    .from("payoneer_payouts")
    .select(ROW_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Payout lookup failed: ${error.message}`);
  return (data as PayoneerPayoutRow | null) ?? null;
}

export async function findPayoutByUuidId(
  admin: AdminClient,
  uuidId: string,
): Promise<PayoneerPayoutRow | null> {
  const { data, error } = await admin
    .from("payoneer_payouts")
    .select(ROW_COLUMNS)
    .eq("uuid_id", uuidId)
    .maybeSingle();
  if (error) throw new Error(`Payout lookup failed: ${error.message}`);
  return (data as PayoneerPayoutRow | null) ?? null;
}

export async function findPayoutByClientReference(
  admin: AdminClient,
  clientReferenceId: string,
): Promise<PayoneerPayoutRow | null> {
  const { data, error } = await admin
    .from("payoneer_payouts")
    .select(ROW_COLUMNS)
    .eq("client_reference_id", clientReferenceId)
    .maybeSingle();
  if (error) throw new Error(`Payout lookup failed: ${error.message}`);
  return (data as PayoneerPayoutRow | null) ?? null;
}

export async function findPayoutByProviderId(
  admin: AdminClient,
  providerPayoutId: string,
): Promise<PayoneerPayoutRow | null> {
  const { data, error } = await admin
    .from("payoneer_payouts")
    .select(ROW_COLUMNS)
    .eq("provider_payout_id", providerPayoutId)
    .maybeSingle();
  if (error) throw new Error(`Payout lookup failed: ${error.message}`);
  return (data as PayoneerPayoutRow | null) ?? null;
}

/**
 * Find a payout by ANY of our identifiers (row id, uuid_id, or
 * client_reference_id — the refresh action's "our uuid"). The
 * webhook uses the dedicated finders above with its hint ids.
 */
export async function findPayout(
  admin: AdminClient,
  payoutId: string,
): Promise<PayoneerPayoutRow | null> {
  return (
    (await findPayoutById(admin, payoutId)) ??
    (await findPayoutByUuidId(admin, payoutId)) ??
    (await findPayoutByClientReference(admin, payoutId))
  );
}

/**
 * Persist the ledger row FIRST: status 'pending', no provider ids,
 * debit_state 'none', and client_reference_id = the row's uuid_id
 * (generated here, so the anchor exists before anything else can
 * reference it). Every later step hangs off this row.
 */
export async function createPayoutRow(
  admin: AdminClient,
  input: {
    payeeId: string;
    amount: number;
    currency: string;
    description?: string | null;
    userId?: string | null;
    walletId?: string | null;
    createdBy: string;
    metadata?: Record<string, unknown>;
  },
): Promise<PayoneerPayoutRow> {
  const uuidId = crypto.randomUUID();
  const { data, error } = await admin
    .from("payoneer_payouts")
    .insert({
      uuid_id: uuidId,
      client_reference_id: uuidId,
      payee_id: input.payeeId,
      amount: input.amount,
      currency: input.currency,
      description: input.description ?? null,
      status: "pending",
      provider_payout_id: null,
      provider_status: null,
      error: null,
      user_id: input.userId ?? null,
      wallet_id: input.walletId ?? null,
      debit_state: "none",
      created_by: input.createdBy,
      metadata: input.metadata ?? {},
    })
    .select(ROW_COLUMNS)
    .single();
  if (error) throw new Error(`Payout could not be recorded: ${error.message}`);
  return data as PayoneerPayoutRow;
}

/**
 * Record Payoneer's answer on the pending row: provider ids, the
 * mapped lifecycle status, and (when the caller has just debited)
 * debit_state 'debited'. Guarded on the row still being 'pending'
 * so a racing terminal transition is never overwritten.
 */
export async function markSubmitted(
  admin: AdminClient,
  row: PayoneerPayoutRow,
  outcome: {
    status: string;
    providerPayoutId: string | null;
    providerStatus: string | null;
    debitState?: "debited" | "none";
  },
): Promise<PayoneerPayoutRow> {
  const { error } = await admin
    .from("payoneer_payouts")
    .update({
      status: outcome.status,
      provider_payout_id: outcome.providerPayoutId,
      provider_status: outcome.providerStatus,
      ...(outcome.debitState ? { debit_state: outcome.debitState } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id)
    .eq("status", "pending");
  if (error) throw new Error(`Payout update failed: ${error.message}`);
  return (await findPayoutById(admin, row.id)) ?? row;
}

/**
 * Mark a not-yet-terminal row failed with a plain-language reason.
 * Used when the provider refuses the create (no debit ever happens)
 * and when the post-create wallet debit fails (the provider payment
 * id stays on the row for ops reconciliation — see create flow).
 */
export async function markFailed(
  admin: AdminClient,
  row: PayoneerPayoutRow,
  errorMessage: string,
  provider?: { providerPayoutId?: string | null; providerStatus?: string | null },
): Promise<PayoneerPayoutRow> {
  const { error } = await admin
    .from("payoneer_payouts")
    .update({
      status: "failed",
      error: errorMessage,
      ...(provider?.providerPayoutId !== undefined
        ? { provider_payout_id: provider.providerPayoutId }
        : {}),
      ...(provider?.providerStatus !== undefined
        ? { provider_status: provider.providerStatus }
        : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id)
    .in("status", ["pending", "submitted"]);
  if (error) throw new Error(`Payout update failed: ${error.message}`);
  return (await findPayoutById(admin, row.id)) ?? row;
}

// ── Wallet movement (direct, guarded — see header) ───────────────────

interface WalletRow {
  id: string;
  user_id: string;
  currency: string;
  balance: number;
  status: string;
}

async function findWallet(
  admin: AdminClient,
  walletId: string,
): Promise<WalletRow | null> {
  const { data, error } = await admin
    .from("wallets")
    .select("id, user_id, currency, balance, status")
    .eq("id", walletId)
    .maybeSingle();
  if (error) throw new Error(`Wallet lookup failed: ${error.message}`);
  return (data as WalletRow | null) ?? null;
}

function formatAmount(amount: number): string {
  return Number(amount).toFixed(2);
}

export type DebitWalletResult =
  | { ok: true; newBalance: number; alreadyDebited: boolean }
  | { ok: false; message: string };

/**
 * Debit the payout's wallet by the payout amount — called ONLY
 * after Payoneer accepted the create (see header). Mirrors the
 * PayPal rail's debit semantics (owner + currency + active checks,
 * insufficient-balance refusal with the true balance, debit tied
 * to the payout row) with the mechanism available to this rail:
 * an optimistic-concurrency wallet update (the balance read is
 * re-checked in the update's WHERE) followed by the guarded
 * debit_state flip 'none' → 'debited' on the payout row. If the
 * flip loses a race, the debit is put back before answering.
 * Replays on an already-debited row are no-ops.
 */
export async function debitWalletForPayout(
  admin: AdminClient,
  row: PayoneerPayoutRow,
): Promise<DebitWalletResult> {
  if (row.debit_state === "debited") {
    const wallet = row.wallet_id ? await findWallet(admin, row.wallet_id) : null;
    return { ok: true, newBalance: wallet ? Number(wallet.balance) : 0, alreadyDebited: true };
  }
  if (row.debit_state !== "none") {
    return { ok: false, message: "This payout's wallet debit was already reversed." };
  }
  if (!row.wallet_id || !row.user_id) {
    return { ok: false, message: "This payout has no wallet to debit." };
  }
  const wallet = await findWallet(admin, row.wallet_id);
  if (!wallet) {
    return { ok: false, message: "The wallet for this payout could not be found." };
  }
  if (wallet.user_id !== row.user_id) {
    return { ok: false, message: "That wallet does not belong to the payout owner." };
  }
  if (wallet.currency !== row.currency) {
    return {
      ok: false,
      message:
        `That wallet holds ${wallet.currency}, but this payout is in ${row.currency}. ` +
        "Use a wallet in the payout currency.",
    };
  }
  if (wallet.status !== "active") {
    return { ok: false, message: "That wallet can't send money right now." };
  }
  const amount = Number(row.amount);
  const balance = Number(wallet.balance);
  if (balance < amount) {
    return {
      ok: false,
      message:
        `Insufficient balance: the wallet holds ${formatAmount(balance)} ${row.currency} ` +
        `and this payout needs ${formatAmount(amount)} ${row.currency}.`,
    };
  }

  const { data: debitedRows, error: debitError } = await admin
    .from("wallets")
    .update({ balance: balance - amount, updated_at: new Date().toISOString() })
    .eq("id", wallet.id)
    .eq("balance", wallet.balance)
    .select("id");
  if (debitError) throw new Error(`Wallet debit failed: ${debitError.message}`);
  if (!debitedRows || debitedRows.length === 0) {
    return {
      ok: false,
      message: "The wallet balance changed while this payout was being prepared. No money has moved — please try again.",
    };
  }

  const { data: flipped, error: flipError } = await admin
    .from("payoneer_payouts")
    .update({ debit_state: "debited", updated_at: new Date().toISOString() })
    .eq("id", row.id)
    .eq("debit_state", "none")
    .select("id");
  if (flipError || !flipped || flipped.length === 0) {
    // The debit must not stand without its state flip: put the
    // money back (same optimistic guard), then report the failure.
    await admin
      .from("wallets")
      .update({ balance, updated_at: new Date().toISOString() })
      .eq("id", wallet.id)
      .eq("balance", balance - amount);
    if (flipError) throw new Error(`Payout debit could not be recorded: ${flipError.message}`);
    return {
      ok: false,
      message: "This payout changed while it was being prepared. No money has moved — please try again.",
    };
  }
  return { ok: true, newBalance: balance - amount, alreadyDebited: false };
}

/** Credit a wallet back by the payout amount (reversal leg). */
async function creditWalletForReversal(
  admin: AdminClient,
  row: PayoneerPayoutRow,
): Promise<void> {
  if (!row.wallet_id) throw new Error("Reversal has no wallet to credit");
  // Two attempts under the optimistic balance guard — a concurrent
  // balance change retries once with a fresh read before failing.
  for (let attempt = 0; attempt < 2; attempt++) {
    const wallet = await findWallet(admin, row.wallet_id);
    if (!wallet) throw new Error("Reversal wallet could not be found");
    const balance = Number(wallet.balance);
    const { data, error } = await admin
      .from("wallets")
      .update({
        balance: balance + Number(row.amount),
        updated_at: new Date().toISOString(),
      })
      .eq("id", wallet.id)
      .eq("balance", wallet.balance)
      .select("id");
    if (error) throw new Error(`Wallet credit-back failed: ${error.message}`);
    if (data && data.length > 0) return;
  }
  throw new Error("Wallet credit-back could not be applied");
}

// ── Provider-status application (status poll + webhook share this) ──

export interface ApplyProviderStatusResult {
  row: PayoneerPayoutRow;
  /** True when this call performed the wallet credit-back. */
  reversedDebit: boolean;
  /** True when the row's lifecycle status changed. */
  changed: boolean;
}

/**
 * Apply a RE-QUERIED provider status to a payout row. The pure
 * decideStatusTransition makes the call; this function performs it:
 *
 *   - Reversal path: ONE update flips status + debit_state
 *     ('debited' → 'reversed') guarded on the row's current status
 *     AND debit_state — only the caller that wins that update
 *     credits the wallet, exactly once. If the credit itself then
 *     fails, the flip is rolled back so a later poll/webhook can
 *     retry the reversal instead of the money being stranded.
 *   - Ordinary path: status/provider_status update guarded on the
 *     current status, so a stale poll never overwrites a newer
 *     terminal state.
 */
export async function applyProviderStatus(
  admin: AdminClient,
  row: PayoneerPayoutRow,
  providerStatusRaw: string | null,
): Promise<ApplyProviderStatusResult> {
  const mapped = mapProviderStatus(providerStatusRaw);
  const decision = decideStatusTransition(
    {
      status: row.status as PayoneerPayoutStatus,
      debit_state: row.debit_state as PayoneerDebitState,
    },
    mapped,
  );
  const providerStatus = providerStatusRaw ?? row.provider_status;

  if (decision.shouldReverseDebit) {
    const { data: claimed, error } = await admin
      .from("payoneer_payouts")
      .update({
        status: decision.next,
        provider_status: providerStatus,
        debit_state: "reversed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .eq("status", row.status)
      .eq("debit_state", "debited")
      .select("id");
    if (error) throw new Error(`Payout reversal failed: ${error.message}`);
    if (!claimed || claimed.length === 0) {
      // A racing caller already claimed the reversal (or the row
      // moved): this call credits nothing.
      const fresh = (await findPayoutById(admin, row.id)) ?? row;
      return { row: fresh, reversedDebit: false, changed: fresh.status !== row.status };
    }
    try {
      await creditWalletForReversal(admin, row);
    } catch (e) {
      // Roll the claim back so the reversal stays retryable.
      await admin
        .from("payoneer_payouts")
        .update({
          status: row.status,
          debit_state: "debited",
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id)
        .eq("debit_state", "reversed");
      throw e;
    }
    const fresh = (await findPayoutById(admin, row.id)) ?? row;
    return { row: fresh, reversedDebit: true, changed: fresh.status !== row.status };
  }

  if (decision.next !== row.status || providerStatus !== row.provider_status) {
    const { error } = await admin
      .from("payoneer_payouts")
      .update({
        status: decision.next,
        provider_status: providerStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .eq("status", row.status);
    if (error) throw new Error(`Payout status update failed: ${error.message}`);
  }
  const fresh = (await findPayoutById(admin, row.id)) ?? row;
  return { row: fresh, reversedDebit: false, changed: fresh.status !== row.status };
}

/**
 * Re-query the payment from Payoneer and settle the row from THAT
 * state — the only path by which provider truth moves a payout.
 * Shared by the refresh_status action and the webhook backstop.
 */
export async function refreshPayoutFromProvider(
  admin: AdminClient,
  fetchImpl: FetchLike,
  values: PayoneerEnvValues,
  row: PayoneerPayoutRow,
): Promise<
  | { kind: "no_provider_id"; row: PayoneerPayoutRow }
  | { kind: "refreshed"; row: PayoneerPayoutRow; reversedDebit: boolean }
> {
  if (!row.provider_payout_id) return { kind: "no_provider_id", row };
  const payload = await getPayoneerPayment(fetchImpl, values, row.provider_payout_id);
  const outcome = await applyProviderStatus(admin, row, extractProviderStatus(payload));
  return { kind: "refreshed", row: outcome.row, reversedDebit: outcome.reversedDebit };
}
