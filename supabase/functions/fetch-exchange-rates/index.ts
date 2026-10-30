import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Free exchange rate APIs (no key required), same provider family.
// Primary: v4 endpoint. Fallback: the provider's open v6 endpoint,
// used whenever the primary fails, times out, or returns a payload
// that fails validation. Both return a USD-base `rates` map of the
// same shape, so one parser feeds the pair builder either way; the
// `source` recorded per run names the endpoint that actually answered.
const PRIMARY_API = 'https://api.exchangerate-api.com/v4/latest'
const FALLBACK_API = 'https://open.er-api.com/v6/latest'

// Hard timeout on every outbound fetch: the previous deployed build
// could hang indefinitely on the upstream call and die silently at
// the platform wall-clock limit without logging anything. A bounded
// fetch plus log checkpoints makes every run observable and finite.
const FETCH_TIMEOUT_MS = 10_000

const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'GBP', 'ZMW', 'NGN', 'KES', 'ZAR', 'GHS', 'TZS', 'UGX']

interface RateFetchResult {
  rates: Record<string, number>
  source: string
}

async function fetchRatesFrom(url: string, source: string, validate: (data: any) => boolean): Promise<RateFetchResult> {
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!response.ok) throw new Error(`${source} responded with HTTP ${response.status}`)

  const data = await response.json()
  if (!validate(data) || !data?.rates || typeof data.rates !== 'object') {
    throw new Error(`${source} returned an unexpected payload shape`)
  }
  return { rates: data.rates, source }
}

async function fetchUsdRates(): Promise<RateFetchResult> {
  try {
    // v4 payload: { base: 'USD', rates: { USD: 1, ... } }
    return await fetchRatesFrom(`${PRIMARY_API}/USD`, 'exchangerate-api', (d) => !d?.base || d.base === 'USD')
  } catch (primaryError: any) {
    console.error(`Primary rate source failed (${primaryError?.message ?? primaryError}); trying fallback`)
    // v6 payload: { result: 'success', base_code: 'USD', rates: { USD: 1, ... } }
    return await fetchRatesFrom(`${FALLBACK_API}/USD`, 'open-er-api', (d) => d?.result === 'success' && d?.base_code === 'USD')
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  console.log('fetch-exchange-rates: handler start')

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    )

    // Fetch rates from USD base (primary source, fallback on failure)
    const { rates, source } = await fetchUsdRates()
    console.log(`fetch-exchange-rates: source '${source}' responded with ${Object.keys(rates).length} currencies`)

    // Build all currency pairs
    const pairs: Array<{ from_currency: string; to_currency: string; rate: number; source: string; valid_from: string; valid_until: string }> = []
    const now = new Date().toISOString()
    const validUntil = new Date(Date.now() + 3600000).toISOString() // 1 hour validity

    for (const from of SUPPORTED_CURRENCIES) {
      for (const to of SUPPORTED_CURRENCIES) {
        if (from === to) continue
        const fromRate = rates[from]
        const toRate = rates[to]
        if (!fromRate || !toRate) continue

        pairs.push({
          from_currency: from,
          to_currency: to,
          rate: toRate / fromRate,
          source,
          valid_from: now,
          valid_until: validUntil,
        })
      }
    }
    console.log(`fetch-exchange-rates: built ${pairs.length} pairs`)

    // Insert into exchange_rates table in a single batched request —
    // the previous per-pair loop made up to 90 sequential round trips.
    const { error: insertError } = await supabase.from('exchange_rates').insert(pairs)
    if (insertError) throw new Error(`exchange_rates insert failed: ${insertError.message}`)
    const insertedCount = pairs.length
    console.log(`fetch-exchange-rates: inserted ${insertedCount} rows (source '${source}')`)

    return new Response(JSON.stringify({
      success: true,
      rates_updated: insertedCount,
      currencies: SUPPORTED_CURRENCIES,
      source,
      valid_until: validUntil,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  } catch (error: any) {
    console.error('fetch-exchange-rates: failed:', error?.message ?? error)
    return new Response(JSON.stringify({ error: error?.message ?? 'Failed to fetch exchange rates' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})