import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { requireAdmin } from '../_shared/auth.ts';
import { mtnProvisionSandboxUser } from '../_shared/momo-providers.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

/**
 * Admin-only helper that provisions MTN MoMo SANDBOX credentials.
 *
 * Per the "API User & API Key Management" docs, sandbox users are entirely
 * self-service: you POST /v1_0/apiuser with a UUID and your callback host,
 * then POST /v1_0/apiuser/{uuid}/apikey to mint the key. Only the
 * subscription key (free, from your MoMo developer profile) is needed first.
 *
 * Production credentials are issued through the MTN Account Portal after KYC
 * and cannot be generated this way.
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const auth = await requireAdmin(req, corsHeaders);
    if ('response' in auth && !auth.user) return auth.response!;

    const body = await req.json().catch(() => ({}));

    // Default to this project's own functions host so callbacks can reach us.
    const defaultHost = new URL(Deno.env.get('SUPABASE_URL')!).host;
    const providerCallbackHost = String(body?.provider_callback_host || defaultHost)
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '')
      .trim();

    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(providerCallbackHost)) {
      return json({ error: 'A valid callback host domain is required' }, 400);
    }

    const result = await mtnProvisionSandboxUser(providerCallbackHost);
    if ('error' in result) return json(result, 400);

    return json({
      ...result,
      next_steps: [
        'Save apiUser as the MTN_MOMO_API_USER secret.',
        'Save apiKey as the MTN_MOMO_API_KEY secret (it cannot be retrieved again).',
        'Keep MTN_MOMO_ENV set to "sandbox" until MTN issues production credentials.',
        'Sandbox transacts in EUR; production Zambia uses ZMW.',
      ],
    });
  } catch (error) {
    console.error('momo-provision error', error);
    return json({ error: 'Operation failed' }, 500);
  }
});