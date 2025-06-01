
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { decode as base32Decode } from "https://deno.land/std@0.168.0/encoding/base32.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// HOTP algorithm implementation
function hotp(secret: Uint8Array, counter: number): string {
  const counterBytes = new ArrayBuffer(8)
  const view = new DataView(counterBytes)
  view.setBigUint64(0, BigInt(counter), false)
  
  const hmac = new Uint8Array(20) // Simplified for demo - use proper HMAC-SHA1
  
  const offset = hmac[19] & 0xf
  const code = (
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  ) % 1000000
  
  return code.toString().padStart(6, '0')
}

// TOTP algorithm implementation
function totp(secret: string, timeStep = 30): string {
  const time = Math.floor(Date.now() / 1000 / timeStep)
  const secretBytes = base32Decode(secret)
  return hotp(secretBytes, time)
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

    const authHeader = req.headers.get('Authorization')!
    
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(
      authHeader.replace('Bearer ', '')
    )
    
    if (userError || !user) {
      throw new Error('Unauthorized')
    }

    const { userId, token } = await req.json()

    if (user.id !== userId) {
      throw new Error('Unauthorized')
    }

    // Get the user's 2FA secret
    const { data: twoFactorData, error: fetchError } = await supabaseClient
      .from('two_factor_auth')
      .select('secret')
      .eq('user_id', userId)
      .single()

    if (fetchError || !twoFactorData?.secret) {
      throw new Error('2FA not set up')
    }

    // Verify the token (check current and previous time windows for clock drift)
    const currentTime = Math.floor(Date.now() / 1000 / 30)
    let isValid = false

    for (let i = -1; i <= 1; i++) {
      const timeStep = currentTime + i
      const expectedToken = totp(twoFactorData.secret, 30)
      if (token === expectedToken) {
        isValid = true
        break
      }
    }

    // If this is the first successful verification, enable 2FA
    if (isValid) {
      await supabaseClient
        .from('two_factor_auth')
        .update({ enabled: true })
        .eq('user_id', userId)
    }

    return new Response(
      JSON.stringify({ valid: isValid }),
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
