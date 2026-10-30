
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { assertSafeWebhookUrl } from "../_shared/url-guard.ts"

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

    // Validate webhook signature (implement based on provider)
    const isValidSignature = await validateWebhookSignature(req, webhookData)
    if (!isValidSignature) {
      throw new Error('Invalid webhook signature')
    }

    // Log only non-sensitive metadata, and only after signature validation.
    console.log('Received webhook:', { provider: webhookData.provider || 'unknown' })

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
      // Idempotency: reject duplicate webhook deliveries
      const idemKey = `${provider}:${transactionUpdate.transaction_id}:${transactionUpdate.external_reference ?? ''}:${transactionUpdate.status}`
      const { error: idemError } = await supabaseClient
        .from('webhook_idempotency_keys')
        .insert({ key: idemKey, provider })
      if (idemError && (idemError as any).code === '23505') {
        console.log('Duplicate webhook ignored:', idemKey)
        return new Response(
          JSON.stringify({ success: true, duplicate: true }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        )
      }

      // Only update rows still pending — prevents double-processing
      const { data: transaction, error: txnError } = await supabaseClient
        .from('transactions')
        .update({
          status: transactionUpdate.status,
          external_reference: transactionUpdate.external_reference,
          metadata: transactionUpdate.metadata
        })
        .eq('transaction_id', transactionUpdate.transaction_id)
        .eq('status', 'pending')
        .select()
        .maybeSingle()

      if (txnError) {
        console.error('Transaction update error:', txnError)
        throw new Error('Failed to update transaction')
      }

      if (!transaction) {
        console.log('Transaction not pending, skipping balance update')
        return new Response(
          JSON.stringify({ success: true, alreadyProcessed: true }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        )
      }

      // Atomic wallet balance mutation via RPC
      if (transactionUpdate.status === 'completed') {
        const delta = transaction.direction === 'incoming'
          ? Number(transaction.amount)
          : -(Number(transaction.amount) + Number(transaction.fee_amount || 0))

        await supabaseClient.rpc('increment_wallet_balance', {
          p_user_id: transaction.user_id,
          p_amount: delta,
        })
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
    
    // Return generic error message to external systems
    return new Response(
      JSON.stringify({ error: 'Webhook processing failed' }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    )
  }
})

async function validateWebhookSignature(req: Request, webhookData: any): Promise<boolean> {
  try {
    const signature = req.headers.get('x-webhook-signature');
    const provider = (webhookData.provider || 'unknown').toLowerCase();
    
    if (!signature) {
      console.error('Missing webhook signature');
      return false;
    }
    
    // Get provider-specific webhook secret from environment
    const secretKey = Deno.env.get(`${provider.toUpperCase()}_WEBHOOK_SECRET`);
    
    if (!secretKey) {
      console.error(`No webhook secret configured for provider: ${provider}`);
      return false;
    }
    
    // Validate signature using HMAC-SHA256
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secretKey);
    const bodyData = encoder.encode(JSON.stringify(webhookData));
    
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    
    // Extract signature from header (format: sha256=<signature>)
    const expectedSig = signature.replace('sha256=', '');
    const signatureBuffer = Uint8Array.from(atob(expectedSig), c => c.charCodeAt(0));
    
    const isValid = await crypto.subtle.verify(
      'HMAC',
      cryptoKey,
      signatureBuffer,
      bodyData
    );
    
    console.log('Webhook signature validation:', { provider, isValid });
    return isValid;
    
  } catch (error) {
    console.error('Error validating webhook signature:', error);
    return false;
  }
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
    // Resolve the merchant that owns this transaction. Without a merchant
    // association we do NOT broadcast to unrelated businesses.
    let merchantIds: string[] = []

    if (transaction?.user_id) {
      const { data: merchants } = await supabaseClient
        .from('merchant_accounts')
        .select('id')
        .eq('user_id', transaction.user_id)
      merchantIds = (merchants || []).map((m: any) => m.id)
    }

    if (merchantIds.length === 0) {
      console.log('No merchant associated with transaction; skipping business webhook notifications', {
        transaction_id: transaction?.transaction_id,
      })
      return
    }

    const eventName = `transaction.${update.status}`
    // Only notify webhooks owned by the transaction's merchant(s) and
    // subscribed to this specific event type.
    const { data: webhooks } = await supabaseClient
      .from('webhooks')
      .select('*')
      .in('business_id', merchantIds)

    for (const webhook of webhooks || []) {
      // events is a jsonb map like { "transaction.completed": true }
      const events = webhook.events || {}
      const subscribed = Array.isArray(events)
        ? events.includes(eventName)
        : !!events[eventName]
      if (!subscribed) continue
      try {
        const payload = {
          event: eventName,
          data: {
            transaction_id: transaction.transaction_id,
            amount: transaction.amount,
            currency: transaction.currency,
            status: update.status,
            external_reference: update.external_reference,
            timestamp: new Date().toISOString()
          }
        }

        try { assertSafeWebhookUrl(webhook.url) } catch (e) {
          console.error('Blocked unsafe webhook URL:', webhook.url, (e as Error).message)
          continue
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

async function generateWebhookSignature(payload: any, businessId: string): Promise<string> {
  try {
    // Get business-specific webhook secret
    const { data: webhook } = await supabase
      .from('webhooks')
      .select('webhook_secret')
      .eq('business_id', businessId)
      .single();
    
    if (!webhook?.webhook_secret) {
      console.warn('No webhook secret found for business:', businessId);
      return '';
    }
    
    // Generate HMAC-SHA256 signature
    const encoder = new TextEncoder();
    const keyData = encoder.encode(webhook.webhook_secret);
    const bodyData = encoder.encode(JSON.stringify(payload));
    
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    
    const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, bodyData);
    const signatureArray = Array.from(new Uint8Array(signatureBuffer));
    const signatureHex = signatureArray.map(b => b.toString(16).padStart(2, '0')).join('');
    
    return `sha256=${signatureHex}`;
  } catch (error) {
    console.error('Error generating webhook signature:', error);
    return '';
  }
}
