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
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false, autoRefreshToken: false } }
    )

    // Find all subscribers due for billing
    const { data: dueSubs, error: fetchError } = await supabase
      .from('subscribers')
      .select('*')
      .eq('subscription_status', 'active')
      .neq('subscription_tier', 'free')
      .eq('auto_renewal', true)
      .or(`next_billing_date.is.null,next_billing_date.lte.${new Date().toISOString()}`)

    if (fetchError) throw fetchError

    const results = []

    for (const sub of dueSubs || []) {
      try {
        // Process billing via DB function
        const { data: billingResult, error: billingError } = await supabase
          .rpc('process_subscriber_billing', { p_subscriber_id: sub.id })

        if (billingError) throw billingError

        if (billingResult?.success) {
          // Mark invoice as paid (in a real system, this would go through payment rail first)
          // For now, if user has a payment method, simulate charge
          const { data: paymentMethod } = await supabase
            .from('payment_methods')
            .select('*')
            .eq('user_id', sub.user_id)
            .eq('is_primary', true)
            .single()

          if (paymentMethod) {
            // Payment method exists - mark as paid
            await supabase
              .from('subscription_invoices')
              .update({ status: 'paid' })
              .eq('id', billingResult.invoice_id)

            // Reset failed count
            await supabase
              .from('subscribers')
              .update({ failed_payment_count: 0, dunning_status: 'none' })
              .eq('id', sub.id)

            results.push({ 
              subscriber_id: sub.id, 
              status: 'charged', 
              amount: billingResult.amount,
              invoice_id: billingResult.invoice_id 
            })
          } else {
            // No payment method - queue for retry
            await supabase
              .from('subscription_invoices')
              .update({ status: 'failed' })
              .eq('id', billingResult.invoice_id)

            // Increment failed count
            const newFailCount = (sub.failed_payment_count || 0) + 1
            await supabase
              .from('subscribers')
              .update({ failed_payment_count: newFailCount })
              .eq('id', sub.id)

            // Add to retry queue
            await supabase
              .from('billing_retry_queue')
              .insert({
                subscriber_id: sub.id,
                user_id: sub.user_id,
                amount: billingResult.amount,
                subscription_tier: sub.subscription_tier,
                next_retry_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // retry in 24h
                last_error: 'No payment method on file'
              })

            // Process dunning
            await supabase.rpc('process_dunning', { p_subscriber_id: sub.id })

            results.push({ 
              subscriber_id: sub.id, 
              status: 'failed', 
              reason: 'no_payment_method' 
            })
          }
        } else {
          results.push({ 
            subscriber_id: sub.id, 
            status: 'skipped', 
            reason: billingResult?.error 
          })
        }
      } catch (subError) {
        results.push({ 
          subscriber_id: sub.id, 
          status: 'error', 
          error: subError.message 
        })
      }
    }

    // Process retry queue
    const { data: retries } = await supabase
      .from('billing_retry_queue')
      .select('*')
      .eq('status', 'pending')
      .lte('next_retry_at', new Date().toISOString())
      .lt('retry_count', 3)

    for (const retry of retries || []) {
      const { data: paymentMethod } = await supabase
        .from('payment_methods')
        .select('*')
        .eq('user_id', retry.user_id)
        .eq('is_primary', true)
        .single()

      if (paymentMethod) {
        // Payment method now exists - charge and mark success
        await supabase
          .from('billing_retry_queue')
          .update({ status: 'succeeded', updated_at: new Date().toISOString() })
          .eq('id', retry.id)

        await supabase
          .from('subscribers')
          .update({ failed_payment_count: 0, dunning_status: 'none' })
          .eq('id', retry.subscriber_id)

        results.push({ retry_id: retry.id, status: 'retry_succeeded' })
      } else {
        // Still no payment method - increment retry
        const newRetryCount = retry.retry_count + 1
        await supabase
          .from('billing_retry_queue')
          .update({ 
            retry_count: newRetryCount,
            next_retry_at: new Date(Date.now() + 24 * 60 * 60 * 1000 * newRetryCount).toISOString(),
            status: newRetryCount >= 3 ? 'abandoned' : 'pending',
            updated_at: new Date().toISOString()
          })
          .eq('id', retry.id)

        if (newRetryCount >= 3) {
          await supabase.rpc('process_dunning', { p_subscriber_id: retry.subscriber_id })
        }
      }
    }

    return new Response(JSON.stringify({ 
      success: true, 
      processed: results.length, 
      results 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
