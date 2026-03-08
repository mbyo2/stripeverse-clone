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
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: authHeader } } }
    )

    // Verify user
    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    )
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { action, tier, payment_method_id } = await req.json()

    // Use service role client for DB operations
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false, autoRefreshToken: false } }
    )

    switch (action) {
      case 'upgrade':
      case 'downgrade':
      case 'change_tier': {
        if (!tier) {
          return new Response(JSON.stringify({ error: 'Tier is required' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          })
        }

        // Validate tier exists
        const { data: tierData } = await serviceClient
          .from('pricing_tiers')
          .select('*')
          .eq('tier_name', tier)
          .eq('is_active', true)
          .single()

        if (!tierData) {
          return new Response(JSON.stringify({ error: 'Invalid tier' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          })
        }

        // If upgrading to paid tier, require payment method
        if (tierData.price > 0) {
          const { data: payMethod } = await serviceClient
            .from('payment_methods')
            .select('id')
            .eq('user_id', user.id)
            .eq('is_primary', true)
            .single()

          if (!payMethod && !payment_method_id) {
            return new Response(JSON.stringify({ 
              error: 'Payment method required for paid tier',
              requires_payment_method: true
            }), {
              status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            })
          }
        }

        // Change tier with proration
        const { data: result, error: changeError } = await serviceClient
          .rpc('change_subscription_tier', {
            p_user_id: user.id,
            p_new_tier: tier,
            p_prorate: true
          })

        if (changeError) throw changeError

        // If paid tier, process immediate billing
        if (tierData.price > 0 && result?.success) {
          const { data: sub } = await serviceClient
            .from('subscribers')
            .select('id')
            .eq('user_id', user.id)
            .single()

          if (sub) {
            // Set next billing date
            await serviceClient
              .from('subscribers')
              .update({ 
                next_billing_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
                subscription_start: new Date().toISOString(),
                subscription_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
              })
              .eq('id', sub.id)

            // Generate first invoice
            await serviceClient.rpc('process_subscriber_billing', { p_subscriber_id: sub.id })

            // Auto-mark as paid since user just initiated
            const { data: latestInvoice } = await serviceClient
              .from('subscription_invoices')
              .select('id')
              .eq('user_id', user.id)
              .order('created_at', { ascending: false })
              .limit(1)
              .single()

            if (latestInvoice) {
              await serviceClient
                .from('subscription_invoices')
                .update({ status: 'paid' })
                .eq('id', latestInvoice.id)
            }
          }
        }

        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      case 'cancel': {
        // Cancel at end of period
        await serviceClient
          .from('subscribers')
          .update({ 
            auto_renewal: false,
            updated_at: new Date().toISOString()
          })
          .eq('user_id', user.id)

        // Log
        await serviceClient.rpc('log_security_event', {
          p_user_id: user.id,
          p_event_type: 'subscription_cancelled',
          p_event_data: { cancelled_at: new Date().toISOString() },
          p_risk_score: 1
        })

        // Notify
        await serviceClient
          .from('notifications')
          .insert({
            user_id: user.id,
            title: 'Subscription Cancelled',
            message: 'Your subscription will remain active until the end of your current billing period.',
            type: 'billing'
          })

        return new Response(JSON.stringify({ 
          success: true, 
          message: 'Subscription will be cancelled at end of billing period' 
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      case 'reactivate': {
        await serviceClient
          .from('subscribers')
          .update({ 
            auto_renewal: true,
            subscription_status: 'active',
            dunning_status: 'none',
            failed_payment_count: 0,
            updated_at: new Date().toISOString()
          })
          .eq('user_id', user.id)

        return new Response(JSON.stringify({ 
          success: true, 
          message: 'Subscription reactivated' 
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      default:
        return new Response(JSON.stringify({ error: 'Invalid action' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
    }
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
