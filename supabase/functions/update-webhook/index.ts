
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4'
import { requireAuth } from '../_shared/auth.ts'

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
    const auth = await requireAuth(req, corsHeaders)
    if ('response' in auth) return auth.response
    const { user } = auth

    const { url, events, business_id } = await req.json();
    
    // URL validation — must be https and not private/loopback
    let parsed: URL
    try { parsed = new URL(url) } catch { throw new Error('Invalid webhook URL') }
    if (parsed.protocol !== 'https:') throw new Error('Webhook URL must use HTTPS')
    const host = parsed.hostname.toLowerCase()
    if (
      host === 'localhost' || host === '127.0.0.1' || host === '::1' ||
      host.endsWith('.local') || /^10\./.test(host) || /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    ) throw new Error('Webhook URL host not allowed')

    // Create Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // If a business/merchant id was supplied, verify the caller owns it
    if (business_id) {
      const { data: owned, error: ownErr } = await supabaseClient
        .from('merchant_accounts')
        .select('id')
        .eq('id', business_id)
        .eq('user_id', user.id)
        .maybeSingle()
      if (ownErr || !owned) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }

    console.log('Updating webhook for user:', user.id);

    // Accept either a boolean event map or an array of event names;
    // the webhooks.events column stores an array of event names.
    const eventNames = events && typeof events === 'object' && !Array.isArray(events)
      ? Object.entries(events as Record<string, unknown>)
          .filter(([, enabled]) => Boolean(enabled))
          .map(([event]) => event)
      : Array.isArray(events)
        ? events.map(String)
        : []

    // Webhook rows are keyed by the authenticated user (webhooks.user_id is UNIQUE)
    const { data, error } = await supabaseClient
      .from('webhooks')
      .upsert(
        {
          user_id: user.id,
          url,
          events: eventNames,
          updated_at: new Date().toISOString()
        },
        {
          onConflict: 'user_id'
        }
      );

    if (error) {
      console.error('Database error when updating webhook:', error);
      throw error;
    }

    console.log('Webhook configuration updated successfully:', { user_id: user.id, url });
    
    return new Response(
      JSON.stringify({ success: true, data }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('Error updating webhook:', error);
    return new Response(
      JSON.stringify({ error: 'Operation failed' }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
