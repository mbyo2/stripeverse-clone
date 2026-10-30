import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { getSupabaseClient } from "../_shared/supabase-client.ts"
import { requireAdmin, requireCronSecret } from "../_shared/auth.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Allow either an admin JWT or a valid CRON_SECRET for scheduled runs
    if (req.headers.get('x-cron-secret')) {
      const cronErr = requireCronSecret(req, corsHeaders)
      if (cronErr) return cronErr
    } else {
      const auth = await requireAdmin(req, corsHeaders)
      if ('response' in auth && !('user' in auth)) return auth.response
    }

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
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});