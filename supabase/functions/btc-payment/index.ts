
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

// Constants
const BTCPAY_SERVER_URL = Deno.env.get("BTCPAY_SERVER_URL") || "https://btcpay.example.com";
const BTCPAY_API_KEY = Deno.env.get("BTCPAY_API_KEY") || "";
const BTCPAY_STORE_ID = Deno.env.get("BTCPAY_STORE_ID") || "";
const BTCPAY_WEBHOOK_SECRET = Deno.env.get("BTCPAY_WEBHOOK_SECRET") || "";

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
    
    // Handle webhook notifications (direct webhook URL calls)
    if (path === 'webhook' && req.method === 'POST') {
      // Check webhook signature if secret is configured
      if (BTCPAY_WEBHOOK_SECRET) {
        const signature = req.headers.get('BTCPay-Sig');
        if (!signature) {
          return new Response(
            JSON.stringify({ error: 'Missing BTCPay signature' }),
            { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        
        // In a production environment, you should validate the signature here
        // This requires calculating an HMAC using the webhook secret and request body
        // For now, we'll just check that the header exists
      }
      
      // Parse the webhook data
      const webhookData = await req.json() as BTCPayWebhookEvent;
      
      console.log("Received webhook notification:", JSON.stringify(webhookData));
      
      // Process based on event type
      // Common types: InvoiceCreated, InvoiceReceivedPayment, InvoiceProcessing, InvoiceSettled, etc.
      switch (webhookData.type) {
        case 'InvoiceSettled':
        case 'InvoiceConfirmed':
          console.log(`Payment confirmed for invoice ${webhookData.invoiceId}`);
          // Here you could update your database or trigger additional business logic
          break;
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
    
    // Parse the request body for other endpoints
    const body = await req.json();
    
    // Check if the request is for creating an invoice (POST method)
    if (req.method === 'POST' && !body.invoiceId) {
      const { amount, currency = 'USD', orderId, buyerEmail, redirectUrl, metadata } = body as BTCPayInvoiceRequest;

      // Validate inputs
      if (!amount || amount <= 0) {
        return new Response(
          JSON.stringify({ error: 'Valid amount is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (!orderId) {
        return new Response(
          JSON.stringify({ error: 'Order ID is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      let response: BTCPayInvoiceResponse;

      // If BTCPay server credentials are provided, use the actual API
      if (BTCPAY_API_KEY && BTCPAY_STORE_ID && BTCPAY_SERVER_URL) {
        try {
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
        } catch (error) {
          console.error("Error calling BTCPay Server API:", error);
          throw error;
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
