import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const { action, provider, amount, phone_number, reference } = await req.json()

    // Generate USSD codes based on provider and action
    const ussdCodes: Record<string, Record<string, string>> = {
      mtn: {
        payment: `*303*4*${amount}*${reference}#`,
        balance: '*303*1#',
        transfer: `*303*2*${phone_number}*${amount}#`,
        cashout: `*303*3*${amount}*${reference}#`,
      },
      airtel: {
        payment: `*778*4*${amount}*${reference}#`,
        balance: '*778*1#',
        transfer: `*778*2*${phone_number}*${amount}#`,
        cashout: `*778*3*${amount}*${reference}#`,
      },
      zamtel: {
        payment: `*422*4*${amount}*${reference}#`,
        balance: '*422*1#',
        transfer: `*422*2*${phone_number}*${amount}#`,
        cashout: `*422*3*${amount}*${reference}#`,
      },
    }

    if (!provider || !ussdCodes[provider]) {
      return new Response(JSON.stringify({ error: 'Invalid provider. Use mtn, airtel, or zamtel' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const ussdCode = ussdCodes[provider][action || 'payment']
    if (!ussdCode) {
      return new Response(JSON.stringify({ error: 'Invalid action' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const sessionRef = `USSD-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`

    // If it's a payment action, create a pending transaction
    if (action === 'payment' && amount && amount > 0) {
      const serviceRoleClient = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      )

      await serviceRoleClient.from('transactions').insert({
        user_id: user.id,
        amount: parseFloat(amount),
        currency: 'ZMW',
        payment_method: 'ussd',
        direction: 'incoming',
        status: 'pending',
        reference: sessionRef,
        provider: provider,
        recipient_name: `USSD ${provider.toUpperCase()} Payment`,
        metadata: { ussd_code: ussdCode, phone_number, session_ref: sessionRef },
      })
    }

    // Simulate USSD session status callback (in production, this would come from the telco)
    const sessionStatus = action === 'balance' ? 'completed' : 'awaiting_confirmation'

    return new Response(JSON.stringify({
      success: true,
      ussd_code: ussdCode,
      provider,
      action,
      session_ref: sessionRef,
      status: sessionStatus,
      instructions: getInstructions(provider, action),
      expires_in: 300, // 5 minutes to complete
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  } catch (error) {
    console.error('USSD payment error:', error)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})

function getInstructions(provider: string, action: string): string[] {
  const providerName = provider.toUpperCase()
  const base = [
    `Dial the USSD code on your ${providerName} registered phone`,
    'Follow the prompts on your screen',
    'Enter your Mobile Money PIN when requested',
  ]
  
  if (action === 'payment') {
    return [...base, 'Confirm the payment amount', 'You will receive an SMS confirmation']
  }
  if (action === 'transfer') {
    return [...base, 'Verify the recipient details', 'Confirm the transfer']
  }
  if (action === 'cashout') {
    return [...base, 'Visit the nearest agent', 'Provide the reference code to the agent', 'Collect your cash']
  }
  return base
}
