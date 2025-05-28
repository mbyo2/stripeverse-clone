
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

    const requestBody = await req.json();
    const { name, provider, cardType, dailyLimit, monthlyLimit, transactionLimit, allowOnline, allowInternational } = requestBody;

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

    // Generate CVV and expiry
    const cvv = Math.floor(Math.random() * 900 + 100).toString();
    const expiryDate = new Date();
    expiryDate.setFullYear(expiryDate.getFullYear() + 3);
    const expiry = `${(expiryDate.getMonth() + 1).toString().padStart(2, '0')}/${expiryDate.getFullYear().toString().slice(-2)}`;

    logStep("Generated card details", { cardNumber: maskedNumber.data, cvv, expiry });

    // Create virtual card in database
    const { data: newCard, error: createError } = await supabaseClient
      .from('virtual_cards')
      .insert({
        user_id: user.id,
        name: name,
        card_number: cardNumber,
        masked_number: maskedNumber.data,
        cvv: cvv,
        expiry_date: expiry,
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
        created_at: newCard.created_at
      }
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR in create-virtual-card", { message: errorMessage });
    
    return new Response(JSON.stringify({ 
      success: false, 
      error: errorMessage 
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
