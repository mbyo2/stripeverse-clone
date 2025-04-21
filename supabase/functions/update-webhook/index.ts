
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4'

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
    const { url, events, business_id } = await req.json();
    
    // Basic URL validation
    try {
      new URL(url);
    } catch {
      throw new Error('Invalid webhook URL');
    }

    // Create Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log('Updating webhook for business ID:', business_id);

    // Insert or update webhook configuration
    const { data, error } = await supabaseClient
      .from('webhooks')
      .upsert(
        {
          business_id,
          url,
          events,
          updated_at: new Date().toISOString()
        },
        {
          onConflict: 'business_id'
        }
      );

    if (error) {
      console.error('Database error when updating webhook:', error);
      throw error;
    }

    console.log('Webhook configuration updated successfully:', { business_id, url });
    
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
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
