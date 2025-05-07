
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import * as base32 from 'https://deno.land/std@0.177.0/encoding/base32.ts'
import { getSupabaseClient } from '../_shared/supabase-client.ts'

// Generate a random string for use as a TOTP secret
function generateSecret(length = 20) {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567' // Base32 character set
  let result = ''
  const randomValues = new Uint8Array(length)
  crypto.getRandomValues(randomValues)
  
  for (let i = 0; i < length; i++) {
    result += charset[randomValues[i] % charset.length]
  }
  
  return result
}

// Generate backup codes for account recovery
function generateBackupCodes(count = 10, length = 8) {
  const codes = []
  const charset = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  
  for (let i = 0; i < count; i++) {
    let code = ''
    const randomValues = new Uint8Array(length)
    crypto.getRandomValues(randomValues)
    
    for (let j = 0; j < length; j++) {
      code += charset[randomValues[j] % charset.length]
    }
    
    // Format as XXXX-XXXX for better readability
    codes.push(`${code.slice(0, 4)}-${code.slice(4, 8)}`)
  }
  
  return codes
}

serve(async (req) => {
  try {
    // Get the user ID from request body
    const { userId } = await req.json()
    
    if (!userId) {
      return new Response(
        JSON.stringify({ error: 'User ID is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Initialize Supabase client
    const supabaseClient = getSupabaseClient(req)
    
    // Generate a new secret
    const secret = generateSecret()
    
    // Generate backup codes
    const backupCodes = generateBackupCodes()
    
    return new Response(
      JSON.stringify({ 
        secret, 
        backupCodes 
      }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})
