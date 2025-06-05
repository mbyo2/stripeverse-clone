
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    const webhookData = await req.json()
    console.log('Received webhook:', webhookData)

    // Validate webhook signature (implement based on provider)
    const isValidSignature = await validateWebhookSignature(req, webhookData)
    if (!isValidSignature) {
      throw new Error('Invalid webhook signature')
    }

    // Process webhook based on provider
    const provider = webhookData.provider || 'unknown'
    let transactionUpdate

    switch (provider.toLowerCase()) {
      case 'mtn':
        transactionUpdate = await processMTNWebhook(webhookData)
        break
      case 'airtel':
        transactionUpdate = await processAirtelWebhook(webhookData)
        break
      case 'zamtel':
        transactionUpdate = await processZamtelWebhook(webhookData)
        break
      default:
        transactionUpdate = await processGenericWebhook(webhookData)
    }

    if (transactionUpdate) {
      // Update transaction in database
      const { data: transaction, error: txnError } = await supabaseClient
        .from('transactions')
        .update({
          status: transactionUpdate.status,
          external_reference: transactionUpdate.external_reference,
          metadata: transactionUpdate.metadata
        })
        .eq('transaction_id', transactionUpdate.transaction_id)
        .select()
        .single()

      if (txnError) {
        console.error('Transaction update error:', txnError)
        throw new Error('Failed to update transaction')
      }

      // Update wallet balance if transaction completed
      if (transactionUpdate.status === 'completed' && transaction) {
        const { data: wallet } = await supabaseClient
          .from('wallets')
          .select('*')
          .eq('id', transaction.wallet_id)
          .single()

        if (wallet) {
          const balanceChange = transaction.direction === 'incoming' ? 
            transaction.amount : 
            -(transaction.amount + (transaction.fee_amount || 0))

          await supabaseClient
            .from('wallets')
            .update({ balance: wallet.balance + balanceChange })
            .eq('id', wallet.id)
        }
      }

      // Send notification to business webhooks
      await notifyBusinessWebhooks(supabaseClient, transaction, transactionUpdate)
    }

    return new Response(
      JSON.stringify({ success: true, processed: !!transactionUpdate }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )

  } catch (error) {
    console.error('Webhook processing error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    )
  }
})

async function validateWebhookSignature(req: Request, webhookData: any): Promise<boolean> {
  // Implement signature validation based on provider requirements
  // For now, return true (in production, implement proper validation)
  const signature = req.headers.get('x-webhook-signature')
  console.log('Validating webhook signature:', signature)
  return true
}

async function processMTNWebhook(webhookData: any) {
  if (webhookData.status && webhookData.transaction_id) {
    return {
      transaction_id: webhookData.transaction_id,
      status: mapMTNStatus(webhookData.status),
      external_reference: webhookData.external_transaction_id,
      metadata: { webhook_data: webhookData }
    }
  }
  return null
}

async function processAirtelWebhook(webhookData: any) {
  if (webhookData.transaction_status && webhookData.transaction_id) {
    return {
      transaction_id: webhookData.transaction_id,
      status: mapAirtelStatus(webhookData.transaction_status),
      external_reference: webhookData.airtel_transaction_id,
      metadata: { webhook_data: webhookData }
    }
  }
  return null
}

async function processZamtelWebhook(webhookData: any) {
  if (webhookData.status && webhookData.reference) {
    return {
      transaction_id: webhookData.reference,
      status: mapZamtelStatus(webhookData.status),
      external_reference: webhookData.zamtel_reference,
      metadata: { webhook_data: webhookData }
    }
  }
  return null
}

async function processGenericWebhook(webhookData: any) {
  if (webhookData.transaction_id && webhookData.status) {
    return {
      transaction_id: webhookData.transaction_id,
      status: webhookData.status,
      external_reference: webhookData.external_reference,
      metadata: { webhook_data: webhookData }
    }
  }
  return null
}

function mapMTNStatus(mtnStatus: string): string {
  switch (mtnStatus.toLowerCase()) {
    case 'successful':
    case 'completed':
      return 'completed'
    case 'failed':
    case 'cancelled':
      return 'failed'
    case 'pending':
    case 'processing':
      return 'pending'
    default:
      return 'pending'
  }
}

function mapAirtelStatus(airtelStatus: string): string {
  switch (airtelStatus.toLowerCase()) {
    case 'success':
    case 'ts':
      return 'completed'
    case 'fail':
    case 'tf':
      return 'failed'
    case 'pending':
    case 'tp':
      return 'pending'
    default:
      return 'pending'
  }
}

function mapZamtelStatus(zamtelStatus: string): string {
  switch (zamtelStatus.toLowerCase()) {
    case 'success':
    case 'complete':
      return 'completed'
    case 'failed':
    case 'error':
      return 'failed'
    case 'pending':
    case 'processing':
      return 'pending'
    default:
      return 'pending'
  }
}

async function notifyBusinessWebhooks(supabaseClient: any, transaction: any, update: any) {
  try {
    // Get all business webhooks that should be notified
    const { data: webhooks } = await supabaseClient
      .from('webhooks')
      .select('*')
      .contains('events', ['transaction.completed', 'transaction.failed'])

    for (const webhook of webhooks || []) {
      try {
        const payload = {
          event: `transaction.${update.status}`,
          data: {
            transaction_id: transaction.transaction_id,
            amount: transaction.amount,
            currency: transaction.currency,
            status: update.status,
            external_reference: update.external_reference,
            timestamp: new Date().toISOString()
          }
        }

        await fetch(webhook.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Webhook-Signature': generateWebhookSignature(payload, webhook.business_id)
          },
          body: JSON.stringify(payload)
        })

        console.log('Webhook notification sent:', webhook.url)
      } catch (error) {
        console.error('Failed to send webhook notification:', error)
      }
    }
  } catch (error) {
    console.error('Error notifying business webhooks:', error)
  }
}

function generateWebhookSignature(payload: any, businessId: string): string {
  // Implement HMAC signature generation for webhook security
  return `sha256=${businessId}_${Date.now()}`
}
