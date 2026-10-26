// payoneer-payouts: pay out from the platform's Payoneer Mass
// Payout account (brief §2) — admin / super_admin ONLY while the
// rail is being connected. There is no public path into it.
//
// The flow mirrors the proven PayPal payout rail, with Payoneer's
// debit ordering (brief §2.1: funds leave the Payoneer float at
// payment creation, so the internal wallet debit happens on API
// success):
//   0. PRE-FLIGHTS (audit P-2/P-3): before the row and before any
//      provider payment exists, the funding wallet is checked for
//      currency / active status / SUFFICIENT BALANCE, and the
//      platform's Payoneer float is read (best-effort) and checked
//      for the payout currency. A known insufficiency refuses
//      here — it is never discovered from a created payment.
//   1. The ledger row is persisted FIRST (status 'pending',
//      client_reference_id = its uuid_id — the idempotency anchor
//      Payoneer receives on the create).
//   2. The provider create runs. A refusal marks the row 'failed'
//      with the classified plain-language error and NO debit ever
//      happens.
//   3. On provider success, the wallet (when one is named) is
//      debited exactly as the PayPal rail debits — owner, currency
//      and active checks, insufficient-balance refusal with the
//      true balance. HONEST SEAM: if that debit fails, the provider
//      payment already exists. The row is marked 'failed' with the
//      plain error, the provider payment id stays on the row, and
//      the failure is logged loudly, so operations can cancel /
//      reconcile the payment at Payoneer — it is never silently
//      orphaned, and the debit is never faked.
//   4. Later provider truth (FAILED / REVERSED / RETURNED) credits
//      the wallet back exactly once via the guarded debit_state
//      flip in applyProviderStatus — driven by refresh_status here
//      and by the payoneer-webhook backstop.
//
// Gates, in order:
//   1. Authentication (caller resolved from their JWT).
//   2. Role: admin / super_admin only (canUsePayoneer).
//   3. EXCEPTION — action 'status' answers HERE, before the kill
//      switch and the config gate, so the admin console can always
//      show the rail's truthful state (configured? which env?
//      enabled? is the registration link set?).
//   4. Kill switch: platform_settings.payoneer_enabled = false
//      (the DEFAULT) disables the rail instantly → `disabled`, 503.
//   5. Configuration: the issued credential trio must exist
//      (PAYONEER_CLIENT_ID / PAYONEER_CLIENT_SECRET /
//      PAYONEER_PROGRAM_ID) → truthful `not_configured` BEFORE any
//      row is written or any debit attempted. Payoneer credentials
//      are issued at partner onboarding, never self-created
//      (brief §2.0) — absent means "still being connected".
//
// Actions (POST JSON { action, ... }):
//   status            {} — truthful rail state (gate exception)
//   create_payout     { payee_id, amount, currency, description?,
//                       wallet_id? }
//   refresh_status    { payout_id } — our uuid (id / uuid_id /
//                       client_reference_id all resolve)
//   registration_link {} — the hosted payee registration link
//
// Money movement runs through a dedicated service-role client that
// does NOT forward the caller's JWT (getServiceRoleClient): direct
// wallet updates under a user session would be neutralised by the
// protect_wallet_balance trigger.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getServiceRoleClient } from "../_shared/supabase-client.ts";
import {
  buildCreatePaymentBody,
  canUsePayoneer,
  checkWalletPreflight,
  classifyPayoneerError,
  extractProviderPayoutId,
  extractProviderStatus,
  mapProviderStatus,
  payoneerBalanceFor,
  payoneerConfig,
  PAYONEER_WEBHOOK_URL,
  validatePayoutInput,
  type PayoneerEnvValues,
} from "../_shared/payoneer.ts";
import {
  createPayoneerPayment,
  createPayoutRow,
  debitWalletForPayout,
  findPayout,
  getPayoneerBalances,
  markFailed,
  markSubmitted,
  refreshPayoutFromProvider,
  type FetchLike,
  type PayoneerPayoutRow,
} from "../_shared/payoneer-server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: unknown) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[PAYONEER-PAYOUTS] ${step}${detailsStr}`);
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const ADMIN_REFUSAL_MESSAGE =
  "Payoneer payouts are not available yet — this feature is being prepared and is currently open to administrators only.";

const NOT_CONFIGURED_MESSAGE =
  "Payoneer payouts aren't switched on yet — Payoneer is still being connected. No money has moved.";

const DISABLED_MESSAGE =
  "Payoneer payouts are switched off right now. No money has moved.";

function envValues(): PayoneerEnvValues {
  return {
    clientId: Deno.env.get("PAYONEER_CLIENT_ID") ?? null,
    clientSecret: Deno.env.get("PAYONEER_CLIENT_SECRET") ?? null,
    programId: Deno.env.get("PAYONEER_PROGRAM_ID") ?? null,
    env: Deno.env.get("PAYONEER_ENV") ?? null,
    registrationLink: Deno.env.get("PAYONEER_REGISTRATION_LINK") ?? null,
  };
}

const fetchImpl: FetchLike = (url, init) => fetch(url, init);

function payoutView(row: PayoneerPayoutRow) {
  return {
    id: row.id,
    uuid_id: row.uuid_id,
    payee_id: row.payee_id,
    amount: Number(row.amount),
    currency: row.currency,
    description: row.description,
    status: row.status,
    provider_payout_id: row.provider_payout_id,
    provider_status: row.provider_status,
    user_id: row.user_id,
    wallet_id: row.wallet_id,
    debit_state: row.debit_state,
    error: row.error,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Dedicated service-role client (no caller JWT forwarded) — the
  // money-path rule from _shared/supabase-client.ts.
  const supabase = getServiceRoleClient();

  try {
    logStep("Function started");

    // ── 1. Authentication ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ success: false, status: "unauthorized", error: "Please sign in to continue." }, 401);
    }
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    const user = userData?.user;
    if (userError || !user?.id) {
      return json({ success: false, status: "unauthorized", error: "Please sign in to continue." }, 401);
    }

    // ── 2. Role gate (admin-only rail) ──
    const { data: roleRows, error: roleError } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);
    if (roleError) throw new Error(`Role lookup failed: ${roleError.message}`);
    const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
    if (!canUsePayoneer(roles)) {
      return json({ success: false, status: "forbidden", error: ADMIN_REFUSAL_MESSAGE }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");
    const values = envValues();
    const config = payoneerConfig(values);

    // The kill-switch read (also what 'status' reports). A missing
    // row reads as disabled — the column's DEFAULT is false.
    const { data: settings } = await supabase
      .from("platform_settings")
      .select("payoneer_enabled")
      .eq("id", true)
      .maybeSingle();
    const enabled = settings?.payoneer_enabled === true;

    // ── 3. 'status' exception: truthful state BEFORE the gates ──
    if (action === "status") {
      // The platform float (audit P-3): read best-effort when the
      // rail is configured, so an admin can see payout sufficiency
      // BEFORE creating anything. A failed or unrecognised read
      // answers balances: null ("unknown") — the status action
      // itself must never fail because Payoneer is unreachable.
      let balances: Array<{ currency: string; available: number }> | null = null;
      if (config.configured) {
        try {
          balances = await getPayoneerBalances(fetchImpl, values);
        } catch (e) {
          logStep("Balances read failed — reporting unknown", {
            message: e instanceof Error ? e.message : String(e),
          });
          balances = null;
        }
      }
      return json({
        success: true,
        configured: config.configured,
        env: config.env,
        enabled,
        webhook_url: PAYONEER_WEBHOOK_URL,
        registration_link_configured: config.registrationLinkConfigured,
        balances,
      });
    }

    // ── 4. Kill switch ──
    if (!enabled) {
      return json({ success: false, status: "disabled", error: DISABLED_MESSAGE }, 503);
    }

    // ── 5. Configuration (before any row / debit) ──
    if (!config.configured) {
      logStep("Payoneer not configured");
      return json({ success: false, status: "not_configured", error: NOT_CONFIGURED_MESSAGE });
    }

    if (action === "create_payout") {
      return await handleCreatePayout(supabase, user.id, values, body);
    }
    if (action === "refresh_status") {
      return await handleRefreshStatus(supabase, values, body);
    }
    if (action === "registration_link") {
      if (!config.registrationLink) {
        return json({
          success: false,
          status: "not_configured",
          error: "The Payoneer registration link is issued with partner onboarding and is not configured yet.",
        });
      }
      return json({ success: true, registration_link: config.registrationLink });
    }
    return json({ success: false, status: "invalid", error: "Unknown action" }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logStep("ERROR in payoneer-payouts", { message });
    return json({
      success: false,
      status: "error",
      error: "Something went wrong with this payout. Check the payout's status before trying again, so it is not sent twice.",
    }, 500);
  }
});

// deno-lint-ignore no-explicit-any
async function handleCreatePayout(admin: any, callerId: string, values: PayoneerEnvValues, body: any) {
  // ── Server-side validation (the browser's values are a request) ──
  const validation = validatePayoutInput(body);
  if (!validation.ok) {
    return json({ success: false, status: "invalid", error: validation.message }, 400);
  }

  // ── Resolve the wallet, when one is named ──
  // The wallet determines the recorded owner (row.user_id = the
  // wallet's owner). The caller is an admin (gate 2) acting FOR
  // that owner — the platform-payout pattern — so ownership is
  // recorded from the wallet, never taken from the request body.
  const walletId = typeof body.wallet_id === "string" && body.wallet_id ? body.wallet_id : null;
  let ownerId: string | null = null;
  if (walletId) {
    const { data: wallet, error: walletError } = await admin
      .from("wallets")
      .select("id, user_id, currency, status, balance")
      .eq("id", walletId)
      .maybeSingle();
    if (walletError) throw new Error(`Wallet lookup failed: ${walletError.message}`);
    if (!wallet) {
      return json({ success: false, status: "not_found", error: "That wallet could not be found." }, 404);
    }
    // ── 0a. Wallet PRE-FLIGHT (audit P-2) ──
    // Currency, active status and sufficient balance are checked
    // NOW — before the ledger row and before any provider payment
    // can exist. The post-create debit used to be the first place
    // the balance was checked; Payoneer creates (and funds) the
    // payment first, so an insufficient wallet left a live
    // provider payment behind a row that said failed. The debit
    // later re-checks everything under its optimistic guard.
    const preflight = checkWalletPreflight(
      {
        currency: wallet.currency as string,
        status: wallet.status as string,
        balance: Number(wallet.balance),
      },
      validation.amount,
      validation.currency,
    );
    if (!preflight.ok) {
      return json({ success: false, status: "invalid", error: preflight.message }, 400);
    }
    ownerId = wallet.user_id as string;
  }

  // ── 1. Ledger row FIRST (client_reference_id = its uuid_id) ──
  const row = await createPayoutRow(admin, {
    payeeId: validation.payeeId,
    amount: validation.amount,
    currency: validation.currency,
    description: validation.description,
    userId: ownerId,
    walletId,
    createdBy: callerId,
    metadata: { gateway: "payoneer", env: payoneerConfig(values).env },
  });
  logStep("Payout row recorded", { payoutId: row.id, uuidId: row.uuid_id });

  // ── 1b. Float PRE-FLIGHT (audit P-3) ──
  // Read the platform's Payoneer float and refuse BEFORE the
  // create when it is KNOWN to be short for this currency. The
  // read is advisory: an unreachable provider or an unrecognised
  // balances shape answers "unknown" (null) and the create goes
  // ahead — its classified insufficient-funds error (P-4) remains
  // the backstop. No provider payment exists yet at this point,
  // so a refusal here strands nothing on either side.
  try {
    const balances = await getPayoneerBalances(fetchImpl, values);
    if (balances !== null) {
      const available = payoneerBalanceFor(balances, validation.currency);
      if (available === null || available < validation.amount) {
        const message =
          "The platform's Payoneer payout account does not have enough funds for this payout. No money has moved from your wallet.";
        const failed = await markFailed(admin, row, message);
        logStep("Float pre-flight refused the create", {
          payoutId: row.id,
          currency: validation.currency,
          available,
        });
        return json({ success: false, status: "failed", error: message, payout: payoutView(failed) }, 400);
      }
    }
  } catch (e) {
    logStep("Float pre-flight read failed — proceeding to create", {
      payoutId: row.id,
      message: e instanceof Error ? e.message : String(e),
    });
  }

  // ── 2. Provider create ──
  let payload: Record<string, unknown>;
  try {
    payload = await createPayoneerPayment(
      fetchImpl,
      values,
      buildCreatePaymentBody({
        payeeId: validation.payeeId,
        amount: validation.amount,
        currency: validation.currency,
        description: validation.description,
        clientReferenceId: row.uuid_id,
      }),
    );
  } catch (e) {
    // Provider refused (or was unreachable): row failed with the
    // classified plain-language error, and NO debit ever happens.
    const message = e instanceof Error ? e.message : classifyPayoneerError(0);
    const failed = await markFailed(admin, row, message);
    logStep("Provider create failed — no debit", { payoutId: row.id, message });
    return json({ success: false, status: "failed", error: message, payout: payoutView(failed) }, 502);
  }

  const providerPayoutId = extractProviderPayoutId(payload);
  const providerStatus = extractProviderStatus(payload);
  const mapped = mapProviderStatus(providerStatus);

  // Payoneer answered 2xx but already reports a failed/reversed
  // payment: nothing was paid out, so no debit — close the row.
  if (mapped === "failed" || mapped === "reversed") {
    const message = "Payoneer could not complete this payout. No money has moved from the wallet.";
    const failed = await markFailed(admin, row, message, {
      providerPayoutId,
      providerStatus,
    });
    return json({ success: false, status: "failed", error: message, payout: payoutView(failed) }, 400);
  }
  const targetStatus = mapped ?? "submitted";

  // ── 3. Debit on API success (when a wallet funds the payout) ──
  let debitState: "debited" | "none" = "none";
  if (walletId) {
    const debit = await debitWalletForPayout(admin, row);
    if (!debit.ok) {
      // The provider payment EXISTS but the internal debit failed.
      // Mark the row failed with the plain reason, keep the
      // provider id on it, and log loudly: operations must cancel /
      // reconcile this payment at Payoneer (client_reference_id =
      // the row's uuid_id finds it). Never fake the debit.
      const failed = await markFailed(admin, row, debit.message, {
        providerPayoutId,
        providerStatus,
      });
      console.error(
        "[PAYONEER-PAYOUTS] PROVIDER PAYMENT WITHOUT WALLET DEBIT — needs ops reconciliation:",
        JSON.stringify({
          payoutId: row.id,
          clientReferenceId: row.uuid_id,
          providerPayoutId,
          reason: debit.message,
        }),
      );
      return json({ success: false, status: "failed", error: debit.message, payout: payoutView(failed) }, 400);
    }
    debitState = "debited";
    logStep("Wallet debited", { payoutId: row.id, walletId, newBalance: debit.newBalance });
  }

  // ── 4. Record the provider answer on the row ──
  const submitted = await markSubmitted(admin, row, {
    status: targetStatus,
    providerPayoutId,
    providerStatus,
    debitState,
  });
  logStep("Payout submitted", {
    payoutId: row.id,
    providerPayoutId,
    status: submitted.status,
  });
  return json({
    success: true,
    status: submitted.status,
    payout: payoutView(submitted),
    message: submitted.status === "completed"
      ? "Payoneer has completed this payout."
      : "Payout submitted to Payoneer. It completes when Payoneer confirms it — track it with refresh_status.",
  });
}

// deno-lint-ignore no-explicit-any
async function handleRefreshStatus(admin: any, values: PayoneerEnvValues, body: any) {
  const payoutId = typeof body.payout_id === "string" ? body.payout_id : "";
  if (!payoutId) {
    return json({ success: false, status: "invalid", error: "payout_id is required" }, 400);
  }
  const row = await findPayout(admin, payoutId);
  if (!row) {
    return json({ success: false, status: "not_found", error: "Payout not found" }, 404);
  }
  try {
    const outcome = await refreshPayoutFromProvider(admin, fetchImpl, values, row);
    return json({
      success: true,
      status: outcome.row.status,
      payout: payoutView(outcome.row),
      reachable: true,
    });
  } catch (e) {
    // Re-query failed: the row keeps its current state and the
    // caller hears the classified plain-language reason.
    const message = e instanceof Error ? e.message : classifyPayoneerError(0);
    return json({
      success: false,
      status: row.status,
      error: message,
      payout: payoutView(row),
      reachable: false,
    }, 502);
  }
}
