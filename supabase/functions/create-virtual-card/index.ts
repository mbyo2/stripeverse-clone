
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[CREATE-VIRTUAL-CARD] ${step}${detailsStr}`);
};

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

    // Generate CVV and expiry. The CVV is revealed ONCE, in this
    // function's creation response below, and is NEVER logged and
    // NEVER persisted (audit CVV hygiene): the live virtual_cards
    // table has no cvv column (and no card_number column) at all —
    // verified against information_schema 2026-10-23 — so there is
    // nowhere to store either secret. Only the masked number and
    // expiry are written down.
    const cvv = Math.floor(Math.random() * 900 + 100).toString();
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
      card: {
        id: newCard.id,
        name: newCard.name,
        masked_number: newCard.masked_number,
        status: newCard.status,
        provider: newCard.provider,
        balance: newCard.balance,
        created_at: newCard.created_at,
        // One-time reveal: the full number, CVV and expiry are
        // returned ONLY here, in the creation response to the
        // authenticated owner. Neither the number nor the CVV is
        // stored anywhere (the live table has no column for them),
        // so once this response is gone they cannot be shown again.
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
