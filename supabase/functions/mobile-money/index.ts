
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Example structure for the response from mobile money providers
interface MobileMoneyResponse {
  transactionId: string;
  status: 'pending' | 'success' | 'failed';
  message: string;
  provider: string;
}

// Simulated mobile money transaction processing
async function processMobileMoneyPayment(
  phoneNumber: string,
  amount: number,
  provider: string
): Promise<MobileMoneyResponse> {
  // In a real implementation, this would make API calls to the respective mobile money providers
  console.log(`Processing ${provider} payment of ${amount} to ${phoneNumber}`);
  
  // Simulate API call delay
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // For demonstration purposes, generate a random transaction ID
  const transactionId = `${provider.substring(0, 3).toUpperCase()}-${Math.floor(100000 + Math.random() * 900000)}`;
  
  // Simulate success (90% of the time) or failure
  const isSuccess = Math.random() < 0.9;
  
  return {
    transactionId,
    status: isSuccess ? 'success' : 'failed',
    message: isSuccess 
      ? `Payment of K${amount.toFixed(2)} successful` 
      : 'Transaction failed. Please try again.',
    provider
  };
}

// Validate mobile number based on Zambian mobile network patterns
function validateMobileNumber(number: string, provider: string): boolean {
  const sanitized = number.replace(/\D/g, '');
  
  // Check if it's a valid Zambian number format
  const isValidFormat = 
    (sanitized.length === 10 && sanitized.startsWith('0')) || 
    (sanitized.length === 12 && sanitized.startsWith('26'));
  
  if (!isValidFormat) return false;
  
  // Extract the network prefix
  const prefix = sanitized.startsWith('0') 
    ? sanitized.substring(1, 3) 
    : sanitized.substring(3, 5);
  
  // Check provider-specific prefixes
  switch(provider.toLowerCase()) {
    case 'mtn':
      return ['76', '77', '78'].includes(prefix);
    case 'airtel':
      return ['97', '96', '95'].includes(prefix);
    case 'zamtel':
      return ['50', '51', '52'].includes(prefix);
    default:
      return false;
  }
}

serve(async (req) => {
  // Handle CORS preflight request
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  
  try {
    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed' }),
        { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const { phoneNumber, amount, provider } = await req.json();
    
    // Validate required fields
    if (!phoneNumber || !amount || !provider) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Validate provider
    if (!['mtn', 'airtel', 'zamtel'].includes(provider.toLowerCase())) {
      return new Response(
        JSON.stringify({ error: 'Invalid mobile money provider' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Validate phone number format
    if (!validateMobileNumber(phoneNumber, provider)) {
      return new Response(
        JSON.stringify({ error: 'Invalid phone number for selected provider' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Process the payment
    const result = await processMobileMoneyPayment(phoneNumber, amount, provider);
    
    return new Response(
      JSON.stringify(result),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    console.error('Error processing mobile money payment:', error);
    
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
