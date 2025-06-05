
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface PaymentRequest {
  amount: number;
  currency: string;
  paymentMethod: string;
  provider: string;
  recipientAccount?: string;
  recipientName?: string;
  description?: string;
  metadata?: any;
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

    // Get user from authorization header
    const authHeader = req.headers.get('Authorization')!
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(
      authHeader.replace('Bearer ', '')
    )
    
    if (userError || !user) {
      throw new Error('Unauthorized')
    }

    const paymentData: PaymentRequest = await req.json()
    
    // Validate payment data
    if (!paymentData.amount || paymentData.amount <= 0) {
      throw new Error('Invalid payment amount')
    }

    // Get user's wallet
    const { data: wallet, error: walletError } = await supabaseClient
      .from('wallets')
      .select('*')
      .eq('user_id', user.id)
      .eq('currency', paymentData.currency)
      .single()

    if (walletError || !wallet) {
      throw new Error('Wallet not found')
    }

    // Check sufficient balance for outgoing payments
    if (paymentData.paymentMethod !== 'deposit' && wallet.balance < paymentData.amount) {
      throw new Error('Insufficient funds')
    }

    // Generate transaction ID
    const transactionId = `TXN_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    
    // Calculate fees (1% with minimum of 2 ZMW)
    const feeAmount = Math.max(paymentData.amount * 0.01, 2.00)
    
    // Create transaction record
    const transactionData = {
      user_id: user.id,
      wallet_id: wallet.id,
      transaction_id: transactionId,
      amount: paymentData.amount,
      fee_amount: feeAmount,
      currency: paymentData.currency,
      payment_method: paymentData.paymentMethod,
      direction: paymentData.paymentMethod === 'deposit' ? 'incoming' : 'outgoing',
      recipient_name: paymentData.recipientName,
      recipient_account: paymentData.recipientAccount,
      status: 'pending',
      description: paymentData.description,
      provider: paymentData.provider,
      metadata: paymentData.metadata,
      external_reference: `EXT_${transactionId}`
    }

    const { data: transaction, error: txnError } = await supabaseClient
      .from('transactions')
      .insert(transactionData)
      .select()
      .single()

    if (txnError) {
      console.error('Transaction creation error:', txnError)
      throw new Error('Failed to create transaction')
    }

    // Process payment based on provider
    let paymentResult
    try {
      switch (paymentData.provider.toLowerCase()) {
        case 'mtn':
          paymentResult = await processMTNPayment(paymentData, transactionId)
          break
        case 'airtel':
          paymentResult = await processAirtelPayment(paymentData, transactionId)
          break
        case 'zamtel':
          paymentResult = await processZamtelPayment(paymentData, transactionId)
          break
        case 'visa':
        case 'mastercard':
          paymentResult = await processCardPayment(paymentData, transactionId)
          break
        default:
          // For now, simulate successful payment for unknown providers
          paymentResult = { success: true, reference: transactionId }
      }

      // Update transaction status based on payment result
      const newStatus = paymentResult.success ? 'completed' : 'failed'
      const newBalance = paymentResult.success ? 
        (paymentData.paymentMethod === 'deposit' ? 
          wallet.balance + paymentData.amount : 
          wallet.balance - paymentData.amount - feeAmount) : 
        wallet.balance

      // Update transaction
      await supabaseClient
        .from('transactions')
        .update({ 
          status: newStatus,
          external_reference: paymentResult.reference || transactionId
        })
        .eq('id', transaction.id)

      // Update wallet balance if payment successful
      if (paymentResult.success) {
        await supabaseClient
          .from('wallets')
          .update({ balance: newBalance })
          .eq('id', wallet.id)
      }

      // Create compliance check record
      await supabaseClient
        .from('compliance_checks')
        .insert({
          user_id: user.id,
          transaction_id: transaction.uuid_id,
          check_type: 'payment_processing',
          status: 'passed',
          risk_score: calculateRiskScore(paymentData, user),
          details: {
            payment_method: paymentData.paymentMethod,
            provider: paymentData.provider,
            amount: paymentData.amount
          }
        })

      return new Response(
        JSON.stringify({
          success: paymentResult.success,
          transaction_id: transactionId,
          status: newStatus,
          reference: paymentResult.reference,
          balance: newBalance
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      )

    } catch (paymentError) {
      console.error('Payment processing error:', paymentError)
      
      // Update transaction as failed
      await supabaseClient
        .from('transactions')
        .update({ status: 'failed' })
        .eq('id', transaction.id)

      throw new Error(`Payment processing failed: ${paymentError.message}`)
    }

  } catch (error) {
    console.error('Process payment error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    )
  }
})

// Mock payment processor functions
async function processMTNPayment(paymentData: PaymentRequest, transactionId: string) {
  // In production, integrate with MTN MoMo API
  console.log('Processing MTN payment:', transactionId)
  
  // Simulate API call delay
  await new Promise(resolve => setTimeout(resolve, 2000))
  
  // Simulate 95% success rate
  const success = Math.random() > 0.05
  
  return {
    success,
    reference: success ? `MTN_${transactionId}` : null,
    error: success ? null : 'MTN payment failed'
  }
}

async function processAirtelPayment(paymentData: PaymentRequest, transactionId: string) {
  // In production, integrate with Airtel Money API
  console.log('Processing Airtel payment:', transactionId)
  
  await new Promise(resolve => setTimeout(resolve, 1500))
  
  const success = Math.random() > 0.03
  
  return {
    success,
    reference: success ? `AIRTEL_${transactionId}` : null,
    error: success ? null : 'Airtel payment failed'
  }
}

async function processZamtelPayment(paymentData: PaymentRequest, transactionId: string) {
  // In production, integrate with Zamtel Kwacha API
  console.log('Processing Zamtel payment:', transactionId)
  
  await new Promise(resolve => setTimeout(resolve, 2500))
  
  const success = Math.random() > 0.07
  
  return {
    success,
    reference: success ? `ZAMTEL_${transactionId}` : null,
    error: success ? null : 'Zamtel payment failed'
  }
}

async function processCardPayment(paymentData: PaymentRequest, transactionId: string) {
  // In production, integrate with card processor (Stripe, PayStack, etc.)
  console.log('Processing card payment:', transactionId)
  
  await new Promise(resolve => setTimeout(resolve, 3000))
  
  const success = Math.random() > 0.02
  
  return {
    success,
    reference: success ? `CARD_${transactionId}` : null,
    error: success ? null : 'Card payment failed'
  }
}

function calculateRiskScore(paymentData: PaymentRequest, user: any): number {
  let riskScore = 0
  
  // Amount-based risk
  if (paymentData.amount > 10000) riskScore += 20
  else if (paymentData.amount > 5000) riskScore += 10
  else if (paymentData.amount > 1000) riskScore += 5
  
  // Payment method risk
  if (paymentData.paymentMethod === 'crypto') riskScore += 15
  else if (paymentData.paymentMethod === 'bank_transfer') riskScore += 5
  
  // New user risk
  const userCreated = new Date(user.created_at)
  const daysSinceCreation = (Date.now() - userCreated.getTime()) / (1000 * 60 * 60 * 24)
  if (daysSinceCreation < 7) riskScore += 25
  else if (daysSinceCreation < 30) riskScore += 10
  
  return Math.min(riskScore, 100)
}
