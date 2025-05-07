
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
