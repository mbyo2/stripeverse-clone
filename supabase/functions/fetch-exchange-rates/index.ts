import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Free exchange rate API (no key required)
const RATE_API = 'https://api.exchangerate-api.com/v4/latest'

const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'GBP', 'ZMW', 'NGN', 'KES', 'ZAR', 'GHS', 'TZS', 'UGX']

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    )

    // Fetch rates from USD base
    const response = await fetch(`${RATE_API}/USD`)
    if (!response.ok) throw new Error('Failed to fetch exchange rates')
    
    const rateData = await response.json()
    const rates = rateData.rates

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
          source: 'exchangerate-api',
          valid_from: now,
          valid_until: validUntil,
        })
      }
    }

    // Upsert into exchange_rates table
    let insertedCount = 0
    for (const pair of pairs) {
      const { error } = await supabase.from('exchange_rates').insert(pair)
      if (!error) insertedCount++
    }

    return new Response(JSON.stringify({
      success: true,
      rates_updated: insertedCount,
      currencies: SUPPORTED_CURRENCIES,
      source: 'exchangerate-api',
      valid_until: validUntil,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  } catch (error: any) {
    console.error('Exchange rate fetch error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
