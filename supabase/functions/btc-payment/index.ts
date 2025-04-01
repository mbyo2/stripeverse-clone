
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

// Constants
const BTCPAY_SERVER_URL = Deno.env.get("BTCPAY_SERVER_URL") || "https://btcpay.example.com";
const BTCPAY_API_KEY = Deno.env.get("BTCPAY_API_KEY") || "";
const BTCPAY_STORE_ID = Deno.env.get("BTCPAY_STORE_ID") || "";

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

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Check if the request is for creating an invoice
    if (req.method === 'POST') {
      const { amount, currency = 'USD', orderId, buyerEmail, redirectUrl, metadata } = await req.json() as BTCPayInvoiceRequest;

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

      // In a real implementation, this would communicate with BTCPay Server API
      // Here, we're mocking the response
      
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

      // Return the mock response
      return new Response(
        JSON.stringify({
          id: `invoice-${Date.now()}`,
          status: "new",
          amount: btcAmount,
          amountFiat: amount,
          currency: currency,
          bitcoinAddress: bitcoinAddress,
          lightningInvoice: lightningInvoice,
          checkoutUrl: checkoutUrl,
          expirationTime: new Date(Date.now() + 900000).toISOString(), // 15 minutes
        }),
        { 
          status: 200, 
          headers: { 
            ...corsHeaders, 
            'Content-Type': 'application/json' 
          } 
        }
      );
    }
    
    // Check if the request is for checking payment status
    if (req.method === 'GET') {
      const url = new URL(req.url);
      const invoiceId = url.searchParams.get('invoiceId');
      
      if (!invoiceId) {
        return new Response(
          JSON.stringify({ error: 'Invoice ID is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      // In a real implementation, this would check the payment status with BTCPay Server
      // Here, we're mocking the response (randomly successful or pending)
      
      const status = Math.random() > 0.7 ? "paid" : "pending";
      
      return new Response(
        JSON.stringify({
          id: invoiceId,
          status: status,
          paidAt: status === "paid" ? new Date().toISOString() : null
        }),
        { 
          status: 200, 
          headers: { 
            ...corsHeaders, 
            'Content-Type': 'application/json' 
          } 
        }
      );
    }

    // Not found
    return new Response(
      JSON.stringify({ error: 'Not found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error processing request:', error);
    
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
