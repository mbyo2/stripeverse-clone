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
    const { cardId, accessType } = await req.json();

    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      throw new Error('Unauthorized');
    }

    // Get client IP from headers (in production)
    const clientIP = req.headers.get('x-forwarded-for') || 
                    req.headers.get('x-real-ip') || 
                    'unknown';
    
    const userAgent = req.headers.get('user-agent') || 'unknown';

    // Validate card access using enhanced security function
    const { data: accessGranted, error: validationError } = await supabase.rpc(
      'log_card_access_attempt',
      {
        p_user_id: user.id,
        p_card_id: cardId,
        p_access_type: accessType,
        p_ip_address: clientIP,
        p_user_agent: userAgent
      }
    );

    if (validationError) {
      console.error('Card access validation error:', validationError);
      throw validationError;
    }

    if (!accessGranted) {
      return new Response(
        JSON.stringify({
          success: false,
          message: 'Access denied - rate limited or unauthorized',
          cardId
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 403,
        }
      );
    }

    // If access is granted, return success
    return new Response(
      JSON.stringify({
        success: true,
        message: 'Card access logged and validated',
        cardId,
        timestamp: new Date().toISOString()
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error) {
    console.error('Card access validation failed:', error);
    
    return new Response(
      JSON.stringify({
        error: 'Card access validation failed',
        details: error.message
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});