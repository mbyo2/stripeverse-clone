
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { decode as base32Decode } from "https://deno.land/std@0.168.0/encoding/base32.ts"
import { getSupabaseClient } from '../_shared/supabase-client.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Fixed TOTP Algorithm Implementation with proper HMAC-SHA1
async function hotp(secret: Uint8Array, counter: number): Promise<string> {
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setBigUint64(0, BigInt(counter), false);
  
  const key = await crypto.subtle.importKey(
    'raw',
    secret,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign('HMAC', key, buffer);
  const hash = new Uint8Array(signature);
  const offset = hash[19] & 0xf;
  const code = ((hash[offset] & 0x7f) << 24) |
               ((hash[offset + 1] & 0xff) << 16) |
               ((hash[offset + 2] & 0xff) << 8) |
               (hash[offset + 3] & 0xff);
  return (code % 1000000).toString().padStart(6, '0');
}

async function totp(secret: string, timeStep = 30): Promise<string> {
  const counter = Math.floor(Date.now() / 1000 / timeStep);
  const secretBytes = base32Decode(secret);
  return await hotp(secretBytes, counter);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = getSupabaseClient(req);

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
      .select('secret, enabled')
      .eq('user_id', userId)
      .single();

    if (fetchError || !twoFactorData?.secret) {
      throw new Error('2FA not set up');
    }

    // Check for replay attacks - verify token hasn't been used before
    const { data: usedTokens } = await supabaseClient
      .from('used_totp_tokens')
      .select('token, used_at')
      .eq('user_id', userId)
      .gte('used_at', new Date(Date.now() - 90000).toISOString()); // Last 90 seconds

    if (usedTokens?.some(t => t.token === token)) {
      throw new Error('Token already used. Please wait for a new token.');
    }

    // Verify the token (check current and previous time windows for clock drift)
    const currentTime = Math.floor(Date.now() / 1000 / 30);
    let isValid = false;

    for (let i = -1; i <= 1; i++) {
      const timeStep = currentTime + i;
      const expectedToken = await totp(twoFactorData.secret, 30);
      if (token === expectedToken) {
        isValid = true;
        break;
      }
    }

    // If valid, store used token to prevent replay attacks
    if (isValid) {
      await supabaseClient
        .from('used_totp_tokens')
        .insert({
          user_id: userId,
          token: token,
          used_at: new Date().toISOString()
        });

      // Enable 2FA for the user if this is first successful verification
      await supabaseClient
        .from('two_factor_auth')
        .update({ enabled: true })
        .eq('user_id', userId);

      // Log security event
      await supabaseClient.rpc('log_security_event', {
        p_user_id: userId,
        p_event_type: '2fa_verification_success',
        p_event_data: { token_used: token },
        p_risk_score: 1
      });
    } else {
      // Log failed verification attempt
      await supabaseClient.rpc('log_security_event', {
        p_user_id: userId,
        p_event_type: '2fa_verification_failed',
        p_event_data: { token_attempted: token },
        p_risk_score: 3
      });
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
