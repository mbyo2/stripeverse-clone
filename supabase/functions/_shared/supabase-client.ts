
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

export const getSupabaseClient = (req: Request) => {
  // Get authorization header
  const authHeader = req.headers.get('Authorization')
  
  // Initialize the Supabase client
  const supabaseClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      global: {
        headers: {
          Authorization: authHeader || '',
        },
      },
    }
  )
  
  return supabaseClient
}

/**
 * Dedicated service-role client that does NOT forward the caller's
 * Authorization header.
 *
 * Money-path RPCs are EXECUTE-granted to service_role only, and
 * PostgREST runs a request carrying a user JWT in the `authenticated`
 * role — so calls through getSupabaseClient(req) above (which forwards
 * the JWT) are DENIED for those RPCs, and a user auth.uid() in scope
 * can also trip balance-protection triggers that neutralize balance
 * UPDATEs made under a user session. Use this client for all
 * server-side money operations (RPCs, ledger writes, service-owned
 * tables) AFTER the caller's identity has been verified from their
 * JWT via the request-scoped client. Pattern proven by atomic-transfer
 * and internal-transfer.
 */
export const getServiceRoleClient = () => {
  return createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  )
}
