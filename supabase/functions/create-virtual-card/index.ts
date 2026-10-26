
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  currentTimestamp,
  generateNonce,
  signMastercardRequest,
} from "../_shared/mastercard-oauth.ts";
import {
  cardVaultKeyFromEnv,
  encryptCardDetails,
  type VaultEnvelope,
} from "../_shared/card-vault.ts";
import {
  PROCESSING_NOT_CONFIGURED_MESSAGE,
  accountsUrl,
  buildCreateAccountBody,
  buildCreateCardBody,
  buildCreateClientBody,
  cardContractIdFrom,
  cardContractUrl,
  cardExpiryFrom,
  cardNumberFrom,
  cardsUrl,
  classifyProviderRefusal,
  clientIdFrom,
  clientsUrl,
  craftedProcessingError,
  deriveAccountContractNumber,
  deriveClientNumber,
  expiryDateFromYymm,
  expiryDisplayFromYymm,
  idFromLocationHeader,
  isProcessingConfigured,
  maskPan,
  providerReasonCode,
  redactSensitive,
  resolveAccountProductCode,
  resolveCardProductCode,
  resolveClientType,
  accountContractIdFrom,
  type MastercardProcessingConfig,
} from "../_shared/mastercard-processing.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[CREATE-VIRTUAL-CARD] ${step}${detailsStr}`);
};

// ── Mastercard Processing provider path ───────────────────────────
// When MASTERCARD_ENV is set, a mastercard card is issued through
// Mastercard Processing (gateway brief §1.1) instead of the local
// number generator: CMS client → account contract → card contract
// via the shared client logic in _shared/mastercard-processing.ts
// (the same code the mastercard-processing edge function runs),
// signed with the portal project's OAuth key.
//
// Honesty rules:
//   * A provider refusal is surfaced truthfully (crafted message +
//     refusal class + ReasonCode) and NO local card is minted in
//     its place — presenting a locally generated number as a
//     Mastercard-issued card is exactly what this layer prevents.
//   * The CMS-generated PAN is revealed in this response and is
//     never logged; the row keeps the masked number, the provider
//     contract ids (migration 20261107) and — since the card vault
//     (migration 20261116) — an AES-GCM envelope of the PAN under a
//     key held only as an edge-function secret, so the owner can
//     view it again via manage-virtual-card after re-auth.
//   * The CMS returns no CVV at issuance, so none is claimed.
// When MASTERCARD_ENV is not set, the local interim path below runs
// exactly as before.
function processingConfig(): MastercardProcessingConfig {
  return {
    env: Deno.env.get("MASTERCARD_ENV") === "production" ? "production" : "sandbox",
    consumerKey: Deno.env.get("MASTERCARD_CONSUMER_KEY") ?? null,
    signingKeyPem: Deno.env.get("MASTERCARD_SIGNING_KEY_PEM") ?? null,
    clientType: Deno.env.get("MC_PROCESSING_CLIENT_TYPE") ?? null,
    accountProductCode: Deno.env.get("MC_PROCESSING_ACCOUNT_PRODUCT_CODE") ?? null,
    cardProductCode: Deno.env.get("MC_PROCESSING_CARD_PRODUCT_CODE") ?? null,
  };
}

interface ProcessingCallResult {
  httpStatus: number;
  payload: Record<string, unknown> | null;
  location: string | null;
}

async function processingCall(
  config: MastercardProcessingConfig,
  method: string,
  url: string,
  bodyObject: Record<string, unknown> | null,
): Promise<ProcessingCallResult> {
  const body = bodyObject ? JSON.stringify(bodyObject) : "";
  const authorization = await signMastercardRequest(
    method,
    url,
    {
      consumerKey: config.consumerKey ?? "",
      body,
      nonce: generateNonce(),
      timestamp: currentTimestamp(),
    },
    config.signingKeyPem ?? "",
  );
  const response = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: authorization,
    },
    body: method === "GET" ? undefined : body,
  });
  const text = await response.text();
  let payload: Record<string, unknown> | null = null;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      payload = parsed as Record<string, unknown>;
    }
  } catch {
    payload = null;
  }
  return { httpStatus: response.status, payload, location: response.headers.get("Location") };
}

function processingFailure(result: ProcessingCallResult, status = 502): Response {
  logStep("Mastercard Processing refused the request", {
    httpStatus: result.httpStatus,
    refusalClass: classifyProviderRefusal(result.httpStatus, result.payload),
    reasonCode: providerReasonCode(result.payload),
    payload: redactSensitive(result.payload),
  });
  return new Response(
    JSON.stringify({
      success: false,
      error: craftedProcessingError(result.httpStatus, result.payload),
      provider_http_status: result.httpStatus,
      refusal_class: classifyProviderRefusal(result.httpStatus, result.payload),
      reason_code: providerReasonCode(result.payload),
    }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

async function createCardViaProcessing(args: {
  supabaseClient: any;
  userId: string;
  name: string;
  cardType: string;
  cardWallet: { id: string; currency: string };
  dailyLimit?: number;
  monthlyLimit?: number;
  transactionLimit?: number;
  allowOnline?: boolean;
  allowInternational?: boolean;
}): Promise<Response> {
  const { supabaseClient, userId } = args;
  const config = processingConfig();
  if (!isProcessingConfigured(config)) {
    return new Response(
      JSON.stringify({ success: false, error: PROCESSING_NOT_CONFIGURED_MESSAGE }),
      { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Cardholder names for the CMS: the caller's profile first (the
  // admin creates cards for their own account in this flow), then
  // the card name's tokens.
  const { data: profile } = await supabaseClient
    .from("profiles")
    .select("first_name, last_name")
    .eq("id", userId)
    .maybeSingle();
  const nameTokens = args.name.trim().split(/\s+/).filter(Boolean);
  const firstName = profile?.first_name || nameTokens[0] || "Virtual";
  const lastName = profile?.last_name || nameTokens.slice(1).join(" ") || "Card";

  // The documented sandbox products are EUR-denominated
  // (STD-DEBCH-EUR / STD-MCDEBVF-EUR); the CMS account/card currency
  // follows the environment. The platform row keeps its own ZMW
  // currency — funding stays in the platform ledger either way.
  const cmsCurrency = config.env === "sandbox" ? "EUR" : args.cardWallet.currency;

  // 1) CMS client — one per platform user, reused across their
  //    cards (the CMS refuses a duplicate clientNumber).
  let providerClientId: string | null = null;
  const { data: priorCard } = await supabaseClient
    .from("virtual_cards")
    .select("provider_client_id")
    .eq("user_id", userId)
    .not("provider_client_id", "is", null)
    .limit(1)
    .maybeSingle();
  if (priorCard?.provider_client_id) {
    providerClientId = priorCard.provider_client_id as string;
  } else {
    const clientResult = await processingCall(config, "POST", clientsUrl(config), buildCreateClientBody({
      clientNumber: deriveClientNumber(userId),
      clientType: resolveClientType(config) as string,
      firstName,
      lastName,
    }));
    if (clientResult.httpStatus < 200 || clientResult.httpStatus >= 300) {
      return processingFailure(clientResult);
    }
    providerClientId = clientIdFrom(clientResult.payload)
      ?? idFromLocationHeader(clientResult.location, "clients");
    if (!providerClientId) {
      return new Response(
        JSON.stringify({ success: false, error: "Mastercard created the cardholder record but did not return its reference. No card was created — please let an administrator know." }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
  }

  // 2) CMS account contract — one per issued card.
  const accountResult = await processingCall(config, "POST", accountsUrl(config), buildCreateAccountBody({
    accountContractNumber: deriveAccountContractNumber(crypto.randomUUID()),
    clientId: providerClientId,
    productCode: resolveAccountProductCode(config) as string,
    currency: cmsCurrency,
  }));
  if (accountResult.httpStatus < 200 || accountResult.httpStatus >= 300) {
    return processingFailure(accountResult);
  }
  const providerAccountId = accountContractIdFrom(accountResult.payload)
    ?? idFromLocationHeader(accountResult.location, "accounts");
  if (!providerAccountId) {
    return new Response(
      JSON.stringify({ success: false, error: "Mastercard created the account but did not return its reference. No card was created — please let an administrator know." }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // 3) CMS card contract — the CMS generates the PAN from the BIN
  //    range configured for the card productCode.
  const cardResult = await processingCall(config, "POST", cardsUrl(config), buildCreateCardBody({
    accountContractId: providerAccountId,
    clientId: providerClientId,
    productCode: resolveCardProductCode(config) as string,
    currency: cmsCurrency,
    firstName,
    lastName,
  }));
  if (cardResult.httpStatus < 200 || cardResult.httpStatus >= 300) {
    return processingFailure(cardResult);
  }
  const providerCardId = cardContractIdFrom(cardResult.payload)
    ?? idFromLocationHeader(cardResult.location, "cards");
  if (!providerCardId) {
    return new Response(
      JSON.stringify({ success: false, error: "Mastercard created the card but did not return its reference. Please let an administrator know before trying again." }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // 4) Read the card contract back: it carries the CMS-generated
  //    number + expiry (cardContractNumber is a required field of
  //    the contract in the reference). No number → we cannot record
  //    the card honestly, so the issuance is reported as failed
  //    WITH the provider reference for reconciliation.
  let pan: string | null = null;
  let expiryRaw: string | null = null;
  try {
    const details = await processingCall(config, "GET", cardContractUrl(config, providerCardId), null);
    if (details.httpStatus >= 200 && details.httpStatus < 300) {
      pan = cardNumberFrom(details.payload);
      expiryRaw = cardExpiryFrom(details.payload);
    }
  } catch {
    pan = null;
  }
  if (!pan) {
    logStep("Processing card issued but number unreadable", { providerCardId });
    return new Response(
      JSON.stringify({
        success: false,
        error: "Mastercard issued the card but its details could not be read back, so it has not been added here. An administrator can reconcile it in Mastercard Processing.",
        provider_card_id: providerCardId,
      }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Vault the CMS-issued PAN so the owner can view it again later
  // through manage-virtual-card's re-auth reveal. The CMS returns
  // no CVV at issuance, so the envelope's cvv stays null and none
  // is ever claimed. When the vault key is not configured the card
  // is still recorded masked-only (the pre-vault behaviour).
  const processingVaultKey = cardVaultKeyFromEnv();
  const processingEnvelope: VaultEnvelope | null = processingVaultKey
    ? await encryptCardDetails({ pan, cvv: null }, processingVaultKey)
    : null;

  const masked = await supabaseClient.rpc("mask_card_number", { card_number: pan });
  const maskedNumber = (masked.data as string | null) ?? maskPan(pan);
  const expiryDate = expiryDateFromYymm(expiryRaw) ?? (() => {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear() + 3, now.getUTCMonth() + 1, 0))
      .toISOString()
      .slice(0, 10);
  })();
  const expiry = expiryDisplayFromYymm(expiryRaw) ?? (() => {
    const d = new Date(expiryDate + "T00:00:00Z");
    return `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCFullYear()).slice(-2)}`;
  })();

  const { data: newCard, error: createError } = await supabaseClient
    .from("virtual_cards")
    .insert({
      user_id: userId,
      wallet_id: args.cardWallet.id,
      name: args.name,
      masked_number: maskedNumber,
      expiry_date: expiryDate,
      balance: 0,
      currency: args.cardWallet.currency,
      status: "active",
      provider: "mastercard",
      card_type: args.cardType,
      daily_limit: args.dailyLimit,
      monthly_limit: args.monthlyLimit,
      transaction_limit: args.transactionLimit,
      online_transactions: args.allowOnline,
      international_transactions: args.allowInternational,
      provider_client_id: providerClientId,
      provider_account_id: providerAccountId,
      provider_card_id: providerCardId,
      ...(processingEnvelope
        ? {
            details_ciphertext: processingEnvelope.ciphertext,
            details_iv: processingEnvelope.iv,
            vault_key_version: processingEnvelope.keyVersion,
          }
        : {}),
    })
    .select()
    .single();
  if (createError) {
    logStep("Error recording Processing card", { message: createError.message, providerCardId });
    throw new Error(`Failed to create virtual card: ${createError.message}`);
  }

  logStep("Virtual card created via Mastercard Processing", { cardId: newCard.id, providerCardId });

  return new Response(
    JSON.stringify({
      success: true,
      issuance: "mastercard_processing",
      card: {
        id: newCard.id,
        name: newCard.name,
        masked_number: newCard.masked_number,
        status: newCard.status,
        provider: newCard.provider,
        balance: newCard.balance,
        created_at: newCard.created_at,
        provider_client_id: providerClientId,
        provider_account_id: providerAccountId,
        provider_card_id: providerCardId,
        // One-time reveal — the CMS-generated number only; the CMS
        // returns no CVV at issuance, so none is claimed.
        card_number: pan,
        cvv: null,
        expiry_date: expiryDate,
        expiry: expiry,
      },
    }),
    {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    },
  );
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header provided");

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError) throw new Error(`Authentication error: ${userError.message}`);
    
    const user = userData.user;
    if (!user?.id) throw new Error("User not authenticated");
    logStep("User authenticated", { userId: user.id });

    // Virtual cards are "Coming soon" for the public (CEO decision,
    // 2026-10-22): card creation stays admin-only until the Mastercard
    // developer-platform integration is built and tested. The pages
    // show a Coming Soon panel to everyone else; this is the same
    // rule enforced server-side so the function cannot be invoked
    // directly to bypass it.
    const { data: adminRole } = await supabaseClient
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (!adminRole) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Virtual cards are coming soon — they're not available yet.",
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const requestBody = await req.json();
    
    // Validate input using schema
    const schema = {
      name: requestBody.name,
      provider: requestBody.provider || 'mastercard',
      cardType: requestBody.cardType || 'debit',
      dailyLimit: requestBody.dailyLimit,
      monthlyLimit: requestBody.monthlyLimit,
    };
    
    // Basic validation
    if (!schema.name || schema.name.length > 50 || !/^[a-zA-Z0-9\s-]+$/.test(schema.name)) {
      throw new Error("Invalid card name");
    }
    
    if (!['visa', 'mastercard', 'amex'].includes(schema.provider)) {
      throw new Error("Invalid provider");
    }
    
    if (!['debit', 'prepaid'].includes(schema.cardType)) {
      throw new Error("Invalid card type");
    }
    
    const { name, provider, cardType, dailyLimit, monthlyLimit, transactionLimit, allowOnline, allowInternational } = requestBody;

    // ── Resolve the wallet this card binds to ──
    // Live schema: public.virtual_cards.wallet_id is NOT NULL with an
    // FK to wallets. A card binds to the caller's Main wallet
    // (account_id IS NULL) in the card's currency — the same
    // deterministic resolution wallet-deposit uses. Cards are
    // ZMW-denominated across the platform (fund-virtual-card writes
    // 'ZMW', the card pages price in K) and the creation request
    // carries no currency, so the card currency is ZMW; the Main ZMW
    // wallet is created on demand if the caller has none yet.
    const CARD_CURRENCY = "ZMW";
    let { data: cardWallet } = await supabaseClient
      .from("wallets")
      .select("id, currency, status")
      .eq("user_id", user.id)
      .eq("currency", CARD_CURRENCY)
      .is("account_id", null)
      .maybeSingle();
    if (!cardWallet) {
      const { data: createdWallet, error: walletCreateError } = await supabaseClient
        .from("wallets")
        .insert({ user_id: user.id, balance: 0, currency: CARD_CURRENCY, status: "active" })
        .select("id, currency, status")
        .single();
      if (walletCreateError) {
        logStep("Error creating wallet for card", walletCreateError);
        throw new Error("Failed to resolve wallet for card");
      }
      cardWallet = createdWallet;
    }
    if (cardWallet.status !== "active") {
      throw new Error("Wallet is not active");
    }

    // Mastercard Processing provider path: when MASTERCARD_ENV is
    // set, mastercard cards are issued by the CMS via
    // createCardViaProcessing — a provider refusal returns from
    // there truthfully and never falls through to local generation.
    if (Deno.env.get("MASTERCARD_ENV") && schema.provider === "mastercard") {
      return await createCardViaProcessing({
        supabaseClient,
        userId: user.id,
        name,
        cardType,
        cardWallet,
        dailyLimit,
        monthlyLimit,
        transactionLimit,
        allowOnline,
        allowInternational,
      });
    }

    // Generate card details
    const { data: cardNumberData, error: cardNumberError } = await supabaseClient
      .rpc('generate_card_number');
    
    if (cardNumberError) {
      logStep("Error generating card number", cardNumberError);
      throw new Error("Failed to generate card number");
    }

    const cardNumber = cardNumberData;
    const maskedNumber = await supabaseClient
      .rpc('mask_card_number', { card_number: cardNumber });

    // Generate CVV and expiry. The CVV is revealed in this
    // function's creation response below and is NEVER logged and
    // NEVER stored in plaintext (audit CVV hygiene): the live
    // virtual_cards table has no cvv or card_number column —
    // verified against information_schema 2026-10-23. Since the
    // card vault (migration 20261116), the PAN+CVV pair is ALSO
    // stored as an AES-256-GCM envelope whose key exists only as
    // the CARD_VAULT_KEY edge-function secret, so the owner can
    // view the details again later through manage-virtual-card
    // after password re-auth. Without a configured vault key the
    // card falls back to the pre-vault behaviour: reveal once at
    // creation, masked number + expiry only in the row.
    const cvv = Math.floor(Math.random() * 900 + 100).toString();
    const vaultKey = cardVaultKeyFromEnv();
    const envelope: VaultEnvelope | null = vaultKey
      ? await encryptCardDetails({ pan: cardNumber, cvv }, vaultKey)
      : null;
    // Live expiry_date is a DATE: 3 years out, last day of that month.
    const now = new Date();
    const expiryYear = now.getUTCFullYear() + 3;
    const expiryMonth = now.getUTCMonth(); // 0-based
    const expiryDate = new Date(Date.UTC(expiryYear, expiryMonth + 1, 0))
      .toISOString()
      .slice(0, 10); // YYYY-MM-DD
    const expiry = `${String(expiryMonth + 1).padStart(2, "0")}/${String(expiryYear).slice(-2)}`;

    logStep("Generated card details", { cardNumber: maskedNumber.data });

    // Create virtual card in database — exactly the live columns
    // (verified 2026-10-23): no card_number, no cvv; wallet_id,
    // balance, currency and status are NOT NULL live, so they are
    // set explicitly rather than relying on defaults.
    const { data: newCard, error: createError } = await supabaseClient
      .from('virtual_cards')
      .insert({
        user_id: user.id,
        wallet_id: cardWallet.id,
        name: name,
        masked_number: maskedNumber.data,
        expiry_date: expiryDate,
        balance: 0,
        currency: cardWallet.currency,
        status: 'active',
        provider: provider,
        card_type: cardType,
        daily_limit: dailyLimit,
        monthly_limit: monthlyLimit,
        transaction_limit: transactionLimit,
        online_transactions: allowOnline,
        international_transactions: allowInternational,
        ...(envelope
          ? {
              details_ciphertext: envelope.ciphertext,
              details_iv: envelope.iv,
              vault_key_version: envelope.keyVersion,
            }
          : {}),
      })
      .select()
      .single();

    if (createError) {
      logStep("Error creating card", createError);
      throw new Error(`Failed to create virtual card: ${createError.message}`);
    }

    logStep("Virtual card created successfully", { cardId: newCard.id });

    return new Response(JSON.stringify({
      success: true,
      issuance: "local",
      card: {
        id: newCard.id,
        name: newCard.name,
        masked_number: newCard.masked_number,
        status: newCard.status,
        provider: newCard.provider,
        balance: newCard.balance,
        created_at: newCard.created_at,
        // Creation reveal: the full number, CVV and expiry are
        // returned here, in the creation response to the
        // authenticated owner. Neither secret is stored in plaintext
        // anywhere (the live table has no column for them); when the
        // vault is configured they are kept only as an encrypted
        // envelope and can be shown again via manage-virtual-card
        // after the owner re-enters their password.
        card_number: cardNumber,
        cvv: cvv,
        expiry_date: expiryDate,
        expiry: expiry
      }
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR in create-virtual-card", { message: errorMessage });
    
    // Return generic error to user, log details server-side
    const userError = error instanceof Error && error.message.includes("Invalid") 
      ? error.message 
      : "Failed to create virtual card";
    
    return new Response(JSON.stringify({ 
      success: false, 
      error: userError
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: error instanceof Error && error.message.includes("Invalid") ? 400 : 500,
    });
  }
});
