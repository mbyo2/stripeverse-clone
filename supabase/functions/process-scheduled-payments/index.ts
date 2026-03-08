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
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const now = new Date().toISOString()

    // Find all active scheduled payments that are due
    const { data: duePayments, error: fetchError } = await supabase
      .from('scheduled_payments')
      .select('*')
      .eq('status', 'active')
      .lte('next_run_at', now)

    if (fetchError) throw fetchError

    const results = []

    for (const payment of duePayments || []) {
      try {
        // Create a transaction for this payment
        const { error: txError } = await supabase.from('transactions').insert({
          user_id: payment.user_id,
          amount: payment.amount,
          currency: payment.currency,
          payment_method: payment.payment_method,
          direction: 'outgoing',
          recipient_name: payment.recipient_name,
          recipient_account: payment.recipient_account,
          recipient_bank: payment.recipient_bank,
          status: 'completed',
          reference: `scheduled-${payment.id}`,
          description: payment.description || `Scheduled payment to ${payment.recipient_name}`,
          category: 'scheduled',
        })

        if (txError) throw txError

        // Calculate next run date
        const nextRun = calculateNextRun(payment.next_run_at, payment.frequency)
        const newTotalRuns = payment.total_runs + 1

        // Check if we've hit the max runs or end date
        const shouldDeactivate =
          (payment.max_runs && newTotalRuns >= payment.max_runs) ||
          (payment.end_date && nextRun > new Date(payment.end_date))

        await supabase
          .from('scheduled_payments')
          .update({
            last_run_at: now,
            next_run_at: nextRun.toISOString(),
            total_runs: newTotalRuns,
            status: shouldDeactivate ? 'completed' : 'active',
            updated_at: now,
          })
          .eq('id', payment.id)

        results.push({ id: payment.id, status: 'success' })
      } catch (err) {
        console.error(`Failed to process scheduled payment ${payment.id}:`, err)
        results.push({ id: payment.id, status: 'failed', error: err.message })
      }
    }

    return new Response(
      JSON.stringify({ processed: results.length, results }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Scheduled payments processing error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

function calculateNextRun(currentRun: string, frequency: string): Date {
  const date = new Date(currentRun)
  switch (frequency) {
    case 'daily':
      date.setDate(date.getDate() + 1)
      break
    case 'weekly':
      date.setDate(date.getDate() + 7)
      break
    case 'biweekly':
      date.setDate(date.getDate() + 14)
      break
    case 'monthly':
      date.setMonth(date.getMonth() + 1)
      break
    case 'quarterly':
      date.setMonth(date.getMonth() + 3)
      break
    case 'yearly':
      date.setFullYear(date.getFullYear() + 1)
      break
    default:
      date.setMonth(date.getMonth() + 1)
  }
  return date
}
