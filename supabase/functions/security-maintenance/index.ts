import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { getSupabaseClient } from "../_shared/supabase-client.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = getSupabaseClient(req);

    // Run comprehensive security maintenance
    const { error: maintenanceError } = await supabase.rpc('run_security_maintenance');
    
    if (maintenanceError) {
      console.error('Security maintenance error:', maintenanceError);
      throw maintenanceError;
    }

    // Additional security checks
    await supabase.rpc('enforce_session_security');

    // Log the maintenance completion
    console.log('Security maintenance completed successfully');

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Security maintenance completed',
        timestamp: new Date().toISOString()
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error) {
    console.error('Security maintenance failed:', error);
    
    return new Response(
      JSON.stringify({
        error: 'Security maintenance failed',
        details: error.message
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});