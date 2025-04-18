
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

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
    const { type } = await req.json();
    
    // In a real implementation, this would generate and store an actual API key
    // For demo purposes, we'll generate a mock key
    const prefix = type === 'live' ? 'bmp_live_' : 'bmp_test_';
    const randomKey = crypto.randomUUID().replace(/-/g, '').substring(0, 24);
    const lastFour = randomKey.slice(-4);
    
    return new Response(
      JSON.stringify({
        id: `${type}_${crypto.randomUUID()}`,
        prefix,
        lastFour,
        createdAt: new Date().toISOString(),
        type
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
