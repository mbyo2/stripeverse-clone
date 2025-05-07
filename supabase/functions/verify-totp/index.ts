
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import * as base32 from 'https://deno.land/std@0.177.0/encoding/base32.ts'
import { getSupabaseClient } from '../_shared/supabase-client.ts'

// HMAC-based One-Time Password Algorithm (HOTP) implementation
function generateHOTP(secret: string, counter: number): string {
  // Convert the counter to a byte array
  const buffer = new ArrayBuffer(8)
  const view = new DataView(buffer)
  view.setBigUint64(0, BigInt(counter), false)
  const counterBytes = new Uint8Array(buffer)
  
  // Decode base32 secret
  const secretBytes = base32.decode(secret.toUpperCase().replace(/=/g, ''))
  
  // Create HMAC-SHA-1 object
  const hmacKey = new Uint8Array(secretBytes)
  const hmac = new Uint8Array(
    crypto.subtle.signSync(
      { name: 'HMAC', hash: 'SHA-1' },
      crypto.subtle.importKeySync(
        'raw',
        hmacKey,
        { name: 'HMAC', hash: 'SHA-1' },
        false,
        ['sign']
      ),
      counterBytes
    )
  )
  
  // Extract 4 bytes based on the last byte offset
  const offset = hmac[hmac.length - 1] & 0xf
  const code = 
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  
  // Generate 6-digit code
  return (code % 10**6).toString().padStart(6, '0')
}

// Time-based One-Time Password Algorithm (TOTP) implementation
function generateTOTP(secret: string, window = 0): string {
  // Calculate counter based on current time
  const timeStep = 30 // default time step in seconds
  const timestamp = Math.floor(Date.now() / 1000) // current time in seconds
  const counter = Math.floor(timestamp / timeStep) + window
  
  return generateHOTP(secret, counter)
}

// Verify TOTP code
function verifyTOTP(secret: string, token: string): boolean {
  if (!secret || !token || token.length !== 6) {
    return false
  }
  
  // Check current window and adjacent windows
  for (let window = -1; window <= 1; window++) {
    const generatedToken = generateTOTP(secret, window)
    if (generatedToken === token) {
      return true
    }
  }
  
  return false
}

serve(async (req) => {
  try {
    // Get the user ID, secret, and token from request body
    const { userId, secret, token } = await req.json()
    
    if (!userId || !secret || !token) {
      return new Response(
        JSON.stringify({ error: 'User ID, secret, and token are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Verify the token
    const isValid = verifyTOTP(secret, token)
    
    return new Response(
      JSON.stringify({ valid: isValid }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})
