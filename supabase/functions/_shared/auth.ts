import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

/**
 * Require an authenticated caller. Returns { user, supabase } on success.
 * Returns a Response object (401) that the caller should return directly on failure.
 */
export async function requireAuth(req: Request, corsHeaders: Record<string, string>) {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return {
      response: new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }),
    }
  }
  const token = authHeader.replace('Bearer ', '')
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data?.user?.id) {
    return {
      response: new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }),
    }
  }
  return { user: data.user, supabase }
}

/** Require an admin caller. */
export async function requireAdmin(req: Request, corsHeaders: Record<string, string>) {
  const auth = await requireAuth(req, corsHeaders)
  if ('response' in auth && !auth.user) return auth
  const { user, supabase } = auth as { user: any; supabase: any }
  const { data: isAdmin, error } = await supabase.rpc('has_role', {
    user_id: user.id,
    required_role: 'admin',
  })
  if (error || !isAdmin) {
    return {
      response: new Response(JSON.stringify({ error: 'Forbidden: admin role required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }),
    }
  }
  return { user, supabase }
}

/** Guard a cron/internal endpoint with the CRON_SECRET header. */
export function requireCronSecret(req: Request, corsHeaders: Record<string, string>) {
  const provided = req.headers.get('x-cron-secret') || req.headers.get('X-Cron-Secret')
  const expected = Deno.env.get('CRON_SECRET')
  if (!expected || provided !== expected) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  return null
}

/**
 * Guard an endpoint that pg_cron calls directly.
 *
 * Accepts either the operator-held CRON_SECRET (for manual runs) or a token
 * generated inside Postgres and stored in the private schema, verified through
 * the service-role-only `verify_cron_token` function. The database token never
 * leaves the database except in the scheduled request itself.
 */
export async function requireCronCaller(
  req: Request,
  corsHeaders: Record<string, string>,
  tokenName: string,
  supabase: { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown }> },
) {
  const provided = req.headers.get('x-cron-secret') || req.headers.get('X-Cron-Secret')
  const unauthorized = new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
  if (!provided) return unauthorized

  const expected = Deno.env.get('CRON_SECRET')
  if (expected && provided === expected) return null

  const { data } = await supabase.rpc('verify_cron_token', {
    p_name: tokenName,
    p_token: provided,
  })
  return data === true ? null : unauthorized
}