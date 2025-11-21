import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("[SCHEDULED-RECONCILIATION] Starting automated wallet reconciliation");

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    // Run reconciliation for all active wallets
    const { data: results, error } = await supabaseClient.rpc('reconcile_all_wallets');

    if (error) {
      console.error("[SCHEDULED-RECONCILIATION] Error:", error);
      throw error;
    }

    // Count discrepancies
    const discrepancies = results?.filter((r: any) => r.has_discrepancy) || [];
    const totalWallets = results?.length || 0;

    console.log(`[SCHEDULED-RECONCILIATION] Reconciled ${totalWallets} wallets`);
    console.log(`[SCHEDULED-RECONCILIATION] Found ${discrepancies.length} discrepancies`);

    // Send alerts for critical discrepancies
    for (const discrepancy of discrepancies) {
      if (Math.abs(discrepancy.difference) > 100) { // Alert for differences > 100
        await supabaseClient.from('notifications').insert({
          user_id: discrepancy.user_id,
          title: 'Wallet Balance Alert',
          message: `We detected a balance discrepancy of ${discrepancy.difference.toFixed(2)} in your wallet. Please review your transactions.`,
          type: 'security'
        });

        console.log(`[SCHEDULED-RECONCILIATION] Alert sent for wallet ${discrepancy.wallet_id}`);
      }
    }

    // Log reconciliation summary
    await supabaseClient.from('security_events').insert({
      event_type: 'scheduled_reconciliation_completed',
      event_data: {
        total_wallets: totalWallets,
        discrepancies_found: discrepancies.length,
        timestamp: new Date().toISOString(),
        critical_discrepancies: discrepancies.filter((d: any) => Math.abs(d.difference) > 100).length
      },
      risk_score: discrepancies.length > 0 ? 5 : 1
    });

    return new Response(
      JSON.stringify({ 
        success: true,
        summary: {
          total_wallets: totalWallets,
          discrepancies_found: discrepancies.length,
          critical_discrepancies: discrepancies.filter((d: any) => Math.abs(d.difference) > 100).length
        }
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[SCHEDULED-RECONCILIATION] Fatal error:", errorMessage);
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: "Reconciliation failed" 
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});