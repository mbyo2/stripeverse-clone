import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { getSupabaseClient, getServiceRoleClient } from "../_shared/supabase-client.ts"

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
    const { cardId, accessType: rawAccessType } = await req.json();

    // Get the authenticated user. The token is passed explicitly: a
    // bare getUser() ignores the Authorization header on pinned
    // supabase-js versions.
    const authToken = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
    const { data: { user }, error: authError } = await supabase.auth.getUser(authToken);
    
    // Unauthenticated callers get 401, not the generic 500 below: throwing
    // here used to mask "no/invalid token" as a server error (workstream A).
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 401,
        }
      );
    }

    // Get client IP from headers (in production). Only a syntactically
    // valid IP is forwarded: log_card_access_attempt takes p_ip_address as
    // inet, and 'unknown' (or a multi-value X-Forwarded-For) would fail
    // the cast and 500 the whole check (workstream A).
    const rawIP = (req.headers.get('x-forwarded-for') || '')
      .split(',')[0].trim() || req.headers.get('x-real-ip') || '';
    const clientIP = /^(?:\d{1,3}\.){3}\d{1,3}$/.test(rawIP) || rawIP.includes(':')
      ? rawIP
      : null;

    const userAgent = req.headers.get('user-agent') || 'unknown';

    // accessType defaults: log_card_access_attempt has NO default for
    // p_access_type, and supabase-js drops undefined keys, so an omitted
    // accessType made PostgREST reject the RPC call (workstream A).
    const accessType = typeof rawAccessType === 'string' && rawAccessType ? rawAccessType : 'view';

    // Validate card access using enhanced security function.
    // log_card_access_attempt is EXECUTE-granted to service_role only
    // (workstream A, 2026-11-15: the user-scoped client forwards the
    // caller's JWT, so PostgREST denied the call with 42501 for EVERY
    // user and this control never ran -- every call 500'd). The user id
    // below comes from the verified JWT, never from the request body,
    // so the service-role client cannot be confused into logging
    // access for someone else.
    const service = getServiceRoleClient();
    const { data: accessGranted, error: validationError } = await service.rpc(
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
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});