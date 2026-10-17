// process-scheduled-payments: server-side runner for recurring payments.
//
// Invoked by pg_cron every 5 minutes (see 20261017_scheduled_payments_runner.sql).
// For every due payment (status='active', next_run_at <= now):
//   1. Settles via the atomic money-movement function execute_atomic_transfer
//      (called directly via RPC with the service role — balances actually move,
//      insufficient funds raise instead of silently "completing").
//   2. Advances next_run_at by frequency; completes when max_runs/end_date hit.
//   3. Tracks consecutive failures; pauses the schedule after 3 straight
//      failures (e.g. persistent insufficient funds) instead of retrying forever.
//   4. If the schedule carries metadata.bnpl_plan_id, advances the linked
//      BNPL plan's installment count on success (auto-debit).
//
// Auth: optional CRON_SECRET. If the CRON_SECRET env var is set, the request
// must carry header x-cron-secret with the matching value. pg_cron sends it.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
}

const MAX_CONSECUTIVE_FAILURES = 3

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    // ── Cron authentication (optional but recommended) ──
    const cronSecret = Deno.env.get('CRON_SECRET')
    if (cronSecret) {
      const provided = req.headers.get('x-cron-secret')
      if (provided !== cronSecret) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false, autoRefreshToken: false } }
    )

    const now = new Date()

    // Find all active scheduled payments that are due
    const { data: duePayments, error: fetchError } = await supabase
      .from('scheduled_payments')
      .select('*')
      .eq('status', 'active')
      .lte('next_run_at', now.toISOString())

    if (fetchError) throw fetchError

    const results: Array<{ id: string; status: string; error?: string }> = []

    for (const payment of duePayments || []) {
      const idempotencyKey = `scheduled:${payment.id}:${payment.total_runs}`
      try {
        // Settle atomically. The DB function locks the wallet row, verifies
        // balance, moves funds, and writes the ledger — all in one transaction.
        // Throws on insufficient balance (no fake "completed" rows).
        const { data: transferResult, error: transferError } = await supabase.rpc(
          'execute_atomic_transfer',
          {
            p_from_user_id: payment.user_id,
            p_to_user_id: null, // scheduled payments go to external recipients/billers
            p_amount: payment.amount,
            p_currency: payment.currency || 'ZMW',
            p_reference_type: 'scheduled_payment',
            p_reference_id: payment.id,
            p_idempotency_key: idempotencyKey,
            p_description:
              payment.description || `Scheduled payment to ${payment.recipient_name}`,
            p_recipient_name: payment.recipient_name,
            p_payment_method: payment.payment_method || 'wallet',
          }
        )

        if (transferError) throw new Error(transferError.message)

        // ── Success: advance the schedule ──
        const nextRun = calculateNextRun(payment.next_run_at, payment.frequency)
        const newTotalRuns = (payment.total_runs || 0) + 1
        const shouldDeactivate =
          (payment.max_runs != null && newTotalRuns >= payment.max_runs) ||
          (payment.end_date != null && nextRun > new Date(payment.end_date))

        await supabase
          .from('scheduled_payments')
          .update({
            last_run_at: now.toISOString(),
            next_run_at: nextRun.toISOString(),
            total_runs: newTotalRuns,
            consecutive_failures: 0,
            status: shouldDeactivate ? 'completed' : 'active',
            updated_at: now.toISOString(),
          })
          .eq('id', payment.id)

        // ── BNPL auto-debit: advance the linked plan ──
        const bnplPlanId = payment.metadata?.bnpl_plan_id
        if (bnplPlanId) {
          await advanceBnplPlan(supabase, bnplPlanId)
        }

        results.push({ id: payment.id, status: 'success' })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        console.error(`Scheduled payment ${payment.id} failed:`, message)

        // ── Failure: count it, pause after too many ──
        const failures = (payment.consecutive_failures || 0) + 1
        const shouldPause = failures >= MAX_CONSECUTIVE_FAILURES
        await supabase
          .from('scheduled_payments')
          .update({
            consecutive_failures: failures,
            status: shouldPause ? 'paused' : 'active',
            metadata: {
              ...(payment.metadata || {}),
              last_error: message,
              last_error_at: now.toISOString(),
            },
            updated_at: now.toISOString(),
          })
          .eq('id', payment.id)

        results.push({ id: payment.id, status: shouldPause ? 'paused' : 'failed', error: message })
      }
    }

    return new Response(
      JSON.stringify({
        processed: results.length,
        succeeded: results.filter((r) => r.status === 'success').length,
        results,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Scheduled payments runner error:', error)
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Runner failed' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

/** Advance a BNPL plan by one paid installment (called on auto-debit success). */
async function advanceBnplPlan(supabase: any, planId: string) {
  const { data: plan, error } = await supabase
    .from('bnpl_plans')
    .select('id, installments_paid, installments_total, next_payment_date, status')
    .eq('id', planId)
    .single()
  if (error || !plan) return

  const newPaid = (plan.installments_paid || 0) + 1
  const done = newPaid >= (plan.installments_total || 4)
  // Pay-in-4 cadence: every 2 weeks
  const base = plan.next_payment_date ? new Date(plan.next_payment_date) : new Date()
  base.setDate(base.getDate() + 14)

  await supabase
    .from('bnpl_plans')
    .update({
      installments_paid: newPaid,
      next_payment_date: done ? null : base.toISOString(),
      status: done ? 'completed' : 'active',
      updated_at: new Date().toISOString(),
    })
    .eq('id', planId)
}

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
