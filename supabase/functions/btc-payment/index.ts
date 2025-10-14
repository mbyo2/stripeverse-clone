import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { getSupabaseClient } from "../_shared/supabase-client.ts"

// Constants
const BTCPAY_SERVER_URL = Deno.env.get("BTCPAY_SERVER_URL") || "https://btcpay.example.com";
const BTCPAY_API_KEY = Deno.env.get("BTCPAY_API_KEY") || "placeholder_api_key_replace_with_real_one";
const BTCPAY_STORE_ID = Deno.env.get("BTCPAY_STORE_ID") || "placeholder_store_id";
const BTCPAY_WEBHOOK_SECRET = Deno.env.get("BTCPAY_WEBHOOK_SECRET") || "placeholder_webhook_secret";

// CORS headers for our function
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface BTCPayInvoiceRequest {
  amount: number;
  currency: string;
  orderId: string;
  buyerEmail?: string;
  redirectUrl?: string;
  metadata?: Record<string, unknown>;
}

interface BTCPayInvoiceResponse {
  id: string;
  status: string;
  amount: number;
  amountFiat: number;
  currency: string;
  bitcoinAddress: string;
  lightningInvoice: string;
  checkoutUrl: string;
  expirationTime: string;
}

interface BTCPayWebhookEvent {
  deliveryId: string;
  webhookId: string;
  originalDeliveryId?: string;
  isRedelivery: boolean;
  type: string;
  timestamp: number;
  storeId: string;
  invoiceId: string;
  metadata: Record<string, unknown>;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get the URL path
    const url = new URL(req.url);
    const path = url.pathname.split('/').pop();
    
    // Supabase client (service role with request auth header)
    const supabase = getSupabaseClient(req);
    
    // Handle webhook notifications (direct webhook URL calls)
    if (path === 'webhook' && req.method === 'POST') {
      const body = await req.text();
      
      // Enhanced webhook signature validation
      if (BTCPAY_WEBHOOK_SECRET) {
        const signature = req.headers.get('BTCPay-Sig');
        if (!signature) {
          console.error('Missing BTCPay signature header');
          return new Response(
            JSON.stringify({ error: 'Missing BTCPay signature' }),
            { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        
        // Validate webhook signature using HMAC-SHA256
        try {
          const expectedSig = signature.replace('sha256=', '');
          const encoder = new TextEncoder();
          const keyData = encoder.encode(BTCPAY_WEBHOOK_SECRET);
          const bodyData = encoder.encode(body);
          
          const cryptoKey = await crypto.subtle.importKey(
            'raw',
            keyData,
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign']
          );
          
          const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, bodyData);
          const computedSig = Array.from(new Uint8Array(signatureBuffer))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
            
          if (computedSig !== expectedSig) {
            console.error('Invalid webhook signature');
            return new Response(
              JSON.stringify({ error: 'Invalid webhook signature' }),
              { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
        } catch (error) {
          console.error('Error validating webhook signature:', error);
          return new Response(
            JSON.stringify({ error: 'Signature validation failed' }),
            { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }
      
      // Parse the webhook data (body already read for signature validation)
      const webhookData = JSON.parse(body) as BTCPayWebhookEvent;
      
      console.log("Received webhook notification:", JSON.stringify(webhookData));
      
      // Process based on event type
      // Common types: InvoiceCreated, InvoiceReceivedPayment, InvoiceProcessing, InvoiceSettled, etc.
      switch (webhookData.type) {
        case 'InvoiceSettled':
        case 'InvoiceConfirmed': {
          console.log(`Payment confirmed for invoice ${webhookData.invoiceId}`);
          try {
            // Mark invoice as paid and fetch owner + amount
            const { data: updated, error: updErr } = await supabase
              .from('crypto_invoices')
              .update({ status: 'paid', paid_at: new Date().toISOString() })
              .eq('invoice_id', webhookData.invoiceId)
              .select('user_id, amount_sats')
              .maybeSingle();

            if (updErr) {
              console.error('Error updating crypto_invoices:', updErr);
            }

            if (updated?.user_id && updated?.amount_sats) {
              // Credit user's BTC wallet
              const sats = Number(updated.amount_sats) || 0;
              const { error: incErr } = await supabase.rpc('increment_crypto_balance', {
                p_user_id: updated.user_id,
                p_asset: 'BTC',
                p_amount_sats: sats
              });
              if (incErr) console.error('Error incrementing crypto balance:', incErr);

              // Record a transaction entry in existing transactions table
              const amountBtc = sats / 100_000_000;
              const { error: txErr } = await supabase.from('transactions').insert({
                user_id: updated.user_id,
                amount: amountBtc,
                currency: 'BTC',
                payment_method: 'bitcoin',
                direction: 'incoming',
                status: 'completed',
                provider: 'BTCPay',
                transaction_id: webhookData.invoiceId,
                reference: 'btc_deposit',
                category: 'general',
                metadata: { type: 'deposit', network: 'bitcoin', source: 'btcpay' }
              });
              if (txErr) console.error('Error inserting BTC transaction:', txErr);
            }
          } catch (err) {
            console.error('Error handling webhook settlement:', err);
          }
          break;
        }
        case 'InvoiceExpired':
          console.log(`Invoice ${webhookData.invoiceId} has expired`);
          break;
        case 'InvoiceReceivedPayment':
          console.log(`Received payment for invoice ${webhookData.invoiceId}`);
          break;
        default:
          console.log(`Unhandled webhook event type: ${webhookData.type}`);
      }
      
      // Always return 200 OK to acknowledge receipt of the webhook
      return new Response(
        JSON.stringify({ received: true }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Verify user authentication for non-webhook endpoints
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      console.error('Authentication failed:', authError);
      return new Response(
        JSON.stringify({ error: 'Unauthorized - Authentication required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Parse the request body for other endpoints
    const body = await req.json();
    
    // Check if the request is for creating an invoice (POST method)
    if (req.method === 'POST' && !body.invoiceId) {
      const { amount, currency = 'USD', orderId, buyerEmail, redirectUrl, metadata } = body as BTCPayInvoiceRequest;

      // Enhanced input validation
      if (!amount || typeof amount !== 'number' || amount <= 0 || isNaN(amount) || amount > 1000000) {
        return new Response(
          JSON.stringify({ error: 'Valid amount is required (must be positive number, max 1M)' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (!orderId || typeof orderId !== 'string' || orderId.length > 100 || !/^[a-zA-Z0-9_-]+$/.test(orderId)) {
        return new Response(
          JSON.stringify({ error: 'Valid order ID is required (alphanumeric, max 100 chars)' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (currency && (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency))) {
        return new Response(
          JSON.stringify({ error: 'Currency must be valid 3-letter code' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (buyerEmail && (typeof buyerEmail !== 'string' || buyerEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail))) {
        return new Response(
          JSON.stringify({ error: 'Valid email address required if provided' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      let response: BTCPayInvoiceResponse;

      // If BTCPay server credentials are provided, use the actual API
      if (BTCPAY_API_KEY && BTCPAY_STORE_ID && BTCPAY_SERVER_URL) {
        console.log("Using BTCPay Server API with placeholder or configured API key");
        
        // Construct the API URL for creating an invoice
        const apiUrl = `${BTCPAY_SERVER_URL}/api/v1/stores/${BTCPAY_STORE_ID}/invoices`;
        
        // Get the webhook URL (this function's URL + /webhook)
        const webhookUrl = `${url.origin}${url.pathname}/webhook`;
        
        // Prepare the request payload for BTCPay Server
        const payload = {
          amount,
          currency,
          orderId,
          metadata: {
            orderId,
            buyerEmail,
            ...metadata
          },
          checkout: {
            redirectURL: redirectUrl,
            defaultPaymentMethod: "BTC",
            expirationMinutes: 15
          },
          // Add webhook configuration if we have a webhook secret
          ...(BTCPAY_WEBHOOK_SECRET ? {
            webhookUrl: webhookUrl
          } : {})
        };
        
        // Make the API call to BTCPay Server
        const btcpayResponse = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `token ${BTCPAY_API_KEY}`
          },
          body: JSON.stringify(payload)
        });
        
        if (!btcpayResponse.ok) {
          const errorText = await btcpayResponse.text();
          console.error("BTCPay Server API error:", errorText);
          throw new Error(`BTCPay Server API error: ${btcpayResponse.status} ${errorText}`);
        }
        
        const data = await btcpayResponse.json();
        
        // Format the response for our frontend
        response = {
          id: data.id,
          status: data.status,
          amount: data.btcPrice,
          amountFiat: data.amount,
          currency: data.currency,
          bitcoinAddress: data.paymentMethods.BTC?.address || "",
          lightningInvoice: data.paymentMethods.BTC?.lightning || "",
          checkoutUrl: data.checkoutLink,
          expirationTime: data.expirationTime
        };
        
        // If webhooks aren't set up yet, register the webhook with BTCPay
        // This is a one-time operation you might do separately
        if (BTCPAY_WEBHOOK_SECRET && path === 'register-webhook') {
          try {
            await registerWebhook(webhookUrl);
            console.log("Successfully registered webhook");
          } catch (error) {
            console.error("Error registering webhook:", error);
          }
        }
      } else {
        // Use mock implementation if no BTCPay server credentials are provided
        console.log("Using mock BTCPay implementation");
        
        // Simulate API call delay
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Mock exchange rate: 1 BTC = $50,000 USD
        const exchangeRate = 50000;
        const btcAmount = amount / exchangeRate;
        
        // Mock Bitcoin address and Lightning invoice
        const bitcoinAddress = "bc1q84x0yrztvcjgp6n3k4edwv02k8wsh75d5xqmmx";
        const lightningInvoice = "lnbc10u1p3hkhmtpp5dzywf4pqn9mf0y9ypsncn2ww2dskvkpjg3yzawsu2deh5gyafqdqqcqzzsxqyz5vqsp5hwmcps58070p0k9enz9rp8296nkur5rgwff2ne2whq0hh37nvhs9qyyssqxmxs8whfnnf7l7ftsw0dlw7tan4q4z0vxa4j3qx7s3dkhazjrx32y56wd4kxm4r08vg3hprn2uvpnxhkgxmy36wnfyv3q0j68qc5hpgpv328ak";
        
        // Generate a BTCPay checkout URL
        const checkoutUrl = `${BTCPAY_SERVER_URL}/invoice?id=mock-invoice-${Date.now()}`;
        
        response = {
          id: `invoice-${Date.now()}`,
          status: "new",
          amount: btcAmount,
          amountFiat: amount,
          currency: currency,
          bitcoinAddress: bitcoinAddress,
          lightningInvoice: lightningInvoice,
          checkoutUrl: checkoutUrl,
          expirationTime: new Date(Date.now() + 900000).toISOString(), // 15 minutes
        };
      }

      // Persist invoice mapping to user for crediting on webhook
      try {
        const { data: auth } = await supabase.auth.getUser();
        const userId = auth?.user?.id;
        const sats = Math.round((response.amount || 0) * 100_000_000);
        if (userId) {
          // Ensure wallet row exists
          await supabase.from('crypto_wallets').upsert({ user_id: userId, asset: 'BTC' }, { onConflict: 'user_id,asset' });
          // Store invoice record
          await supabase.from('crypto_invoices').insert({
            user_id: userId,
            invoice_id: response.id,
            status: 'pending',
            amount_sats: sats,
            amount_fiat: response.amountFiat,
            fiat_currency: response.currency,
            method: 'bitcoin'
          });
        }
      } catch (persistErr) {
        console.error('Failed to persist crypto invoice:', persistErr);
      }

      // Return the response
      return new Response(
        JSON.stringify(response),
        { 
          status: 200, 
          headers: { 
            ...corsHeaders, 
            'Content-Type': 'application/json' 
          } 
        }
      );
    }
    
    // Check if the request is for checking payment status (GET method or POST with invoiceId)
    if (req.method === 'GET' || (req.method === 'POST' && body.invoiceId)) {
      const invoiceId = body.invoiceId;
      
      if (!invoiceId) {
        return new Response(
          JSON.stringify({ error: 'Invoice ID is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      let response: { id: string; status: string; paidAt: string | null };
      
      // If BTCPay server credentials are provided, use the actual API
      if (BTCPAY_API_KEY && BTCPAY_STORE_ID && BTCPAY_SERVER_URL) {
        try {
          // Construct the API URL for getting invoice status
          const apiUrl = `${BTCPAY_SERVER_URL}/api/v1/stores/${BTCPAY_STORE_ID}/invoices/${invoiceId}`;
          
          // Make the API call to BTCPay Server
          const btcpayResponse = await fetch(apiUrl, {
            method: 'GET',
            headers: {
              'Authorization': `token ${BTCPAY_API_KEY}`
            }
          });
          
          if (!btcpayResponse.ok) {
            const errorText = await btcpayResponse.text();
            console.error("BTCPay Server API error:", errorText);
            throw new Error(`BTCPay Server API error: ${btcpayResponse.status} ${errorText}`);
          }
          
          const data = await btcpayResponse.json();
          
          // Map BTCPay Server status to our status
          let status = "pending";
          if (data.status === "settled" || data.status === "complete") {
            status = "paid";
          } else if (data.status === "expired" || data.status === "invalid") {
            status = "expired";
          }
          
          response = {
            id: data.id,
            status: status,
            paidAt: status === "paid" ? data.monitoringExpiration : null
          };
        } catch (error) {
          console.error("Error calling BTCPay Server API:", error);
          throw error;
        }
      } else {
        // In a real implementation, this would check the payment status with BTCPay Server
        // Here, we're mocking the response (randomly successful or pending)
        const status = Math.random() > 0.7 ? "paid" : "pending";
        
        response = {
          id: invoiceId,
          status: status,
          paidAt: status === "paid" ? new Date().toISOString() : null
        };
      }
      
      return new Response(
        JSON.stringify(response),
        { 
          status: 200, 
          headers: { 
            ...corsHeaders, 
            'Content-Type': 'application/json' 
          } 
        }
      );
    }

    // Helper function to register a webhook with BTCPay Server
    async function registerWebhook(webhookUrl: string) {
      if (!BTCPAY_API_KEY || !BTCPAY_STORE_ID || !BTCPAY_SERVER_URL || !BTCPAY_WEBHOOK_SECRET) {
        throw new Error("Missing required BTCPay Server credentials for webhook registration");
      }
      
      // API endpoint for creating webhooks
      const apiUrl = `${BTCPAY_SERVER_URL}/api/v1/stores/${BTCPAY_STORE_ID}/webhooks`;
      
      // Webhook payload - listen for all invoice-related events
      const payload = {
        url: webhookUrl,
        enabled: true,
        authorizedEvents: {
          everything: false,
          specificEvents: [
            "InvoiceCreated",
            "InvoiceReceivedPayment",
            "InvoiceProcessing", 
            "InvoiceExpired",
            "InvoiceSettled",
            "InvoiceInvalid"
          ]
        },
        secret: BTCPAY_WEBHOOK_SECRET
      };
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `token ${BTCPAY_API_KEY}`
        },
        body: JSON.stringify(payload)
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to register webhook: ${response.status} ${errorText}`);
      }
      
      return await response.json();
    }

    // Not found
    return new Response(
      JSON.stringify({ error: 'Not found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error processing request:', error);
    
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
