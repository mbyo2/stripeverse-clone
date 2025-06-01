
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { encode as base32Encode } from "https://deno.land/std@0.168.0/encoding/base32.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    // Get the authorization header from the request
    const authHeader = req.headers.get('Authorization')!
    
    // Get the JWT payload
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(
      authHeader.replace('Bearer ', '')
    )
    
    if (userError || !user) {
      throw new Error('Unauthorized')
    }

    const { userId } = await req.json()

    if (user.id !== userId) {
      throw new Error('Unauthorized')
    }

    // Generate a random secret (20 bytes = 160 bits)
    const secret = crypto.getRandomValues(new Uint8Array(20))
    const base32Secret = base32Encode(secret).replace(/=/g, '')

    // Create TOTP URI for QR code
    const issuer = 'BMaGlass Pay'
    const accountName = user.email || user.id
    const otpAuthUrl = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}?secret=${base32Secret}&issuer=${encodeURIComponent(issuer)}`

    // Store the secret in the database (not enabled yet)
    const { error: insertError } = await supabaseClient
      .from('two_factor_auth')
      .upsert({
        user_id: userId,
        secret: base32Secret,
        enabled: false
      })

    if (insertError) {
      throw insertError
    }

    return new Response(
      JSON.stringify({
        secret: base32Secret,
        qrCode: otpAuthUrl
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      },
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      },
    )
  }
})
